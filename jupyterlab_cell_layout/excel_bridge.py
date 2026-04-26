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
    rows = _read_range(
        workbook=data.get("workbook"),
        sheet=data.get("sheet"),
        range_name=data.get("range"),
    )
    comm.send(
        {"type": "data", "request_id": request_id, "rows": rows}
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
        rows = _read_range(workbook, sheet, range_name)
        sub.last_value = rows
        comm.send(
            {"type": "data", "subscription_key": key, "rows": rows}
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
        rows = _read_range(sub.workbook, sub.sheet, sub.range_name)
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
    if rows == sub.last_value:
        return
    sub.last_value = rows
    sub.last_error = None
    try:
        sub.comm.send(
            {"type": "data", "subscription_key": sub.key, "rows": rows}
        )
    except Exception:  # noqa: BLE001
        # Comm gone — drop the subscription so we stop hammering it.
        with _state_lock:
            _subscriptions.pop((sub.comm_id, sub.key), None)


def _read_range(workbook, sheet, range_name) -> List[List[Any]]:
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

    return _to_rows(rng.value)


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
