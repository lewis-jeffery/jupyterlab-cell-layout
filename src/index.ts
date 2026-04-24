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
const COMMAND_SHOW_INFO = 'jupyterlab-cell-layout:show-info';
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
  panel.context.ready.then(() => {
    if (!panel.model) {
      return;
    }
    const manager = new MetadataManager(panel.model);
    seedDefaultsIfEmpty(panel, manager);
    const coordinator = new CellCoordinator(panel.model, manager);
    const canvas = new LayoutCanvas(coordinator, manager);

    const layout = panel.layout as BoxLayout;
    layout.addWidget(canvas);
    BoxLayout.setStretch(canvas, 1);
    canvas.hide();

    const modeButton = new ToolbarButton({
      label: 'Edit mode',
      tooltip: 'Toggle cell layout summary mode (Ctrl+Shift+T)',
      onClick: () => toggleMode(panel)
    });
    panel.toolbar.insertItem(10, 'cellLayoutToggle', modeButton);

    const orientationButton = new ToolbarButton({
      label: 'Portrait',
      tooltip: 'Toggle page orientation (portrait / landscape)',
      onClick: () => toggleOrientation(panel)
    });
    panel.toolbar.insertItem(11, 'cellLayoutOrientation', orientationButton);

    state.set(panel, {
      manager,
      coordinator,
      canvas,
      modeButton,
      orientationButton
    });

    applyMode(panel, isSummaryMode(manager));
    reapplyCellExclusionClasses(panel);

    coordinator.changed.connect(() => reapplyCellExclusionClasses(panel));

    panel.disposed.connect(() => {
      coordinator.dispose();
      canvas.dispose();
      modeButton.dispose();
      orientationButton.dispose();
      state.delete(panel);
    });
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
