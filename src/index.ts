import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ToolbarButton } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import {
  ISettingRegistry,
  type ISettingRegistry as ISettingRegistryType
} from '@jupyterlab/settingregistry';
import { BoxLayout } from '@lumino/widgets';

import { showLayoutInfoDialog } from './demo/info-dialog';
import { exportToPdf, PdfExportError } from './exporters/pdf-export';
import { CellCoordinator } from './managers/cell-coordinator';
import {
  LAYOUT_METADATA_KEY,
  MetadataManager,
  type PageOrientation,
  type PageSize
} from './managers/metadata';
import { LayoutCanvas } from './widgets/layout-canvas';

const COMMAND_TOGGLE_MODE = 'jupyterlab-cell-layout:toggle-mode';
const COMMAND_TOGGLE_ORIENTATION =
  'jupyterlab-cell-layout:toggle-orientation';
const COMMAND_TOGGLE_CELL_INCLUSION =
  'jupyterlab-cell-layout:toggle-cell-inclusion';
const COMMAND_ADD_PAGE = 'jupyterlab-cell-layout:add-page';
const COMMAND_REMOVE_PAGE = 'jupyterlab-cell-layout:remove-page';
const COMMAND_EXPORT_PDF = 'jupyterlab-cell-layout:export-pdf';
const COMMAND_SHOW_INFO = 'jupyterlab-cell-layout:show-info';

const MAX_PAGES = 20;
const CSS_SUMMARY_MODE = 'jp-CellLayout-summaryMode';

interface IUserDefaults {
  pageSize: PageSize;
  orientation: PageOrientation;
  smartGuides: boolean;
}

const userDefaults: IUserDefaults = {
  pageSize: 'A4',
  orientation: 'portrait',
  smartGuides: true
};

interface INotebookState {
  manager: MetadataManager;
  coordinator: CellCoordinator;
  canvas: LayoutCanvas;
  modeButton: ToolbarButton;
  orientationButton: ToolbarButton;
  pageCountButton: ToolbarButton;
  exportButton: ToolbarButton;
}

const state = new WeakMap<NotebookPanel, INotebookState>();

function isSummaryMode(manager: MetadataManager): boolean {
  return manager.read().settings.notebook_mode === 'summary';
}

function applyMode(panel: NotebookPanel, summary: boolean): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  if (summary) {
    panel.node.classList.add(CSS_SUMMARY_MODE);
    panel.content.hide();
    s.canvas.show();
    s.canvas.refresh();
  } else {
    panel.node.classList.remove(CSS_SUMMARY_MODE);
    s.canvas.hide();
    panel.content.show();
  }
  updateModeButtonLabel(s.modeButton, summary);
  updateOrientationButtonLabel(
    s.orientationButton,
    s.manager.read().settings.orientation
  );
}

function updateModeButtonLabel(button: ToolbarButton, summary: boolean): void {
  const labelEl = button.node.querySelector('.jp-ToolbarButtonComponent-label');
  if (labelEl) {
    labelEl.textContent = summary ? 'Summary mode' : 'Edit mode';
  }
}

function updateOrientationButtonLabel(
  button: ToolbarButton,
  orientation: PageOrientation
): void {
  const labelEl = button.node.querySelector('.jp-ToolbarButtonComponent-label');
  if (labelEl) {
    labelEl.textContent =
      orientation === 'landscape' ? 'Landscape' : 'Portrait';
  }
}

function toggleMode(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const current = isSummaryMode(s.manager);
  const next = !current;
  s.manager.update(layout => ({
    ...layout,
    enabled: next || layout.enabled,
    settings: {
      ...layout.settings,
      notebook_mode: next ? 'summary' : 'edit'
    }
  }));
  applyMode(panel, next);
}

const INCLUDE_TOGGLE_CLASS = 'jp-CellLayout-includeToggle';

const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_CLOSED_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function setInclusionVisuals(
  cellNode: HTMLElement,
  button: HTMLButtonElement | null,
  mode: 'summary' | 'edit'
): void {
  const excluded = mode === 'edit';
  cellNode.classList.toggle('jp-CellLayout-cellExcluded', excluded);
  if (button) {
    button.classList.toggle(`${INCLUDE_TOGGLE_CLASS}--excluded`, excluded);
    button.innerHTML = excluded ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
    button.title = excluded
      ? 'Click to include this cell in the summary view'
      : 'Click to exclude this cell from the summary view';
    button.setAttribute(
      'aria-label',
      excluded ? 'Include cell in summary' : 'Exclude cell from summary'
    );
    button.setAttribute('aria-pressed', String(excluded));
  }
}

