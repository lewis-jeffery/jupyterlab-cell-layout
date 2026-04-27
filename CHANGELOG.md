# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## 0.5.0 — 2026-04-27

Editable summary mode. Summary view is no longer read-only — code cells can be edited and re-run in place, markdown cells flip between rendered and source-edit. Replaces the Excel-as-data-source pattern as the primary workflow.

- **Code cells** in summary mode now render via JL's CodeMirror editor (bound directly to the shared cell model), with full syntax highlighting. Click into a cell, change a value, the edit flows straight through to the original notebook cell.
- **Run button** (small green ▶, top-left of each code cell, hover-only) runs the cell via `CodeCell.execute` — same pathway as Shift+Enter in edit mode. Output area on the canvas refreshes within ~100 ms thanks to a debounced `outputs.changed` subscription on the canvas.
- **Markdown cells** keep their rendered MathJax-aware default; a small ✎ button (top-left, hover-only) flips into source-edit mode, ✓ flips back. Edits propagate via the shared model.
- **Drag grip**: a 6-px light-blue strip on the left edge of every summary cell (input, output, Excel) is the new explicit drag affordance, since the cell body is now claimed by the editor for typing. Drag still works from any non-editor area too.
- **Drag handler**: pointerdown switched to capture phase so clicks inside an embedded editor / button still register as cell interactions (so the mode-switch carryover from #38 keeps working). Bypasses for `.cm-editor`, `.jp-CellLayout-handle`, and any descendant `<button>` keep editing / resizing / Run / Excel-refresh clicks reaching their proper handlers.

## 0.4.0 — 2026-04-27

Excel range view (read-only mirror with live sync). Mac-only for now; Windows COM is required before any PyPI publish (tracked as #35).

- A layout cell can mirror an open Excel workbook's named range via xlwings. Read-only by design — summary mode is for distributing the document to readers who may not have the workbook.
- Set up via "Cell Layout: Mark active cell as Excel range view" in the command palette; the dialog asks for workbook / sheet / range and pre-fills "Sheet1" as the common Excel default.
- Right-click any rendered Excel cell in summary mode for **Edit Excel link…** (re-opens the dialog with current values) or **Clear Excel link** (removes the link in place).
- Kernel-side bridge: `from jupyterlab_cell_layout.excel_bridge import register; register()` once per kernel. Optional `poll_interval_s=` argument overrides the 1 s default.
- **Live sync**: in-Excel value or alignment edits propagate to the summary canvas within ~1 s without a refresh-button click. Persistent comm + daemon polling thread; pauses while user code is executing so xlwings polling doesn't compete with user xlwings calls.
- Per-cell horizontal alignment (left / center / right) from Excel renders in summary view; cells without explicit alignment fall back to the existing "numbers right, text left" default.
- PDF export waits for any in-flight Excel fetches before snapshotting the DOM, so the captured bitmap shows the rendered table rather than "Reading…".
- Bold / italic / font colour / cell fill colour are not yet readable on Mac because Excel for Mac's AppleScript bridge returns the `k.missing_value` sentinel for those properties (and doesn't expose `interior` at all). The comm-payload `formats` dict has the keys reserved; the Windows COM path will populate them under the same shape without a frontend change.

## 0.3.0 — 2026-04-27

- **Insert / delete pages in the middle of the summary canvas** (#40). Right-click any "Page N of M" badge in the bottom-right of a page → menu offers _Insert page above_, _Insert page below_, _Delete this page_. Insert shifts cells with top y ≥ boundary down by one page-height; delete shifts cells below up by one page-height. Delete refuses if any summary-mode cell currently *renders* on the page (matches the rendering rules so empty / unrouted output slots don't cause a false "page is occupied" error).
- **Idempotent `install.sh`**. Re-running the installer on an already-installed system no longer requires a manual `rm -rf` of the labextension share directory; the script now uninstalls + cleans orphaned labextension directories across all jupyter data paths before reinstalling.

## 0.2.0 — 2026-04-26

UX polish from real use:

- Eye / hide button on each cell (top-left, edit mode) and right-click context-menu item — both toggle whether the cell appears on the summary canvas. Existing `Ctrl+Shift+E` keyboard shortcut and palette command still work.
- More visible page break in summary mode — replaced the 1-px dashed line with a 12-px grey "gap" strip with subtle drop-shadows, sitting above cells so any cell straddling the boundary is visibly cut in half.
- Selection carries across mode switches — clicking a cell on the summary canvas and then switching to edit mode activates that cell in the notebook and scrolls it into view. If no cell was clicked, the notebook jumps to the top.
- LaTeX in markdown cells now renders in summary view. Fixed by attaching the renderer node to the DOM before calling `renderModel`, so JL's MathJax typesetter sees a node it can typeset; plus an explicit second-pass call to `latexTypesetter.typeset()` as a safety net.

## 0.1.0 — 2026-04-26

First stable release. Phases 1–3 delivered (core infrastructure, drag/resize/grid-snap/z-index, multi-page canvas + searchable PDF export). Phase 4 partially delivered: smart alignment guides shipped. Markdown link-click bug fixed.

<!-- <END NEW CHANGELOG ENTRY> -->
