"""Comm bridge between JupyterLab Cell Layout and xlwings.

Phase 1 (read-only): the JupyterLab frontend can request the values of a
named range from an open Excel workbook. Editing/two-way sync are not yet
implemented.

Usage from a notebook cell::

    from jupyterlab_cell_layout.excel_bridge import register
    register()

After ``register()`` is called, the labextension can open Comm channels to
this module and request range data. xlwings is imported lazily inside the
handler, so this module is importable without xlwings installed (the read
itself will fail with a helpful message in that case).
"""

from __future__ import annotations

from typing import Any, List

TARGET_NAME = "jupyterlab-cell-layout:excel"


def register() -> None:
    """Register the comm target on the active IPython kernel.

    Safe to call multiple times: re-registering replaces the previous handler.
    """
    try:
        ip = get_ipython()  # type: ignore[name-defined]
    except NameError as exc:  # pragma: no cover - happens outside ipython
        raise RuntimeError(
            "register() must be called from within an IPython kernel"
        ) from exc
    ip.kernel.comm_manager.register_target(TARGET_NAME, _on_open)


def _on_open(comm, _open_msg) -> None:
    @comm.on_msg
    def _on_msg(msg):
        data = (msg.get("content") or {}).get("data") or {}
        kind = data.get("type")
        request_id = data.get("request_id")
        try:
            if kind == "read":
                rows = _read_range(
                    workbook=data.get("workbook"),
                    sheet=data.get("sheet"),
                    range_name=data.get("range"),
                )
                comm.send(
                    {"type": "data", "request_id": request_id, "rows": rows}
                )
            else:
                _send_error(
                    comm,
                    request_id,
                    f"Unknown request type: {kind!r}",
                )
        except Exception as exc:  # noqa: BLE001 — errors flow back to UI
            _send_error(comm, request_id, f"{type(exc).__name__}: {exc}")


def _send_error(comm, request_id, message: str) -> None:
    comm.send(
        {"type": "error", "request_id": request_id, "message": message}
    )


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
