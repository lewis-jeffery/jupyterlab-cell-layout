# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-26 (UX polish from real use)_

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

## 🟢 In progress (UX polish from real use)

- **#36** ✅ Eye / hide button on cells in edit mode + right-click context menu item, both toggling inclusion in summary view. Existing `Ctrl+Shift+E` and palette command stay.
- **#37** ⬜ More visible page break in summary mode — small physical gap between pages, not just a dashed line.
- **#38** ⬜ Cell selected in summary view should become the active cell when switching to edit mode (scroll into view + activate). If no selection, top of notebook.
- **#39** ⬜ LaTeX in markdown cells does not render in summary view (e.g. `$a_i = \sqrt{(y_i-y_{i+1})^2 + (x_i-x_{i+1})^2}$`). Likely MathJax not being triggered after rendermime renders the markdown node.
- **#40** ⬜ Insert / delete pages in the middle of the summary view (currently only append + remove-last). Should shift cells with `y > breakY` down (insert) or up (delete), clamped to canvas.
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