function ensureIncludeToggleButton(
  panel: NotebookPanel,
  cellNode: HTMLElement,
  cellId: string
): HTMLButtonElement {
  const existing = cellNode.querySelector(
    `:scope > .${INCLUDE_TOGGLE_CLASS}`
  ) as HTMLButtonElement | null;
  if (existing) {
    return existing;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = INCLUDE_TOGGLE_CLASS;
  // Stop event propagation so clicking the toggle doesn't activate / move
  // focus to the cell. JL uses pointerdown for cell selection.
  for (const evt of ['pointerdown', 'mousedown'] as const) {
    btn.addEventListener(evt, e => e.stopPropagation());
  }
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    toggleCellInclusionById(panel, cellId);
  });
  cellNode.appendChild(btn);
  return btn;
}

function toggleCellInclusionById(panel: NotebookPanel, cellId: string): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  s.coordinator.toggleCellInclusion(cellId);
  refreshCellAffordances(panel);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function toggleActiveCellInclusion(panel: NotebookPanel): void {
  const activeCell = panel.content.activeCell;
  if (!activeCell) {
    return;
  }
  toggleCellInclusionById(panel, activeCell.model.id);
}

function refreshCellAffordances(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const layout = s.manager.read();
  for (const cellWidget of panel.content.widgets) {
    const cellId = cellWidget.model.id;
    const mode = layout.cells[cellId]?.mode ?? 'summary';
    const button = ensureIncludeToggleButton(panel, cellWidget.node, cellId);
    setInclusionVisuals(cellWidget.node, button, mode);
  }
}

async function exportCurrentNotebookToPdf(panel: NotebookPanel): Promise<void> {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const pageEl = s.canvas.node.querySelector(
    '.jp-CellLayout-page'
  ) as HTMLElement | null;
  if (!pageEl) {
    console.warn('jupyterlab-cell-layout: no page element to export');
    return;
  }
  try {
    const filename = await exportToPdf(panel, s.manager, pageEl);
    console.log(`jupyterlab-cell-layout: exported ${filename}`);
  } catch (err) {
    if (err instanceof PdfExportError) {
      window.alert(err.message);
    } else {
      console.error('jupyterlab-cell-layout: PDF export failed', err);
      window.alert(`PDF export failed: ${(err as Error).message ?? err}`);
    }
  }
}

function changePageCount(panel: NotebookPanel, delta: number): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const current = s.manager.read().settings.page_count;
  const next = Math.max(1, Math.min(MAX_PAGES, current + delta));
  if (next === current) {
    return;
  }
  s.manager.update(layout => ({
    ...layout,
    settings: { ...layout.settings, page_count: next }
  }));
  updatePageCountButtonLabel(s.pageCountButton, next);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function updatePageCountButtonLabel(
  button: ToolbarButton,
  count: number
): void {
  const labelEl = button.node.querySelector('.jp-ToolbarButtonComponent-label');
  if (labelEl) {
    labelEl.textContent = `${count} page${count === 1 ? '' : 's'}`;
  }
}

