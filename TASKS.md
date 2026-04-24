# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-25_

Legend: ✅ completed · 🟢 in progress · ⬜ available · 🔒 blocked

## 🎯 Milestones

- **Milestone 1**: Rendered Summary View — ✅ done
- **Milestone 2a**: Draggable cells — ✅ done
- **Milestone 2b**: Resizable cells — ✅ done
- **Milestone 2c**: Grid snap + z-index — ✅ done
- **Polish round 1**: Markdown rendering, image scaling, cell labels, overflow-clip code — ✅ done

## Phase status

- **Phase 1** ✅ fully delivered
- **Phase 2** ✅ fully delivered (+ polish round 1)
- **Phase 3** ⬜ available — PDF export, animations, performance, docs
- **Phase 4** 🔒 blocked — grid templates, bulk ops, advanced keyboard

## ✅ Completed

**Phase 1:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12

**Phase 2:** #13, #16, #17, #18, #19

**Polish round 1:**
- **#20** Code inputs use overflow-clip (drop visible_lines truncation)
- **#21** Output image aspect-ratio + slot-relative scaling
- **#22** Cell labels — replace hex with notebook position + slot letter
- **#23** Render markdown cells via IRenderMimeRegistry

## 🟢 In progress

_(none)_

## ⬜ Available

- **#14** Phase 3: Polish + PDF export

## 🔒 Blocked

- **#15** Phase 4: Advanced features — blocked by #14

## Design decisions (see Claude's memory for details; `CLAUDE.md` for spec)

1. Output A/B routing: text-ish → slot A, graphics → slot B, errors → A, emission order preserved.
2. Markdown/raw cells participate in layout as input-only (no output slots).
3. Summary vs edit mode is a notebook-wide toggle, not per-cell.
4. Layout canvas is page-oriented (A4 default, A3 option, portrait/landscape); desktop-only.
5. Coordinate units are millimetres.
6. Drag/resize locked while a cell executes; output content still streams live.
7. PDF reading order: left-to-right, top-to-bottom with optional counter badge.
8. Page-break straddle: push whole cell to next page; never split a cell.
9. A/B slot override UI deferred past v1.
10. Disabled output slots are hidden entirely (no canvas space).
