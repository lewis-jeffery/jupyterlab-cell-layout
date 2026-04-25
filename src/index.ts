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
}

const userDefaults: IUserDefaults = {
  pageSize: 'A4',
  orientation: 'portrait'
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

function toggleActiveCellInclusion(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const activeCell = panel.content.activeCell;
  if (!activeCell) {
    return;
  }
  const cellId = activeCell.model.id;
  const newMode = s.coordinator.toggleCellInclusion(cellId);
  activeCell.node.classList.toggle(
    'jp-CellLayout-cellExcluded',
    newMode === 'edit'
  );
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function reapplyCellExclusionClasses(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  const layout = s.manager.read();
  const widgets = panel.content.widgets;
  for (const cellWidget of widgets) {
    const mode = layout.cells[cellWidget.model.id]?.mode ?? 'summary';
    cellWidget.node.classList.toggle(
      'jp-CellLayout-cellExcluded',
      mode === 'edit'
    );
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
      orientation: userDefaults.orientation
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
    reapplyCellExclusionClasses(panel);

    coordinator.changed.connect(() => reapplyCellExclusionClasses(panel));
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
  if (pageSize === 'A3' || pageSize === 'A4') {
    userDefaults.pageSize = pageSize;
  }
  if (orientation === 'landscape' || orientation === 'portrait') {
    userDefaults.orientation = orientation;
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

    // Best-effort markdown-link navigation. Multiple attempts (in-cell
    // capture-phase click handler, deep-clone-and-replace, document
    // capture-phase click, document capture-phase mousedown) have not
    // delivered consistent navigation on user systems — JupyterLab/Lumino
    // appears to swallow these events for content inside our overlay
    // canvas in some configurations. Tracked as deferred task #28. The
    // mousedown listener below is left in place because it costs almost
    // nothing and may navigate successfully on some setups.
    document.addEventListener(
      'mousedown',
      e => {
        if ((e as MouseEvent).button !== 0) {
          return;
        }
        const target = e.target as HTMLElement | null;
        if (!target) {
          return;
        }
        const anchor = target.closest('a');
        if (!anchor) {
          return;
        }
        if (!anchor.closest('.jp-CellLayout-md')) {
          return;
        }
        const href = anchor.getAttribute('href');
        if (!href || !/^(https?|mailto|ftp):/i.test(href)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      },
      { capture: true }
    );

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
