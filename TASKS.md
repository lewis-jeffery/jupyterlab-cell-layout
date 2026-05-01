# JupyterLab Cell Layout — Task List

_Last updated: 2026-05-02 (v1.4.0 shipped — configurable page margin with smart-guide snap, see P5. PyPI publish workstream still paused. Excel backlog closed.)_

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
- **P4** ✅ Edge auto-scroll during drag — shipped 2026-05-01. While dragging a cell (single or multi-select group), if the cursor enters within 50 px of the scroll container's top/bottom/left/right edge, the canvas auto-scrolls toward that edge at a velocity that ramps linearly from 0 (zone boundary) to ~14 px/frame (≈840 px/s, at the edge or past it). The dragged cell stays glued to the cursor through the scroll: `enableDrag` captures the scroll container's `scrollTop/Left` at drag-start and includes the live scroll delta in the cell's mm-position math, so a stationary cursor over a scrolling viewport still moves the cell. Three subtle fixes landed during the same session: (1) the scroll container's bounding rect can extend below the visible viewport when JL parents allow overflow off-screen, so edges are clipped to `[0, window.innerHeight]` / `[0, window.innerWidth]` — without this, top scroll worked but bottom didn't because `rect.bottom` sat off-screen and the cursor could never reach it; (2) page count is fixed during a drag, so a user dragging toward the bottom of a fully-visible canvas had nothing to scroll into — added `CellCoordinator.growPagesByOne()` (settings-only update; no full canvas refresh, drag stays alive) plus a throttled `requestMorePageSpace` callback plumbed through `IDragOptions` and the three cell-callback interfaces, wired in `summary-cell.ts` to grow the canvas while the cursor pins the bottom edge; (3) page-grow + scroll in the same rAF tick was hitting browser layout-deferral — `_page.style.height` got the new value but `scrollContainer.scrollHeight` hadn't reflowed before `scrollTop = beforeTop + vy` clamped against the stale max — added an explicit reflow (read `scrollContainer.scrollHeight`) followed by an in-frame retry, so the cell actually advances on the same tick the page is added rather than spending throttle budget on more page-grows. Files: `src/widgets/draggable.ts` (pure `computeAutoScrollVelocity` + rAF loop + viewport clipping + retry), `src/managers/cell-coordinator.ts` (`growPagesByOne`), `src/widgets/summary-{input,output,excel}-cell.ts` + `summary-cell.ts` (callback plumbing). 9 new Jest tests for the velocity helper; 178 total pass; build clean.
- **P5** ✅ Configurable page margin with smart-guide snap — shipped 2026-05-02 in v1.4.0. New `pageMargin` setting (0–80 mm, default 10 mm) seeded into new notebooks; persisted per-notebook at `metadata.cell_layout.settings.page_margin`. `LayoutCanvas._renderPageMargins` draws a faint dashed inner rectangle on each page (cosmetic; hidden in PDF export by the existing `.jp-CellLayout-exporting` rule). When smart guides are on, the four margin edges of the active page are added to the snap-target set in `alignment-guides.ts` — soft snap only, cells can be pulled through. Defensive `margin*2 < width/height` guard so a malformed margin can't invert the inner box. Files: `schema/plugin.json`, `src/managers/metadata.ts`, `src/widgets/alignment-guides.ts`, `src/widgets/layout-canvas.ts`, `src/index.ts`, `style/base.css`. 11 new Jest tests (6 metadata-normalize + 5 alignment-guide); 189 total pass.
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

## 📦 PyPI publish (paused 2026-04-30, mid-flow)

Goal: get `jupyterlab-cell-layout` 1.3.0 onto PyPI. Name confirmed available (PyPI JSON API returns 404 for both `jupyterlab-cell-layout` and `jupyterlab_cell_layout`). TestPyPI account just created.

**State on pause**

- **Working tree**: README.md modified, not committed. Diff: install section rewritten for `pip install jupyterlab-cell-layout` (drops Node.js prerequisite + GitHub `git+` URL); Excel section status changed from "Mac-only beta — Windows COM required before PyPI publish" to "macOS only; Windows not currently supported"; Status block matches; test count bumped 153 → 169; five relative links (`CONTRIBUTING.md`, `CLAUDE.md`, `CHANGELOG.md`, `TASKS.md`, `LICENSE`) rewritten as absolute `https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/...` URLs so PyPI's landing page resolves them.
- **Build artifacts**: `dist/jupyterlab_cell_layout-1.3.0-py3-none-any.whl` (549 KB) and `dist/jupyterlab_cell_layout-1.3.0.tar.gz` (560 KB), both freshly rebuilt against the updated README. `twine check` PASSED on both. Wheel ships labextension assets at `share/jupyter/labextensions/jupyterlab-cell-layout/` as expected.
- **Tooling**: `build`, `twine` (6.2.0), `hatch` (1.16.5) installed in the active anaconda Python 3.13 env.
- **Webpack warning** (cosmetic, ignore): `153.*.js` is 339 KB, exceeds webpack's 244 KB recommendation — that's the jspdf+html2canvas vendor chunk.

**Resume from here**

- **R1** ⬜ Verify TestPyPI account email + enable 2FA at https://test.pypi.org/manage/account/2fa/ (TestPyPI won't issue tokens without 2FA).
- **R2** ⬜ Generate an account-scoped TestPyPI token at https://test.pypi.org/manage/account/token/. Copy immediately (shown once). Project-scoped option only appears after first upload.
- **R3** ⬜ `twine upload --repository testpypi dist/*` (username `__token__`, password = the full token starting with `pypi-`). Either via `~/.pypirc`, env vars `TWINE_USERNAME`/`TWINE_PASSWORD`, or interactive prompt.
- **R4** ⬜ Smoke-test from TestPyPI in a fresh venv: `pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ jupyterlab-cell-layout` → `jupyter labextension list` should show `jupyterlab-cell-layout v1.3.0 enabled OK`. (The `--extra-index-url` pulls JupyterLab itself from real PyPI; TestPyPI doesn't mirror it.)
- **R5** ⬜ Once TestPyPI is happy: rotate to a project-scoped TestPyPI token, then create a real PyPI account, enable 2FA, generate an account-scoped token, `twine upload dist/*`. After first real upload, rotate to a project-scoped PyPI token.
- **R6** ⬜ `git tag v1.3.0 && git push --tags` (no tags exist on the repo currently).
- **R7** ⬜ Commit the README.md changes ("docs: README for PyPI landing page").
- **R8** ⏸ (optional, later) Set up the Jupyter Releaser GH Actions flow that `RELEASE.md` already references — needs `release` environment, `APP_PRIVATE_KEY` secret, `APP_ID` repo variable, and trusted publishing on PyPI.
- **R9** ⏸ (optional, later) conda-forge feedstock PR — usually picked up by a bot after first PyPI release.

**Decisions already made**

- README on PyPI advertises the macOS-only Excel feature as "macOS only; Windows not currently supported" — Windows COM was the old gate and is now closed (#35 won't-do).
- Wheel ships prebuilt labextension; users do **not** need Node.js. (`pyproject.toml`'s `hatch-jupyter-builder` hook only fires at build time, not install time.)
- Two-step token strategy: account-scoped for the first upload, then immediately rotate to project-scoped. Reduces blast radius if a token leaks.
- TestPyPI before real PyPI. TestPyPI also expires uploads, so don't rely on it for archival.

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
