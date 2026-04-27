# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-27 (v0.4.0 shipped; editable-summary work begun)_

Legend: ✅ completed · 🟢 in progress · ⬜ available · 🔒 blocked · ⏸ deferred

## 🎯 Phase status

- **Phase 1** ✅ fully delivered (core infrastructure)
- **Phase 2** ✅ fully delivered (drag, resize, z-index, grid snap)
- **Phase 3** ✅ delivered (multi-page canvas + searchable PDF export + clickable markdown links). Optional sub-tasks (#26 cover sheet, #27 ToC sidebar) deferred.
- **Phase 4** 🔒 not started

## ✅ Completed

**Phase 1:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12

**Phase 2:** #13, #16, #17, #18, #19

**Polish round 1 (markdown rendering, image scaling, cell labels, overflow-clip code):** #20, #21, #22, #23

**Polish round 2 (auto-fit images on first render):** #24

**Phase 3 (multi-page canvas + PDF export, including searchable text overlay):** #14, #25, #29

**Link-click fix:** #28 — markdown links navigate from summary view and PDF annotations are clickable. Root cause was our own drag handler calling `preventDefault()` on pointerdown, which suppressed the synthesized click event for descendants; fix skips drag init when pointerdown lands on a navigable anchor.

**Smart alignment guides:** #30 — during drag and resize, snap to nearby cell edges and centres, plus active-page edges and centres. 2 mm tolerance. Same-page only. Smart-guide snap takes precedence over the grid; falls back to grid when no smart match. User-configurable via the `smartGuides` setting (default on). Resize snaps the moving edge only; centre candidates are excluded for resize.

**UX polish from real use (delivered to `main`):**

- **#36** ✅ Eye / hide button on cells in edit mode + right-click context menu item, both toggling inclusion in summary view.
- **#37** ✅ More visible page break in summary mode — 12-px grey "gap" strip with subtle drop-shadows, sitting above cells so any cell straddling the boundary is visibly cut in half. PDF export still hides the strip.
- **#38** ✅ Cell selected in summary view becomes the active cell when switching to edit mode (scrolled into view). No prior click → jump to the top.
- **#39** ✅ LaTeX in markdown cells now renders in summary view. Root cause: rendering into a detached node, so JL's MathJax typesetter had nothing to typeset. Fix attaches the renderer node before `renderModel`, plus an explicit `latexTypesetter.typeset()` safety pass.
- **#40** ✅ Insert / delete pages in the middle of the summary view. Right-click any "Page N of M" badge → menu offers _Insert page above_, _Insert page below_, _Delete this page_. Render-aware overlap check prevents false "page is occupied" errors when only empty output-slot metadata sits on the page.

## 🟢 In progress

**Editable summary view — code-cell-driven workflow (started 2026-04-27 on `feat/editable-summary`):** #42 — major architectural shift: summary mode becomes a place to edit + run code cells in place, not just view them. The user's intended workflow is to put data in code cells (rather than Excel) and adjust + re-run a few values directly in the summary view to iterate. Output already updates reactively through the existing `SummaryOutputCell` once the cell re-runs, so most of the wiring is on the input side.

Stages:
- **A** ⬜ Wire JL's CodeMirror editor into `SummaryInputCell` for code cells, read-only initially. Confirm the editor renders source with syntax highlighting and tracks model changes from edit-mode.
- **B** ⬜ Enable editing — confirm edits flow back through the shared cell model to the original notebook cell.
- **C** ⬜ Add a Run button (top-right of code cells); click → `CodeCell.execute(notebookCell, sessionContext)`. Surface busy/error states.
- **D** ⬜ Markdown cells get an "edit / rendered" toggle in the same place; rendered by default.
- **E** ⬜ Per-cell or per-notebook toggle so users with read-only summaries don't change behaviour. Default to enabled for new notebooks.
- **F** ⬜ Polish: editor sizing strategy (auto-grow vs scroll), focus handling, error states, keyboard execution shortcut (Shift+Enter).

Ships as v0.5.0 when complete.

**Excel range view — shipped in v0.4.0 (`main` at `08e8d8b`):** #31 — read-only mirror of an open Excel named range via xlwings, with live sync (~1 s) and per-cell horizontal alignment passthrough. Mac-only for now; Windows COM is a Phase 5 prerequisite for any PyPI publish.

⏳ **Excel — future phases:**
- **#32** ⏸ Phase 2 (editable sub-ranges) — **dropped**: real-use surfaced that Excel itself is awkward in this workflow. The editable-summary work (#42) supersedes the Excel-data path for the user's primary use case. Excel link remains available for genuinely-Excel-source-of-truth scenarios.
- **#33** ✅ Phase 3 (live sync via 1 s poll + diff push): persistent comm, kernel daemon polling thread, `subscribe` / `unsubscribe` / `read` message types, polling pauses while user code executes.
- **#34** 🟡 Phase 4 (formatting passthrough): **alignment shipped on Mac**. Bold / italic / font colour / fill colour are out of scope on Mac because Excel for Mac's AppleScript bridge returns the `k.missing_value` sentinel for `font.bold` / `font.color` (even per-cell) and doesn't expose a working `interior` property at all. The `formats` payload structure is in place — the Windows code path (#35) can populate the omitted fields without a frontend change. A possible Mac fallback is to read the saved `.xlsx` via `openpyxl` and watch the file mtime for changes; not implemented (means user must save in Excel before formatting changes propagate). Number formats and merged cells also deferred.
- **#35** ⬜ Phase 5: robustness (Excel-not-running affordance, debounced concurrent edits, **Windows COM `pythoncom.CoInitialize()` per polling thread — required before any PyPI publish**, and the `bold` / `italic` / `fg` / `bg` properties land here on Windows because COM exposes them properly).
- **#41** ⬜ Multi-cell select + move (drag-marquee, shift-click; "select all above/below active cell" command). Phase 4 item.

## ⏸ Deferred

- **#26** PDF cover sheet (title, author, date, optional ToC) — useful for large/formal documents; revisit when needed.
- **#27** Summary-mode ToC sidebar — depends on #26.

## 🔒 Blocked

- **#15** Phase 4: Advanced features (templates, bulk ops, advanced keyboard) — not blocked technically, just deferred until usage surfaces priority.

## Phase 4 — when there's appetite

The spec's Phase 4 list, with current relevance noted:

- **Layout templates** — save / apply layouts across notebooks. High value if user produces many similar reports.
- **Bulk operations** — drag-select multiple cells, move/resize/delete together. Becomes important once notebooks have ~10+ cells per page.
- **Keyboard navigation parity** — Tab/Shift-Tab to cycle, arrow keys to nudge, etc.
- **Already done in earlier phases:** grid snapping (#19), page-count controls.

## Notable design decisions (full details in Claude's memory; see `CLAUDE.md` for spec)

1. Output A/B routing: text-ish → slot A, graphics → slot B, errors → A, emission order preserved.
2. Markdown/raw cells participate in layout as input-only (no output slots).
3. Summary vs edit mode is a notebook-wide toggle, not per-cell.
4. Layout canvas is page-oriented (A4 default, A3 option, portrait/landscape, 1–20 pages); desktop-only.
5. Coordinate units are millimetres.
6. Drag/resize locked while a cell executes; output content still streams live.
7. PDF reading order: left-to-right, top-to-bottom with optional counter badge.
8. Page-break straddle: push whole cell to next page; never split a cell. (Enforced at PDF export time.)
9. A/B slot override UI deferred past v1.
10. Disabled output slots are hidden entirely (no canvas space).
11. Slots auto-fit to image natural size on first render (outputs and markdown); auto_fit flag flips to false after first fit or any manual resize.
12. Multi-page canvas and ToC are coupled to PDF export work — build together to avoid double-work on page-break / reading-order interactions.
13. Empty output slots are suppressed at render time. Slot metadata persists; the slot reappears at its saved position when the cell next produces output.
14. Page count auto-grows when cells extend past the current canvas. Auto-shrink is not done — page removal is user-initiated.
15. PDF export is bitmap-faithful with an invisible text overlay (rendering mode 3) for searchability + selection. Vector-text PDF is a future possibility.
