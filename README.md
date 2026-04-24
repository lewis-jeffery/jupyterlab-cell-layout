# jupyterlab-cell-layout

A JupyterLab 4 extension for drag-and-drop cell layout on a page-oriented canvas. Designed for engineering design documentation where a notebook's summary view doubles as a print-ready page.

## What it does

- **Summary mode** toggles an A4/A3 page view of the notebook. Cells render as draggable, resizable blocks with their input truncated to a configurable line count.
- **Two output slots per cell** — text-ish outputs (streams, HTML, tracebacks) route to slot A; graphics (images, SVG, plotly, widgets) route to slot B. Both slots are independently positioned and resized.
- **Portrait / landscape**, **page size** (A4 default, A3 option), **grid snap** — per-notebook, with JL settings as defaults for new notebooks.
- **Click-to-front** layering for overlapping cells.
- **Edit mode** is standard JupyterLab — no impact on regular notebook workflows. The summary layout lives in `notebook.metadata.cell_layout` as JSON, so standard JupyterLab installs open the notebook without issue.
- **Coordinate system** is page-oriented (mm), not viewport-relative. WYSIWYG with a future PDF export (Phase 3, not yet built).

See [CLAUDE.md](./CLAUDE.md) for the full design specification and [TASKS.md](./TASKS.md) for the current roadmap and completed work.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Toggle summary / edit mode | `Ctrl+Shift+T` |
| Toggle active cell inclusion | `Ctrl+Shift+E` |
| Show info dialog (debug) | Command palette: "Cell Layout: Show info (debug)" |

## Requirements

- Python 3.11+
- Node.js 18+ (LTS recommended)
- JupyterLab 4.3+

## Install (for testing)

Clone the repo and run the install script:

```bash
git clone https://github.com/lewis-jeffery/jupyterlab-cell-layout.git
cd jupyterlab-cell-layout
./install.sh
jupyter lab
```

The install script runs an editable `pip install` (which triggers the TypeScript/webpack build via `hatch-jupyter-builder`) and registers the extension as a development labextension in your current Python environment.

### Manual install

```bash
pip install --editable .
jupyter labextension develop . --overwrite
```

## Uninstall

```bash
pip uninstall jupyterlab_cell_layout
```

Also remove the symlink inside `$(jupyter --data-dir)/labextensions/jupyterlab-cell-layout` if it lingers.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full dev loop (watch mode, Jest, Playwright).

```bash
jlpm install
jlpm watch           # terminal 1: rebuild on change
jupyter lab          # terminal 2
jlpm test            # Jest unit tests
```

## Status

- **Phase 1 (core infrastructure)** — complete
- **Phase 2 (layout management: drag, resize, z-index, grid snap)** — complete
- **Phase 3 (PDF export, polish, docs)** — not started
- **Phase 4 (advanced features)** — not started

100 Jest unit tests passing; one Playwright acceptance test passing (rest blocked on an upstream Galata path-handling issue for programmatic notebook creation).

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
