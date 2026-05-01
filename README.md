# jupyterlab-cell-layout

A JupyterLab 4 extension that turns a notebook into a page-oriented summary view — drag and resize cells onto A4 / A3 pages, edit and re-run them in place, and export the layout as a searchable PDF. Designed for engineering design documentation where the same notebook serves both as a working document and as a print-ready deliverable.

## Highlights

- **Two views, one notebook.** Toggle between standard JupyterLab editing (`Ctrl+Shift+T`) and a page-oriented summary canvas. Layout state lives in `notebook.metadata.cell_layout`; vanilla JupyterLab installs open the file without issue.
- **Editable summary mode.** Code cells render through JupyterLab's CodeMirror editor — type into them, press `Shift+Enter` (or click the green Run button), and outputs refresh in place. Markdown cells flip between rendered (with MathJax) and source-edit.
- **Two output slots per cell.** Text-ish outputs (streams, HTML, tracebacks) go to slot A; graphics (PNG, SVG, plotly, widgets) go to slot B. Each slot is independently positioned, resized, and clipped.
- **Page-oriented canvas.** A4 (default) or A3, portrait or landscape, 1–20 pages. 5 mm grid snap with smart alignment guides (snap to neighbouring cell edges and centres within 2 mm). All coordinates stored in millimetres.
- **Searchable PDF export.** `html2canvas` + `jspdf` produces a bitmap-faithful PDF of the canvas with an invisible text overlay so PDF readers can search and select. Markdown links are emitted as clickable PDF link annotations. Cells that would straddle a page break are pushed whole to the next page.
- **Excel range view (optional, Mac-only beta).** A summary cell can mirror a named range from an open Excel workbook via xlwings, with ~1 s live sync. Read-only — editing happens in Excel itself. See [Excel range view](#excel-range-view-optional) below.

## Install

Requires JupyterLab 4.3+, Python 3.10+, and Node.js 18+ (needed at install time to build the labextension assets).

PyPI publish is in progress; until then, install directly from GitHub:

```bash
pip install "git+https://github.com/lewis-jeffery/jupyterlab-cell-layout.git@v1.3.1"
```

Pin to a release tag (as above) for reproducibility, or omit `@v1.3.1` to track `main`. The `pip install` step triggers the TypeScript / webpack build via `hatch-jupyter-builder`, so Node.js must be on `PATH`.

To upgrade an existing install:

```bash
pip install --upgrade --force-reinstall --no-deps "git+https://github.com/lewis-jeffery/jupyterlab-cell-layout.git@v1.3.1"
```

`--force-reinstall --no-deps` ensures the labextension assets are rebuilt without re-resolving JupyterLab itself. Restart JupyterLab afterwards. Open any notebook — a toolbar group (mode toggle, orientation, page count, export PDF) appears at the right of the notebook toolbar.

For a hackable checkout, see [Development install](#development-install) below.

### Upgrading from a development install

If you previously ran `./install.sh` (an editable install) and now want to switch to a fresh release install, pip's uninstall step can fail with `OSError: [Errno 2] No such file or directory: .../share/jupyter/labextensions/jupyterlab-cell-layout/package.json` — the dev tree's labextension symlink has gone stale, pip can't follow its own RECORD, and the new install rolls back. Clean the prior state first:

```bash
# from a checkout of this repo:
./scripts/clean-install.sh
pip install --no-deps "git+https://github.com/lewis-jeffery/jupyterlab-cell-layout.git@v1.3.1"

# or, without a checkout, run the equivalent inline:
pip uninstall -y jupyterlab_cell_layout
python3 -c "
import shutil
from pathlib import Path
from jupyter_core.paths import jupyter_path
for base in jupyter_path():
    p = Path(base) / 'labextensions' / 'jupyterlab-cell-layout'
    if p.is_symlink(): p.unlink()
    elif p.exists(): shutil.rmtree(p, ignore_errors=True)
"
pip install --no-deps "git+https://github.com/lewis-jeffery/jupyterlab-cell-layout.git@v1.3.1"
```

## Quick tour

1. Open a notebook in JupyterLab.
2. Click **Edit mode** in the toolbar (or press `Ctrl+Shift+T`) to flip to summary mode. Cells appear as movable blocks on an A4 canvas.
3. Drag a cell by its left-edge grip strip; drag any of its eight resize handles to resize. Click any slot of a cell to bring the whole cell group to the front.
4. Click into a code cell to edit it; press `Shift+Enter` or the green ▶ button to run. Output appears in slot A or B and refreshes within ~100 ms.
5. Double-click a cell to *link* it for group drag — its inputs and outputs move together until you double-click again.
6. Right-click a "Page N of M" badge in the bottom-right of any page for *Insert page above / below / Delete this page*. Whole-page operations shift cells below the boundary by one page-height.
7. Click **Export PDF** to save `{notebook-name}.pdf` of the current layout.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Toggle summary / edit mode | `Ctrl+Shift+T` |
| Toggle whether the active cell is included in summary view | `Ctrl+Shift+E` |
| Append a page | `Ctrl+Shift+]` |
| Remove the last page | `Ctrl+Shift+[` |
| Run the active code cell from inside the summary editor | `Shift+Enter` or `Cmd+Enter` |

The command palette also exposes: orientation toggle, export PDF, mark/clear Excel link, insert/delete page, and a debug "show layout info" command.

## Settings

Available in JupyterLab's *Advanced Settings Editor* under *Cell Layout*:

| Setting | Default | Notes |
| --- | --- | --- |
| `pageSize` | `"A4"` | `"A4"` or `"A3"` — applied to brand-new notebooks |
| `orientation` | `"portrait"` | `"portrait"` or `"landscape"` |
| `gridSnap` | `5` | Grid snap step in millimetres |
| `defaultSummaryLines` | `3` | Retained for back-compat; not used at render time |
| `showReadingOrderBadges` | `true` | Numbered badges on cells in PDF export |
| `smartGuides` | `true` | Snap to nearby cell / page edges and centres |

These are global defaults seeded into a brand-new notebook's metadata. Existing notebooks keep whatever they have.

## Excel range view (optional)

A summary cell can mirror a named range from an open Excel workbook. Useful when the source-of-truth lives in Excel and you want it on the page next to your code-driven results.

**Status:** macOS only (xlwings via AppleScript). Windows is not currently supported.

Install xlwings into the same Python environment as your kernel:

```bash
pip install "jupyterlab-cell-layout[excel]"
```

Then once per kernel session:

```python
from jupyterlab_cell_layout.excel_bridge import register
register()                        # default 1 s poll interval
```

Right-click any cell in summary mode and choose *Mark active cell as Excel range view*. Enter workbook / sheet / range. The cell now mirrors the named range live with horizontal alignment passthrough. Editing happens in Excel; summary view refreshes within ~1 s.

Bold / italic / font colour / fill colour are not yet read on Mac because Excel for Mac's AppleScript bridge returns `k.missing_value` for those properties. The Windows COM path will populate them under the same comm-payload shape.

## Development install

```bash
git clone https://github.com/lewis-jeffery/jupyterlab-cell-layout.git
cd jupyterlab-cell-layout
./install.sh
jupyter lab
```

`install.sh` runs an editable `pip install` (which triggers the TypeScript / webpack build via `hatch-jupyter-builder`) and registers the extension as a development labextension. Re-running it on an already-installed system is idempotent — orphaned labextension symlinks across all `jupyter --paths` data dirs are cleaned up first.

### Watch mode

```bash
jlpm install
jlpm watch           # terminal 1: rebuild on change
jupyter lab          # terminal 2
```

### Tests

```bash
jlpm test            # Jest unit tests (189 currently)
```

Playwright integration tests live in `ui-tests/`. One acceptance test reliably passes; the rest are blocked on an upstream Galata path-handling issue when programmatically creating notebooks.

See [CONTRIBUTING.md](https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/CONTRIBUTING.md) for the full dev loop and [CLAUDE.md](https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/CLAUDE.md) for the technical specification.

## Status

- **Phase 1** (core infrastructure) — ✅ delivered
- **Phase 2** (drag, resize, z-index, grid snap, smart guides) — ✅ delivered
- **Phase 3** (multi-page canvas + searchable PDF export with link annotations) — ✅ delivered
- **Phase 4** (templates, bulk operations, full keyboard navigation) — partial; smart guides shipped, rest deferred
- **Editable summary mode** — ✅ delivered (v0.5.0)
- **Excel range view** — ✅ macOS (read-only with live sync); Windows not supported

189 Jest unit tests passing. See [CHANGELOG.md](https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/CHANGELOG.md) for release history and [TASKS.md](https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/TASKS.md) for the live roadmap.

## License

BSD-3-Clause. See [LICENSE](https://github.com/lewis-jeffery/jupyterlab-cell-layout/blob/main/LICENSE).