function toggleOrientation(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const current = s.manager.read().settings.orientation;
  const next: PageOrientation =
    current === 'landscape' ? 'portrait' : 'landscape';
  s.manager.update(layout => ({
    ...layout,
    settings: { ...layout.settings, orientation: next }
  }));
  updateOrientationButtonLabel(s.orientationButton, next);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function seedDefaultsIfEmpty(panel: NotebookPanel, manager: MetadataManager): void {
  const raw = panel.model?.getMetadata(LAYOUT_METADATA_KEY);
  if (raw) {
    return;
  }
  manager.update(layout => ({
    ...layout,
    settings: {
      ...layout.settings,
      page_size: userDefaults.pageSize,
      orientation: userDefaults.orientation,
      smart_guides: userDefaults.smartGuides
    }
  }));
}

function attachNotebook(panel: NotebookPanel): void {
  panel.context.ready
    .then(() => {
      if (!panel.model) {
        console.warn('jupyterlab-cell-layout: panel.model not available');
        return;
      }
      const manager = new MetadataManager(panel.model);
      seedDefaultsIfEmpty(panel, manager);
      const coordinator = new CellCoordinator(panel.model, manager);
      const canvas = new LayoutCanvas(
        coordinator,
        manager,
        panel.content.rendermime
      );

    const layout = panel.layout as BoxLayout;
    layout.addWidget(canvas);
    BoxLayout.setStretch(canvas, 1);
    canvas.hide();

    const modeButton = new ToolbarButton({
      label: 'Edit mode',
      tooltip: 'Toggle cell layout summary mode (Ctrl+Shift+T)',
      onClick: () => toggleMode(panel)
    });
    modeButton.addClass('jp-CellLayout-tbItem');
    panel.toolbar.insertItem(10, 'cellLayoutToggle', modeButton);

    const orientationButton = new ToolbarButton({
      label: 'Portrait',
      tooltip: 'Toggle page orientation (portrait / landscape)',
      onClick: () => toggleOrientation(panel)
    });
    orientationButton.addClass('jp-CellLayout-tbItem');
    panel.toolbar.insertItem(11, 'cellLayoutOrientation', orientationButton);

    const initialPageCount = manager.read().settings.page_count;
    const pageCountButton = new ToolbarButton({
      label: `${initialPageCount} page${initialPageCount === 1 ? '' : 's'}`,
      tooltip:
        'Click: add page (Ctrl+Shift+])  ·  Shift-click: remove (Ctrl+Shift+[)',
      onClick: () => changePageCount(panel, +1)
    });
    pageCountButton.node.addEventListener(
      'click',
      e => {
        if ((e as MouseEvent).shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          changePageCount(panel, -1);
        }
      },
      true
    );
    pageCountButton.addClass('jp-CellLayout-tbItem');
    panel.toolbar.insertItem(12, 'cellLayoutPageCount', pageCountButton);

    const exportButton = new ToolbarButton({
      label: 'Export PDF',
      tooltip: 'Export the summary-mode layout to a PDF file',
      onClick: () => {
        void exportCurrentNotebookToPdf(panel);
      }
    });
    exportButton.addClass('jp-CellLayout-tbItem');
    panel.toolbar.insertItem(13, 'cellLayoutExportPdf', exportButton);

    state.set(panel, {
      manager,
      coordinator,
      canvas,
      modeButton,
      orientationButton,
      pageCountButton,
      exportButton
    });

    applyMode(panel, isSummaryMode(manager));
    refreshCellAffordances(panel);

    coordinator.changed.connect(() => refreshCellAffordances(panel));
    coordinator.settingsChanged.connect(() => {
      const s = state.get(panel);
      if (!s) {
        return;
      }
      updatePageCountButtonLabel(
        s.pageCountButton,
        s.manager.read().settings.page_count
      );
    });

      panel.disposed.connect(() => {
        coordinator.dispose();
        canvas.dispose();
        modeButton.dispose();
        orientationButton.dispose();
        pageCountButton.dispose();
        exportButton.dispose();
        state.delete(panel);
      });
    })
    .catch(err => {
      console.error('jupyterlab-cell-layout: attachNotebook failed', err);
    });
}

function readUserDefaults(settings: ISettingRegistryType.ISettings): void {
  const composite = settings.composite;
  const pageSize = composite.pageSize;
  const orientation = composite.orientation;
  const smartGuides = composite.smartGuides;
  if (pageSize === 'A3' || pageSize === 'A4') {
    userDefaults.pageSize = pageSize;
  }
  if (orientation === 'landscape' || orientation === 'portrait') {
    userDefaults.orientation = orientation;
  }
  if (typeof smartGuides === 'boolean') {
    userDefaults.smartGuides = smartGuides;
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-cell-layout:plugin',
  description:
    'Drag-and-drop cell layout for engineering design documentation with PDF export',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension jupyterlab-cell-layout is activated!');

    app.commands.addCommand(COMMAND_TOGGLE_MODE, {
      label: 'Cell Layout: Toggle summary / edit mode',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          toggleMode(panel);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_TOGGLE_ORIENTATION, {
      label: 'Cell Layout: Toggle orientation (portrait / landscape)',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          toggleOrientation(panel);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_ADD_PAGE, {
      label: 'Cell Layout: Add page',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          changePageCount(panel, +1);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_REMOVE_PAGE, {
      label: 'Cell Layout: Remove page',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          changePageCount(panel, -1);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_EXPORT_PDF, {
      label: 'Cell Layout: Export to PDF',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          void exportCurrentNotebookToPdf(panel);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_TOGGLE_CELL_INCLUSION, {
      label: 'Cell Layout: Toggle cell inclusion on summary canvas',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          toggleActiveCellInclusion(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null &&
        notebooks.currentWidget.content.activeCell !== null
    });

    app.commands.addCommand(COMMAND_SHOW_INFO, {
      label: 'Cell Layout: Show info (debug)',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          void showLayoutInfoDialog(panel);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.contextMenu.addItem({
      command: COMMAND_TOGGLE_CELL_INCLUSION,
      selector: '.jp-Notebook .jp-Cell',
      rank: 11
    });

    notebooks.widgetAdded.connect((_, panel) => attachNotebook(panel));
    for (const panel of notebooks.filter(() => true)) {
      attachNotebook(panel);
    }

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          readUserDefaults(settings);
          settings.changed.connect(() => readUserDefaults(settings));
          console.log(
            `jupyterlab-cell-layout user defaults — pageSize: ${userDefaults.pageSize}, orientation: ${userDefaults.orientation}`
          );
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for jupyterlab-cell-layout.',
            reason
          );
        });
    }
  }
};

export default plugin;
