# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-26_

Legend: ✅ completed · 🟢 in progress · ⬜ available · 🔒 blocked · ⏸ deferred

## 🎯 Phase status

- **Phase 1** ✅ fully delivered (core infrastructure)
- **Phase 2** ✅ fully delivered (drag, resize, z-index, grid snap)
- **Phase 3** ✅ core scope delivered (multi-page canvas + PDF export). Optional sub-tasks (#26 cover sheet, #27 ToC sidebar) and one deferred bug (#28 link clicks) remain.
- **Phase 4** 🔒 blocked

## ✅ Completed

**Phase 1:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12

**Phase 2:** #13, #16, #17, #18, #19

**Polish round 1 (markdown rendering, image scaling, cell labels, overflow-clip code):** #20, #21, #22, #23

**Polish round 2 (auto-fit images on first render):** #24

**Phase 3 (multi-page canvas + PDF export):** #14, #25

## ⏸ Deferred

- **#28** Markdown links don't navigate in summary view or PDF. Four fixes attempted; document-level handlers don't even fire — JupyterLab/Lumino is suppressing pointer/click events for content inside the overlay canvas. Best-effort mousedown listener left in code. Not blocking; user flagged 2026-04-26 as costing more to fix than it's worth right now.

## ⬜ Available

- **#26** PDF cover sheet (title, author, date, optional ToC) — ~half a day's work; auto-generates a title page from notebook metadata. Not started.

## 🔒 Blocked

- **#27** Summary-mode ToC sidebar (optional) — blocked by #26
- **#15** Phase 4: Advanced features (templates, bulk ops, advanced keyboard) — blocked by #26 (so all of Phase 3 finishes first)

## Phase map

- **Phase 1** ✅ done
- **Phase 2** ✅ done
- **Phase 3** ✅ core done · #26 + #27 optional · #28 deferred
- **Phase 4**: #15

## Design decisions (see Claude's memory for details; `CLAUDE.md` for spec)

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
13. Empty output slots are suppressed at render time (don't show a placeholder box). Slot metadata persists; the slot reappears at its saved position when the cell next produces output.
14. Page count auto-grows when cells extend past the current canvas. Auto-shrink is not done — page removal is user-initiated (shift-click on the page-count toolbar button or Ctrl+Shift+[).
