# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
