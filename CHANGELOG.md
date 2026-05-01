# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## 1.4.0 — 2026-05-02

Configurable page margin with smart-guide snap.

- **Page margin setting.** New `pageMargin` setting (0–80 mm, default 10) draws a faint dashed inner rectangle on each summary-mode page. Per-notebook value lives in `notebook.metadata.cell_layout.settings.page_margin`; the JL global default seeds new notebooks. Margin boxes are cosmetic on the canvas and hidden during PDF export via the existing `.jp-CellLayout-exporting` rule.
- **Smart-guide snap to margin.** When smart guides are on, the four margin edges of the active page join the snap-target set alongside cell edges/centres and page edges/centres (2 mm tolerance, soft snap — cells can be pulled through the margin). Defensive guard suppresses margin candidates when `margin*2 ≥ page width/height`, so a malformed margin can't invert the inner box. 5 new alignment-guide tests + 6 new metadata-normalize tests; 189 Jest tests pass overall.

## 1.3.1 — 2026-05-01

Edge auto-scroll while dragging cells in summary view.

- **Auto-scroll near canvas edges.** Drag a cell (single or multi-select group) within 50 px of the canvas viewport's top, bottom, left, or right edge and the canvas auto-scrolls toward that edge with a linear velocity ramp up to ~14 px/frame at the edge. The dragged cell stays glued to the cursor through the scroll: drag math now includes the live `scrollTop` / `scrollLeft` delta so a stationary cursor over a scrolling viewport still moves the cell.
- **Auto-grow page count at the bottom edge.** When the cursor pins the bottom edge of a fully-visible canvas with no remaining scroll room, a throttled `requestMorePageSpace` callback grows the page count by one (settings-only update — no full canvas refresh, drag stays alive). Same-frame reflow + retry handles the layout-deferral case where `scrollTop` would otherwise clamp against a stale `scrollHeight`.
- **Viewport edge clipping.** The scroll container's bounding rect can extend below the visible viewport when JL parents allow overflow off-screen; edges are now clipped to the window's visible region so bottom-edge scroll triggers reliably.

## 1.3.0 — 2026-04-30

Live ipywidgets rendering in summary view. mpl_interactions sliders, plotly charts, vega-lite plots, and any other rich mime type the JupyterLab renderer registry can handle now render as their proper interactive views in summary mode — not as static fallback images.

- **Live widget output.** `SummaryOutputCell` hands unhandled mime types off to JL's `IRenderMimeRegistry`. A dedicated `application/vnd.jupyter.widget-view+json` branch runs first so the live widget wins over the `image/png` static fallback that ipywidgets bundles alongside. The summary view and the notebook content view share the same kernel-side widget model via the comm channel — move a slider in either view and the other updates in lockstep.
- **Drag bypass for widget controls.** Pointerdown on any `.jupyter-widgets` element passes through to the widget rather than starting a cell drag, so sliders, dropdowns, and the ipympl figure canvas all work as expected. Drag still initiates from anywhere outside widget controls (cell label, drag-grip, empty cell area).
- **Auto-fit for asynchronous content.** Widgets render asynchronously after the kernel-side state arrives over the comm channel. A ResizeObserver on the slot body watches for the natural content size to settle, then resizes the slot once (capped at the same MAX_AUTO_FIT bounds as image auto-fit) and locks `auto_fit` off so the user can hand-resize from there.

Known limitation: every output of a single cell still goes into one slot (slot A for text, slot B for graphics). A cell with multiple `display()` calls — e.g. `mpl_interactions` producing figure + sliders + plumbing widget — stacks all three inside slot B, draggable as a unit. Splitting them into per-`display()` slots would need a schema extension; deferred for now.

## 1.2.0 — 2026-04-30

PDF cover sheet with optional table of contents, plus multi-cell selection and group operations.

