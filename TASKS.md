# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-25_

Legend: ✅ completed · 🟢 in progress · ⬜ available · 🔒 blocked

## 🎯 Milestones

- **Milestone 1**: Rendered Summary View — ✅ done
- **Milestone 2a**: Draggable cells — ✅ done
- **Milestone 2b**: Resizable cells — ✅ done
- **Milestone 2c**: Grid snap + z-index — ✅ done
- **Polish round 1**: Markdown rendering, image scaling, cell labels, overflow-clip code — ✅ done
- **Polish round 2**: Auto-fit slots to images, markdown links, output padding — ✅ done
- **Milestone 3a**: Multi-page canvas (page count, page-break guides, page numbers) — ✅ done

## Phase status

- **Phase 1** ✅ fully delivered
- **Phase 2** ✅ fully delivered
- **Phase 3** 🟡 in progress — 3a (multi-page canvas) done; 3b (PDF export), 3c (multi-page PDF), 3d (cover sheet), 3e (polish) remain
- **Phase 4** 🔒 blocked

## ✅ Completed

**Phase 1:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12

**Phase 2:** #13, #16, #17, #18, #19

**Polish round 1:** #20, #21, #22, #23

**Polish round 2:** #24

**Phase 3:** #25 (multi-page canvas)

## 🟢 In progress

_(none)_

## ⬜ Available

- **#14** Phase 3 rollup (PDF export, polish, docs)
- **#26** PDF cover sheet (title, author, date, optional ToC) — depends on #14

## 🔒 Blocked

- **#27** Summary-mode ToC sidebar (optional) — blocked by #26
- **#15** Phase 4: Advanced features — blocked by #14

## Phase map

- **Phase 1** ✅ done
- **Phase 2** ✅ done
- **Phase 3** in progress: #25 ✅ → #14 (PDF export) → #26 (cover sheet) → optional #27 (ToC sidebar)
- **Phase 4**: #15

## Design decisions (see Claude's memory for details; `CLAUDE.md` for spec)

1. Output A/B routing: text-ish → slot A, graphics → slot B, errors → A, emission order preserved.
2. Markdown/raw cells participate in layout as input-only (no output slots).
3. Summary vs edit mode is a notebook-wide toggle, not per-cell.
4. Layout canvas is page-oriented (A4 default, A3 option, portrait/landscape, 1–20 pages); desktop-only.
5. Coordinate units are millimetres.
6. Drag/resize locked while a cell executes; output content still streams live.
7. PDF reading order: left-to-right, top-to-bottom with optional counter badge.
8. Page-break straddle: push whole cell to next page; never split a cell. (Enforced at PDF export, not in editor.)
9. A/B slot override UI deferred past v1.
10. Disabled output slots are hidden entirely (no canvas space).
11. Slots auto-fit to image natural size on first render (outputs and markdown); auto_fit flag flips to false after first fit or any manual resize.
12. Multi-page canvas and ToC are coupled to PDF export work — build together to avoid double-work on page-break / reading-order interactions.
13. Empty output slots are suppressed at render time (don't show a placeholder box). Slot metadata persists; the slot reappears at its saved position when the cell next produces output.
