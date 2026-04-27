"""Comm bridge between JupyterLab Cell Layout and xlwings.

Phase 1 + 3 (read-only with live sync): the JupyterLab frontend can read a
named Excel range on demand and subscribe for push updates whenever the
range's values change. A single daemon polling thread services all
subscriptions across all open notebooks at a configurable interval (default
1 s). Polling pauses while user code is executing so a busy kernel doesn't
fight xlwings calls.

Usage from a notebook cell::

    from jupyterlab_cell_layout.excel_bridge import register
    register()                        # default 1 s poll interval
    register(poll_interval_s=2.0)     # custom interval (clamped 0.1–60 s)

xlwings is imported lazily inside the read function, so this module is
importable without xlwings installed (a `read` will then return a friendly
error to the frontend).

Cross-platform note: tested on macOS where xlwings uses AppleScript and
calls from a daemon thread work without ceremony. Windows COM requires
``pythoncom.CoInitialize()`` per thread; not yet handled. To be added
before any PyPI publish.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Tuple

TARGET_NAME = "jupyterlab-cell-layout:excel"

DEFAULT_POLL_INTERVAL_S = 1.0
MIN_POLL_INTERVAL_S = 0.1
MAX_POLL_INTERVAL_S = 60.0

_state_lock = threading.Lock()
# Keyed by (comm-object-id, opaque-subscription-key from frontend).
_subscriptions: Dict[Tuple[int, str], "_Subscription"] = {}
_poll_thread: Optional[threading.Thread] = None
_poll_stop = threading.Event()
_poll_interval_s: float = DEFAULT_POLL_INTERVAL_S
_kernel_busy: bool = False


class _Subscription:
    __slots__ = (
        "comm",
        "comm_id",
        "key",
        "workbook",
        "sheet",
        "range_name",
        "last_value",
        "last_alignments",
        "last_error",
    )

    def __init__(self, comm, comm_id, key, workbook, sheet, range_name):
        self.comm = comm
        self.comm_id = comm_id
        self.key = key
        self.workbook = workbook
        self.sheet = sheet
        self.range_name = range_name
        self.last_value: Optional[List[List[Any]]] = None
        self.last_alignments: Optional[List[List[Optional[str]]]] = None
        self.last_error: Optional[str] = None


def register(poll_interval_s: float = DEFAULT_POLL_INTERVAL_S) -> None:
    """Register the comm target on the active IPython kernel.

    Safe to call multiple times. Re-registering replaces the previous comm
    target handler and updates the poll interval.
    """
    global _poll_interval_s
    _poll_interval_s = max(
        MIN_POLL_INTERVAL_S, min(MAX_POLL_INTERVAL_S, float(poll_interval_s))
    )
    try:
        ip = get_ipython()  # type: ignore[name-defined]
    except NameError as exc:  # pragma: no cover - happens outside ipython
        raise RuntimeError(
            "register() must be called from within an IPython kernel"
        ) from exc
    ip.kernel.comm_manager.register_target(TARGET_NAME, _on_open)
    # Pause polling while user code runs so xlwings polling doesn't compete
    # with user xlwings calls. Re-register defensively (no-op if not previously
    # registered).
    for event_name, handler in (
        ("pre_execute", _on_pre_execute),
        ("post_execute", _on_post_execute),
    ):
        try:
            ip.events.unregister(event_name, handler)
        except (ValueError, KeyError):
            pass
        ip.events.register(event_name, handler)


def _on_pre_execute() -> None:
    global _kernel_busy
    _kernel_busy = True


def _on_post_execute() -> None:
    global _kernel_busy
    _kernel_busy = False


def _on_open(comm, _open_msg) -> None:
    comm_id = id(comm)

    @comm.on_msg
    def _on_msg(msg):
        data = (msg.get("content") or {}).get("data") or {}
        kind = data.get("type")
        try:
            if kind == "read":
                _handle_read(comm, data)
            elif kind == "subscribe":
                _handle_subscribe(comm, comm_id, data)
            elif kind == "unsubscribe":
                _handle_unsubscribe(comm_id, data)
            else:
                _send_error(
                    comm,
                    data.get("request_id"),
                    f"Unknown request type: {kind!r}",
                )
        except Exception as exc:  # noqa: BLE001 — errors flow back to UI
            _send_error(
                comm,
                data.get("request_id"),
                f"{type(exc).__name__}: {exc}",
            )

    @comm.on_close
    def _on_close(_msg):
        with _state_lock:
            stale = [k for k in _subscriptions if k[0] == comm_id]
            for k in stale:
                del _subscriptions[k]


def _send_error(comm, request_id, message: str) -> None:
    payload = {"type": "error", "message": message}
    if request_id is not None:
        payload["request_id"] = request_id
    comm.send(payload)


def _handle_read(comm, data) -> None:
    request_id = data.get("request_id")
    rows, alignments = _read_range(
        workbook=data.get("workbook"),
        sheet=data.get("sheet"),
        range_name=data.get("range"),
    )
    comm.send(
        {
            "type": "data",
            "request_id": request_id,
            "rows": rows,
            "alignments": alignments,
        }
    )


def _handle_subscribe(comm, comm_id: int, data) -> None:
    key = data.get("subscription_key")
    workbook = data.get("workbook")
    sheet = data.get("sheet")
    range_name = data.get("range")
    if not (key and workbook and sheet and range_name):
        _send_error(
            comm,
            data.get("request_id"),
            "subscribe missing required fields",
        )
        return
    sub = _Subscription(comm, comm_id, key, workbook, sheet, range_name)
    with _state_lock:
        _subscriptions[(comm_id, key)] = sub
    # Send initial value immediately so the UI doesn't sit blank for one
    # poll interval before the first push.
    try:
        rows, alignments = _read_range(workbook, sheet, range_name)
        sub.last_value = rows
        sub.last_alignments = alignments
        comm.send(
            {
                "type": "data",
                "subscription_key": key,
                "rows": rows,
                "alignments": alignments,
            }
        )
    except Exception as exc:  # noqa: BLE001
        msg = f"{type(exc).__name__}: {exc}"
        sub.last_error = msg
        comm.send(
            {
                "type": "error",
                "subscription_key": key,
                "message": msg,
            }
        )
    _ensure_poll_thread()


def _handle_unsubscribe(comm_id: int, data) -> None:
    key = data.get("subscription_key")
    if not key:
        return
    with _state_lock:
        _subscriptions.pop((comm_id, key), None)


def _ensure_poll_thread() -> None:
    global _poll_thread
    if _poll_thread is not None and _poll_thread.is_alive():
        return
    _poll_stop.clear()
    _poll_thread = threading.Thread(
        target=_poll_loop, daemon=True, name="cell-layout-excel-poll"
    )
    _poll_thread.start()


def _poll_loop() -> None:
    while not _poll_stop.is_set():
        if _poll_stop.wait(_poll_interval_s):
            return
        if _kernel_busy:
            continue
        with _state_lock:
            subs = list(_subscriptions.values())
        if not subs:
            # Nothing to watch — let the thread die. Re-spawned on next
            # subscribe.
            return
        for sub in subs:
            _poll_one(sub)


def _poll_one(sub: "_Subscription") -> None:
    try:
        rows, alignments = _read_range(
            sub.workbook, sub.sheet, sub.range_name
        )
    except Exception as exc:  # noqa: BLE001
        msg = f"{type(exc).__name__}: {exc}"
        if msg != sub.last_error:
            sub.last_error = msg
            try:
                sub.comm.send(
                    {
                        "type": "error",
                        "subscription_key": sub.key,
                        "message": msg,
                    }
                )
            except Exception:  # noqa: BLE001
                pass
        return
    if rows == sub.last_value and alignments == sub.last_alignments:
        return
    sub.last_value = rows
    sub.last_alignments = alignments
    sub.last_error = None
    try:
        sub.comm.send(
            {
                "type": "data",
                "subscription_key": sub.key,
                "rows": rows,
                "alignments": alignments,
            }
        )
    except Exception:  # noqa: BLE001
        # Comm gone — drop the subscription so we stop hammering it.
        with _state_lock:
            _subscriptions.pop((sub.comm_id, sub.key), None)


def _read_range(workbook, sheet, range_name):
    """Return ``(rows, alignments)`` for a named range.

    `rows` is a 2-D list of cell values (see _to_rows). `alignments` is a
    parallel 2-D list of strings: 'left' / 'center' / 'right' / 'general'
    or None when the read fails for that cell.
    """
    if not workbook or not sheet or not range_name:
        raise ValueError("workbook, sheet, and range are all required")
    try:
        import xlwings as xw  # noqa: WPS433 — lazy import is intentional
    except ImportError as exc:
        raise RuntimeError(
            "xlwings is not installed in this kernel. "
            "Install with: pip install xlwings"
        ) from exc

    try:
        book = xw.Book(workbook)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Could not open workbook {workbook!r}: {exc}. "
            "Is Excel running and the file open?"
        ) from exc

    try:
        rng = book.sheets[sheet].range(range_name)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Could not resolve {sheet!r}!{range_name!r}: {exc}"
        ) from exc

    rows = _to_rows(rng.value)
    alignments = _read_alignments(rng, rows)
    return rows, alignments


def _read_alignments(rng, rows: List[List[Any]]) -> List[List[Optional[str]]]:
    """Read horizontal alignment per cell in `rng`, shaped to match `rows`.

    Iterating cells via xlwings is slow on Mac (each property read is an
    AppleScript round-trip). Try the bulk read first — if every cell in
    the range shares one alignment, xlwings returns a single value and we
    avoid the loop. On a mixed range, fall back to per-cell iteration.
    """
    if not rows:
        return []
    height = len(rows)
    width = len(rows[0]) if rows[0] else 0
    if width == 0:
        return [[] for _ in rows]
    bulk = _normalise_alignment(_safe_get_alignment(rng))
    if bulk is not None:
        return [[bulk for _ in range(width)] for _ in range(height)]
    # Mixed alignment in the range — read each cell.
    out: List[List[Optional[str]]] = []
    for r in range(height):
        row: List[Optional[str]] = []
        for c in range(width):
            try:
                cell = rng[r, c]
            except Exception:  # noqa: BLE001
                row.append(None)
                continue
            row.append(_normalise_alignment(_safe_get_alignment(cell)))
        out.append(row)
    return out


def _safe_get_alignment(rng) -> Any:
    """Read the horizontal alignment of `rng` via the xlwings api object.

    Cross-platform handling:
    - Windows COM exposes ``api.HorizontalAlignment`` as a property that
      auto-evaluates to an integer xlHAlign* constant.
    - Mac (xlwings via appscript) exposes ``api.horizontal_alignment`` as
      a lazy ``appscript.Reference``. Reading the value requires
      ``.get()``; without it the function returned a Reference object that
      ``_normalise_alignment`` couldn't parse, so all cells looked
      perpetually unchanged.

    Returns None if the property isn't accessible (xlwings version
    variance, mixed-cell sentinel, get() failure, etc.).
    """
    try:
        api = rng.api
    except Exception:  # noqa: BLE001
        return None
    for attr in ("HorizontalAlignment", "horizontal_alignment"):
        try:
            candidate = getattr(api, attr)
        except Exception:  # noqa: BLE001
            continue
        resolved = _resolve_lazy(candidate)
        if resolved is not None:
            return resolved
        # Mac appscript returns a Reference for any attribute name, including
        # ones the scripting dictionary doesn't actually define; the wrong
        # name's .get() raises and we drop to None. Fall through to try the
        # other casing rather than giving up after the first miss.
    return None


def _resolve_lazy(value: Any) -> Any:
    """If ``value`` is an appscript-style lazy Reference, call ``.get()`` to
    fetch the underlying scalar. Otherwise return it as-is."""
    if value is None:
        return None
    if isinstance(value, (int, float, str, bool)):
        return value
    getter = getattr(value, "get", None)
    if callable(getter):
        try:
            return getter()
        except Exception:  # noqa: BLE001
            return None
    return value


# Excel constants for HorizontalAlignment (Windows COM).
_XL_HALIGN_GENERAL = 1
_XL_HALIGN_LEFT = -4131
_XL_HALIGN_CENTER = -4108
_XL_HALIGN_RIGHT = -4152

_INT_TO_ALIGN = {
    _XL_HALIGN_GENERAL: "general",
    _XL_HALIGN_LEFT: "left",
    _XL_HALIGN_CENTER: "center",
    _XL_HALIGN_RIGHT: "right",
}


def _normalise_alignment(raw: Any) -> Optional[str]:
    """Map a platform-specific alignment representation to a stable string.

    Recognises:
    - Python ints from Windows COM (xlHAlign* constants).
    - Python strs (e.g. 'left' / 'left align' / 'centerAlignment').
    - Appscript constants from Mac (rendered via ``str()`` as
      ``'k.left'`` / ``'k.center_align'`` etc.) and other non-string objects
      whose textual representation contains the alignment name.
    """
    if raw is None:
        return None
    if isinstance(raw, bool):
        # bool is a subclass of int in Python; the xl constants aren't bools.
        return None
    if isinstance(raw, int):
        return _INT_TO_ALIGN.get(raw)
    try:
        s = str(raw).lower().strip()
    except Exception:  # noqa: BLE001
        return None
    if not s:
        return None
    if "left" in s:
        return "left"
    if "right" in s:
        return "right"
    if "center" in s or "centre" in s:
        return "center"
    if "general" in s:
        return "general"
    return None


def _to_rows(value: Any) -> List[List[Any]]:
    """Coerce xlwings range.value to a 2-D list of cell values.

    xlwings returns a scalar for a 1×1 range, a flat list for a 1-row or
    1-column range, and a list of lists for a 2-D range. We normalise to 2-D
    so the frontend always receives the same shape.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        return [[_serialise(value)]]
    if not value:
        return []
    if not isinstance(value[0], list):
        return [[_serialise(v) for v in value]]
    return [[_serialise(v) for v in row] for row in value]


def _serialise(value: Any) -> Any:
    """Convert non-JSON-friendly types (datetime, etc.) to strings."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    return str(value)