- **Cover sheet.** New command `Cell Layout: Export to PDF with cover sheet…` opens a dialog (title / author / date / include-ToC checkbox) and prepends a vector-text title page to the PDF. When the ToC is enabled, every markdown heading gets one row — indented by level, dotted leader, right-aligned page number — and clicking a row in the PDF jumps to the heading's content page via a real internal link annotation. Continuation pages are added automatically when entries overflow. Last-used author persists across sessions via JL settings. The toolbar Export PDF button is unchanged (quick path, no dialog).
- **Multi-cell selection + group ops.** Shift-click slots to extend the selection. Drag on empty canvas to lasso cells with a marquee; shift+drag adds. Drag any selected slot → every selected cell moves together (snap targets exclude the whole selection so distances aren't locked at start). Bulk keyboard shortcuts: `Delete` / `Backspace` removes the selection from the canvas; `Cmd/Ctrl+]` brings selection to front; `Cmd/Ctrl+[` sends to back, preserving relative z-order in both. Esc clears. The old F5 pin is folded into selection (selection-of-1 looks identical to today's pinned highlight); F7 link (double-click) stays as the parallel single-cell quick-group.

## 1.1.0 — 2026-04-30

Heading-based table of contents in summary mode, plus a one-line PDF export fix that shrinks plot-heavy exports by ~100×.

- **Contents sidebar.** Summary mode gains a left-side ToC listing every markdown ATX heading on the canvas, indented by level (H1–H6) — same shape as JL's built-in ToC. Headings appear in PDF reading order. Click an entry to smooth-scroll to the cell that contains it. Editing a heading in summary mode live-updates the list. Toggle on/off with the new "Contents" toolbar button or `Cell Layout: Toggle contents sidebar` from the command palette.
- **PDF export now uses JPEG instead of PNG** for the per-page bitmap. Lossless PNG was producing exports up to 100× larger than they needed to be on plot-heavy notebooks (one user reported a 200 MB export drop to 2 MB after the change). JPEG quality 0.85 is the standard photographic sweet spot; the invisible-text overlay is what users search and select against, so any glyph ringing in the bitmap is harmless.

A vector-PDF rewrite was investigated and dropped — file size on plot-heavy notebooks is dominated by image pixels, not text glyphs, so the rewrite would have delivered a small benefit at high engineering cost. Bitmap + invisible-text overlay + JPEG remains the export pipeline.

## 1.0.0 — 2026-04-29

First stable release. Consolidates the v0.x line — page-oriented summary view, drag/resize, multi-page canvas, searchable PDF export with link annotations, editable summary mode, smart alignment guides, and the Mac-beta Excel range view — into a release suitable for general use.

Polish round added since v0.5.0 (`feat/v1-polish`):

- **F1** Shift+Enter / Cmd+Enter inside the summary editor runs the cell, matching edit-mode behaviour.
- **F2** Run button shows a busy state (orange ◐ pulse) while the cell executes.
- **F4** Newly-added cells are lifted to the top of the z-stack and pulse orange until the user moves, resizes, or edits them — easier to spot on a busy canvas. Their related output slots get a dashed-blue outline on hover.
- **F5** Click any cell to pin a solid green outline on its whole group (input + outputs); click elsewhere to clear. Useful when output slots have been positioned far from their input.
- **F6** Each pinned slot grows a small "→" go-to button that scrolls to and briefly highlights the next-related slot in the same group.
- **F7** Double-click a cell to *link* it for group drag — moves input and outputs together until you double-click again. Linked cells are outlined in dashed orange and float above other cells during drag (z-index 9999) so they stay visible.
- **Page-delete render-aware fix** — deleting a trailing empty page no longer silently re-grows the page count. `ensureEnoughPages` now uses the same render-aware iteration as `deletePageAt`, so empty output-slot metadata on a page doesn't count as "occupying" the page.

Pre-PyPI metadata work also landed: real `homepage` / `bugs` / `repository` URLs in `package.json`, optional `[excel]` extra in `pyproject.toml`, beta classifier, scientific-engineering topic, README rewritten for new users.

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
