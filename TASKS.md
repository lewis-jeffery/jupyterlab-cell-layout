# JupyterLab Cell Layout — Task List

_Last updated: 2026-04-30 (v1.3.0 shipped — live widget rendering for ipywidgets/mpl_interactions/plotly etc. P3 keyboard nav is the only remaining tracked item. Excel backlog closed.)_

Legend: ✅ completed · 🟢 in progress · ⬜ available · 🔒 blocked · ⏸ deferred · ❌ won't-do

## 🎯 Phase status

- **Phase 1** ✅ fully delivered (core infrastructure)
- **Phase 2** ✅ fully delivered (drag, resize, z-index, grid snap)
- **Phase 3** ✅ delivered (multi-page canvas + searchable PDF export + clickable markdown links). #26 cover sheet and #27 ToC sidebar moved into the active track below.
- **Phase 4** 🟢 in progress — see "Active track" below.

## 🟢 Active track (post-v1.0.0)

Two threads run in this order: PDF cover sheet → Phase 4 polish (multi-select / templates / keyboard nav). Polish items interleave.

- **T1** ✅ Summary-mode ToC sidebar (#27) — **heading-based, JL-style**. One entry per markdown ATX heading (H1–H6); indented by level; right-aligned page number hint. Headings ordered by PDF reading order (page bucket → row-major within page → x within a row). CommonMark-style: no space after `#` is not a heading; 7+ hashes is not a heading; fenced-code-block contents skipped. Click → smooth-scroll the cell containing the heading to near the top of the canvas viewport. Empty state: "No headings on the canvas. Add a markdown cell with `# Title`...". Toggle via toolbar button "Contents / No contents" (session-scoped) or command palette _Cell Layout: Toggle contents sidebar_. Implementation: `src/widgets/toc-sidebar.ts` (pure DOM widget + `buildTocHeadings` pure function with 13 Jest tests); `LayoutCanvas` mounts/unmounts the sidebar; refresh on (a) full canvas refresh, (b) `coordinator.layoutChanged` (drag/resize repositions cells across pages), (c) per-cell `sharedModel.changed` debounced at 300 ms (typing into a markdown cell live-updates the ToC). Sidebar hidden in PDF export — html2canvas captures only `.jp-CellLayout-page`, the sidebar sits as a sibling.
- **V1/V2/V3** ❌ Vector PDF — **dropped 2026-04-30 after user-side spike comparison**. Spike (`pdf-export-vector.ts`, since deleted) used html2canvas `onclone` to suppress glyphs in the bitmap and emitted `pdf.text()` per DOM element. On the user's plot-heavy 17-page notebook, file size **did not shrink** (bitmap was already dominated by plot images, not text) and per-element chunk-splitting produced **scattered text** (would need per-text-node `Range` + character-offset math to fix properly). Verdict: not worth the engineering effort given the file-size win doesn't materialise on real workloads. Bitmap + invisible-text overlay stays as the export pipeline. Spike code removed.
- **JPEG fix** ✅ shipped 2026-04-30 (was the right answer to the 200 MB problem). `src/exporters/pdf-export.ts`: `image/png` → `image/jpeg` at quality 0.85. Plot-heavy notebooks should shrink ~10–20×. Sharp-text edges may show very mild ringing; the invisible-text overlay is what users search/select so readability is unaffected.
- **T2** ✅ PDF cover sheet (#26) — shipped 2026-04-30. New command _Cell Layout: Export to PDF with cover sheet…_ opens a dialog (title default = notebook basename; author default = last-used; date default = today as "DD Month YYYY"; include-ToC checkbox default on). Cover page renders in vector text via jsPDF directly (title centred + bold, author + date below a thin rule). When include-ToC is on, ToC pages follow with one row per markdown heading: indented by level, dotted leader between heading text and right-aligned page number, clickable internal-link annotation per row pointing at the target content page. Continuation pages added automatically when entries overflow ("Contents (continued)" header). Last-used author persists via JL settings registry (`lastAuthor`). Files: `src/exporters/cover-sheet.ts` (new — pure jsPDF rendering + `formatCoverDate` helper), `src/managers/toc.ts` (new — extracted `buildTocHeadings` so the exporter can use it without importing widget code), `src/exporters/pdf-export.ts` (extended `IExportOptions` with `cover` + `tocHeadings`; renders cover/ToC before content; offsets text-overlay + link-rect page numbers). Toolbar Export PDF unchanged (quick path, no cover). 169 tests pass (added 3 for `formatCoverDate`).
- **P1** ✅ Multi-cell selection + group ops (was #41) — shipped 2026-04-30. Selection is a `Set<cellId>` on `LayoutCanvas`. Click a slot → selection = {that cell} (only when not already in selection, so multi-cell groups stay intact when you click a member). Shift-click → toggle membership; suppresses drag init in the same gesture. Drag on empty canvas → marquee (3 px movement threshold; semi-transparent blue rect; cells whose any slot overlaps the marquee become the new selection). Shift+drag-marquee → adds to selection. Single click on empty area without movement → clears selection (and link). Esc clears selection (and link). Multi-cell drag uses the existing `getSiblings` mechanism in `enableDrag` — every slot of every other selected cell is attached as a drag sibling, plus the dragged cell's own intra-cell siblings (input + outputs) when in selection (selection-of-1 still doesn't intra-group-drag, preserving the old pin behaviour). Snap-target collection excludes all selected cells during a multi-cell drag so distances aren't locked at start. Bulk ops via keyboard: Delete / Backspace removes the selection from the canvas (toggles inclusion off; `onInclusionChanged` callback syncs edit-mode eye toggles); Cmd/Ctrl+] brings selection to front preserving relative z-order; Cmd/Ctrl+[ sends to back, re-basing all z-indexes to 1+ in the process. F5 (pin) folded into selection; F7 (link, double-click) stays as a parallel single-cell quick-group concept.
- **P2** ⏸ Layout templates — deferred 2026-04-30. User reviewed the design (browser download/upload, map-by-index, 3 starter templates) and concluded "not sure I'd use this much". Pushed past the next idea; revisit if usage patterns change. Original design: save layout to `.cell-layout-template.json` (settings + per-cell-by-index); apply via file picker; ship 2–3 starter templates.
- **P3** ⬜ Keyboard navigation parity: Tab/Shift+Tab through reading order; arrow nudge 1 mm (5 mm with Shift); Delete removes from canvas; Esc clears.
- **W1** ✅ Live widget output rendering (mpl_interactions, ipywidgets, plotly, vega) — shipped in v1.3.0. Passes `IRenderMimeRegistry.createRenderer` for unhandled mime types in `SummaryOutputCell`, with a dedicated `tryRenderWidgetView` branch that runs first for `application/vnd.jupyter.widget-view+json` (preferred over the static `image/png` fallback ipywidgets bundles alongside). ResizeObserver-based auto-fit kicks in once async widget content settles, sized to MAX_AUTO_FIT_* caps. Widgets unsubscribe from comm channels on rebuild + dispose via tracked `_activeRenderers`. `draggable.ts` skips drag init for clicks landing on `.jupyter-widgets` elements so sliders, buttons, ipympl canvas all pass through to the widget. `OutputProcessor.GRAPHICS_MIMETYPES` already includes widget-view (no change). Files modified: `src/widgets/summary-output-cell.ts`, `src/widgets/summary-cell.ts`, `src/widgets/draggable.ts`. 169 tests pass; build clean. Verified end-to-end on a real `mpl_interactions` notebook — sliders render, slider movement updates the chart, both views (summary + edit) stay in sync via the shared comm. Multiple `display()` calls in one cell still stack inside slot B (one slot per cell pair, `output_a` text + `output_b` graphics); user evaluated splitting across cells (broken by cell-re-execution closure staleness) and a schema extension to N slots per cell, then chose to live with the stacking.

## ⏸ Considered but parked

- **N-slot-per-cell schema extension.** Surfaced when investigating widget rendering — multi-`display()` cells (e.g. mpl_interactions producing figure + slider + plumbing widget) all collapse into slot B today. Extending the schema to allow each `display()` its own slot would make them independently draggable. ~2 sessions: relax `OutputSlotId` from `'output_a' | 'output_b'` to a string, change routing to one-output-per-slot, default-layout placement for N slots, drag/resize/group-drag wiring already works per slot, PDF reading-order through N slots. User chose to live with stacking on 2026-04-30.

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

**v1.0.0 shipped 2026-04-29:** `main` at `fafe58b`, tagged `v1.0.0`, pushed.

**Editable summary view — code-cell-driven workflow:** #42 ✅ Shipped in v0.5.0 (stages A–D) and refined in `feat/v1-polish` (stages F1–F7).

- **A** ✅ CodeMirror in `SummaryInputCell` for code cells.
- **B** ✅ Edits flow through the shared cell model.
- **C** ✅ Run button (green ▶) executes via `CodeCell.execute`. Reactive output refresh ~100 ms.
- **D** ✅ Markdown ✎/✓ edit/render toggle.
- **E** ⏸ Dropped — editable mode is on by default; read-only kept as a future per-notebook toggle if anyone needs it.
- **F1** ✅ Shift+Enter / Cmd+Enter from inside the summary editor.
- **F2** ✅ Run button busy-state pulse.
- **F3** ⏸ Auto-grow code cell — reverted; not necessary in practice.
- **F4** ✅ Newly-added cells lifted + pulse highlight + hover-link related slots.
- **F5** ✅ Click-to-pin solid green outline on the active cell's group.
- **F6** ✅ Per-pinned-slot "→" go-to-next-related-slot button.
- **F7** ✅ Double-click to link a cell for group drag.

**Excel range view — shipped in v0.4.0:** #31 — read-only mirror of an open Excel named range via xlwings, with live sync (~1 s) and per-cell horizontal alignment passthrough. **Mac-only.** Editable-summary work (#42) supersedes the Excel-data path for the primary use case; remaining Excel backlog closed (see ❌ won't-do).

## ❌ Won't-do (closed 2026-04-30)

The Excel backlog is closed because the editable-summary workflow (#42) now covers the user's primary use case better than an Excel-as-source-of-truth model. The shipped Excel range view (#31, v0.4.0) remains in the codebase for genuinely-Excel-source scenarios; no further phases are planned.

- **#32** ❌ Phase 2 — Excel editable sub-ranges.
- **#33** Already shipped (kept above for completeness).
- **#34** ❌ Phase 4 — formatting passthrough beyond alignment.
- **#35** ❌ Phase 5 — Excel robustness, including the Windows COM `CoInitialize` fix that was previously gating PyPI publish. **PyPI gating is now just "is it ready?" rather than waiting on Windows Excel.**
- **#41** moved to **P1** in the active track above.

## 🔒 Blocked

- **#15** Phase 4 (templates / bulk ops / keyboard) — superseded by the active P1/P2/P3 tasks above.

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
