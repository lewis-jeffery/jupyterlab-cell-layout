import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  Dialog,
  ICommandPalette,
  ToolbarButton,
  showDialog
} from '@jupyterlab/apputils';
import { CodeCell } from '@jupyterlab/cells';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import {
  ISettingRegistry,
  type ISettingRegistry as ISettingRegistryType
} from '@jupyterlab/settingregistry';
import { BoxLayout, Widget } from '@lumino/widgets';

import { showLayoutInfoDialog } from './demo/info-dialog';
import {
  type ICoverSheetData,
  formatCoverDate
} from './exporters/cover-sheet';
import { exportToPdf, PdfExportError } from './exporters/pdf-export';
import { CellCoordinator } from './managers/cell-coordinator';
import { ExcelBridge } from './managers/excel-bridge';
import {
  type IExcelLink,
  LAYOUT_METADATA_KEY,
  MetadataManager,
  type PageOrientation,
  type PageSize
} from './managers/metadata';
import { buildTocHeadings, type ITocSourceCell } from './managers/toc';
import { coerceText } from './widgets/units';
import { LayoutCanvas } from './widgets/layout-canvas';

const COMMAND_TOGGLE_MODE = 'jupyterlab-cell-layout:toggle-mode';
const COMMAND_TOGGLE_ORIENTATION =
  'jupyterlab-cell-layout:toggle-orientation';
const COMMAND_TOGGLE_CELL_INCLUSION =
  'jupyterlab-cell-layout:toggle-cell-inclusion';
const COMMAND_TOGGLE_TOC = 'jupyterlab-cell-layout:toggle-toc';
const COMMAND_ADD_PAGE = 'jupyterlab-cell-layout:add-page';
const COMMAND_REMOVE_PAGE = 'jupyterlab-cell-layout:remove-page';
const COMMAND_EXPORT_PDF = 'jupyterlab-cell-layout:export-pdf';
const COMMAND_EXPORT_PDF_WITH_COVER =
  'jupyterlab-cell-layout:export-pdf-with-cover';
const COMMAND_SHOW_INFO = 'jupyterlab-cell-layout:show-info';
const COMMAND_MARK_AS_EXCEL = 'jupyterlab-cell-layout:mark-as-excel-view';
const COMMAND_CLEAR_EXCEL = 'jupyterlab-cell-layout:clear-excel-view';
const COMMAND_INSERT_PAGE_ABOVE =
  'jupyterlab-cell-layout:insert-page-above';
const COMMAND_INSERT_PAGE_BELOW =
  'jupyterlab-cell-layout:insert-page-below';
const COMMAND_DELETE_PAGE = 'jupyterlab-cell-layout:delete-page';
const COMMAND_EDIT_EXCEL_HERE =
  'jupyterlab-cell-layout:edit-excel-link-here';
const COMMAND_CLEAR_EXCEL_HERE =
  'jupyterlab-cell-layout:clear-excel-link-here';

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

// Session-scoped: the on-screen ToC is shown/hidden via the toolbar
// "Contents" button. Not part of the settings schema — the in/out for the
// PDF cover sheet's printed ToC is the only "should there be a ToC?"
// decision worth persisting, and that belongs to the cover-sheet dialog.
let sessionTocOpen = false;

// Captured at plugin activation; used by `attachNotebook` to pass through to
// LayoutCanvas → SummaryInputCell so summary-mode code cells can render via
// JL's CodeMirror editor.
let editorServicesRef: IEditorServices | null = null;

// Reference to the loaded settings so the cover-sheet flow can write back
// the last-used author. May be null if settings registry isn't available.
let pluginSettingsRef: ISettingRegistryType.ISettings | null = null;

interface INotebookState {
  manager: MetadataManager;
  coordinator: CellCoordinator;
  canvas: LayoutCanvas;
  excelBridge: ExcelBridge;
  modeButton: ToolbarButton;
  orientationButton: ToolbarButton;
  pageCountButton: ToolbarButton;
  exportButton: ToolbarButton;
  tocButton: ToolbarButton;
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
    // Carry selection from summary mode: if the user clicked a cell on the
    // canvas, make that the active cell in the notebook and scroll to it.
    // Otherwise jump to the top of the notebook.
    const lastSummaryId = s.canvas.consumeActiveCellId();
    activateCellAfterModeSwitch(panel, lastSummaryId);
  }
  updateModeButtonLabel(s.modeButton, summary);
  updateOrientationButtonLabel(
    s.orientationButton,
    s.manager.read().settings.orientation
  );
}

/**
 * Execute the notebook cell with the given id, the same way the user
 * pressing Shift+Enter on it in edit mode would. Used by the Run button
 * the editable-summary feature renders next to each code cell. Looks up
 * the live JL Cell widget by model id, defers to `CodeCell.execute` so
 * the kernel pathway, busy state, and output handling all match JL's
 * built-in behaviour. No-op for non-code cells or unknown ids.
 */
function runCellById(panel: NotebookPanel, cellId: string): void {
  const widget = panel.content.widgets.find(
    w => w.model.id === cellId
  );
  if (widget instanceof CodeCell) {
    void CodeCell.execute(widget, panel.sessionContext);
  }
}

function activateCellAfterModeSwitch(
  panel: NotebookPanel,
  cellId: string | null
): void {
  const widgets = panel.content.widgets;
  if (widgets.length === 0) {
    return;
  }
  let targetIndex = 0;
  if (cellId) {
    for (let i = 0; i < widgets.length; i++) {
      if (widgets[i].model.id === cellId) {
        targetIndex = i;
        break;
      }
    }
  }
  panel.content.activeCellIndex = targetIndex;
  // Defer scrollIntoView one frame so the layout swap from canvas → notebook
  // has settled and the cell node has its final geometry.
  requestAnimationFrame(() => {
    const target = widgets[targetIndex];
    if (target?.node?.isConnected) {
      target.node.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  });
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
    // Wait for any in-flight Excel fetches to settle so the bitmap capture
    // sees the rendered table rather than a "Reading…" placeholder.
    await s.canvas.awaitReady();
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

/**
 * Modal dialog body for the cover-sheet export. Two-column grid: label +
 * input, plus a checkbox for "Include table of contents".
 */
class CoverSheetPrompt extends Widget {
  private readonly _title: HTMLInputElement;
  private readonly _author: HTMLInputElement;
  private readonly _date: HTMLInputElement;
  private readonly _includeToc: HTMLInputElement;

  constructor(initial: {
    title: string;
    author: string;
    date: string;
    includeToc: boolean;
  }) {
    super({ node: document.createElement('div') });
    const node = this.node;
    node.style.display = 'grid';
    node.style.gridTemplateColumns = 'auto 1fr';
    node.style.rowGap = '8px';
    node.style.columnGap = '8px';
    node.style.minWidth = '380px';
    this._title = mkRow(node, 'Title', initial.title, 'Document title');
    this._author = mkRow(node, 'Author', initial.author, 'Your name');
    this._date = mkRow(node, 'Date', initial.date, '30 April 2026');
    // Checkbox spans both columns so the label sits next to the box.
    const cbWrap = document.createElement('label');
    cbWrap.style.gridColumn = '1 / span 2';
    cbWrap.style.display = 'flex';
    cbWrap.style.alignItems = 'center';
    cbWrap.style.gap = '6px';
    cbWrap.style.marginTop = '4px';
    this._includeToc = document.createElement('input');
    this._includeToc.type = 'checkbox';
    this._includeToc.checked = initial.includeToc;
    cbWrap.appendChild(this._includeToc);
    cbWrap.appendChild(
      document.createTextNode('Include table of contents')
    );
    node.appendChild(cbWrap);
  }

  getValue(): ICoverSheetData {
    return {
      title: this._title.value.trim(),
      author: this._author.value.trim(),
      date: this._date.value.trim(),
      includeToc: this._includeToc.checked
    };
  }
}

async function promptForCoverSheet(
  panel: NotebookPanel
): Promise<{ data: ICoverSheetData | null; accepted: boolean }> {
  const basename = panel.context.path.split('/').pop() ?? 'Document';
  const defaultTitle = basename.replace(/\.ipynb$/i, '');
  const lastAuthor =
    typeof pluginSettingsRef?.composite?.lastAuthor === 'string'
      ? (pluginSettingsRef.composite.lastAuthor as string)
      : '';
  const defaultDate = formatCoverDate(new Date());
  const body = new CoverSheetPrompt({
    title: defaultTitle,
    author: lastAuthor,
    date: defaultDate,
    includeToc: true
  });
  const result = await showDialog({
    title: 'Export PDF with cover sheet',
    body,
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Export' })]
  });
  return { data: body.getValue(), accepted: !!result.button.accept };
}

async function exportCurrentNotebookToPdfWithCover(
  panel: NotebookPanel
): Promise<void> {
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
  if (!isSummaryMode(s.manager)) {
    window.alert('Switch to summary mode before exporting (Ctrl+Shift+T).');
    return;
  }
  const { data, accepted } = await promptForCoverSheet(panel);
  if (!accepted || !data) {
    return;
  }
  // Persist the author so subsequent exports remember it.
  if (data.author && pluginSettingsRef) {
    try {
      await pluginSettingsRef.set('lastAuthor', data.author);
    } catch (err) {
      console.warn(
        'jupyterlab-cell-layout: could not persist lastAuthor',
        err
      );
    }
  }
  // Build the ToC heading list from current cell sources, matching the
  // sidebar's input.
  const layout = s.manager.read();
  const settings = layout.settings;
  const pageDims =
    settings.page_size === 'A3'
      ? { width: 297, height: 420 }
      : { width: 210, height: 297 };
  const isLandscape = settings.orientation === 'landscape';
  const pageHeightMm = isLandscape ? pageDims.width : pageDims.height;
  const pageCount = Math.max(1, Math.floor(settings.page_count));
  const sources: ITocSourceCell[] = [];
  for (const entry of s.coordinator.list()) {
    if (entry.layout.mode !== 'summary') {
      continue;
    }
    sources.push({
      cellId: entry.cellModel.id,
      type: entry.layout.type,
      source: coerceText(entry.cellModel.sharedModel.getSource()),
      xMm: entry.layout.input.position.x,
      yMm: entry.layout.input.position.y
    });
  }
  const tocHeadings = buildTocHeadings(sources, pageHeightMm, pageCount);
  try {
    await s.canvas.awaitReady();
    const filename = await exportToPdf(panel, s.manager, pageEl, {
      cover: data,
      tocHeadings
    });
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


class ExcelLinkPrompt extends Widget {
  private readonly _workbook: HTMLInputElement;
  private readonly _sheet: HTMLInputElement;
  private readonly _range: HTMLInputElement;

  constructor(initial: Partial<IExcelLink> = {}) {
    super({ node: document.createElement('div') });
    const node = this.node;
    node.style.display = 'grid';
    node.style.gridTemplateColumns = 'auto 1fr';
    node.style.rowGap = '6px';
    node.style.columnGap = '8px';
    node.style.minWidth = '320px';
    this._workbook = mkRow(node, 'Workbook', initial.workbook ?? '', 'data.xlsx');
    // "Sheet1" is the default Excel sheet name — pre-fill rather than only
    // hint via placeholder, so users who leave the field alone still get a
    // working value.
    this._sheet = mkRow(node, 'Sheet', initial.sheet ?? 'Sheet1', 'Sheet1');
    this._range = mkRow(
      node,
      'Named range',
      initial.range ?? '',
      'design_summary'
    );
  }

  getValue(): IExcelLink | null {
    const workbook = this._workbook.value.trim();
    const sheet = this._sheet.value.trim();
    const range = this._range.value.trim();
    if (!workbook || !sheet || !range) {
      return null;
    }
    return { workbook, sheet, range };
  }
}

function mkRow(
  parent: HTMLElement,
  label: string,
  value: string,
  placeholder: string
): HTMLInputElement {
  const lab = document.createElement('label');
  lab.textContent = label;
  parent.appendChild(lab);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.style.padding = '3px 6px';
  parent.appendChild(input);
  return input;
}

async function promptForExcelLink(
  initial?: IExcelLink
): Promise<{ link: IExcelLink | null; accepted: boolean }> {
  const body = new ExcelLinkPrompt(initial);
  const result = await showDialog({
    title: 'Mark cell as Excel range view',
    body,
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Apply' })]
  });
  return { link: body.getValue(), accepted: !!result.button.accept };
}

async function markActiveCellAsExcelView(panel: NotebookPanel): Promise<void> {
  const s = state.get(panel);
  const activeCell = panel.content.activeCell;
  if (!s || !activeCell) {
    return;
  }
  const cellId = activeCell.model.id;
  const existing = s.manager.getCell(cellId)?.excel;
  const { link, accepted } = await promptForExcelLink(existing);
  if (!accepted) {
    return;
  }
  if (!link) {
    window.alert(
      'Workbook, Sheet, and Named range are all required. Please fill in all three fields.'
    );
    return;
  }
  s.coordinator.setExcelLink(cellId, link);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function clearActiveCellExcelView(panel: NotebookPanel): void {
  const s = state.get(panel);
  const activeCell = panel.content.activeCell;
  if (!s || !activeCell) {
    return;
  }
  s.coordinator.setExcelLink(activeCell.model.id, null);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

// Tracks the cell id of the most recently right-clicked Excel-rendered
// cell on the canvas. Mirror of the page-badge tracker below; the canvas
// is the only place an Excel cell appears, so summary mode is implicit.
let lastExcelCellId: string | null = null;

function rememberExcelCellOnContextMenu(): void {
  document.addEventListener(
    'contextmenu',
    e => {
      const target = e.target as HTMLElement | null;
      const node = target?.closest?.(
        '.jp-CellLayout-excel'
      ) as HTMLElement | null;
      if (!node) {
        return;
      }
      lastExcelCellId = node.dataset.cellId ?? null;
    },
    true
  );
}

async function editExcelLinkHere(panel: NotebookPanel): Promise<void> {
  const s = state.get(panel);
  if (!s || !lastExcelCellId) {
    return;
  }
  const cellId = lastExcelCellId;
  const existing = s.manager.getCell(cellId)?.excel;
  const { link, accepted } = await promptForExcelLink(existing);
  if (!accepted) {
    return;
  }
  if (!link) {
    window.alert(
      'Workbook, Sheet, and Named range are all required. Please fill in all three fields.'
    );
    return;
  }
  s.coordinator.setExcelLink(cellId, link);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function clearExcelLinkHere(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s || !lastExcelCellId) {
    return;
  }
  s.coordinator.setExcelLink(lastExcelCellId, null);
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

// Tracks the page index of the most recently right-clicked page badge.
// JL's contextMenu API doesn't pass DOM context to commands, so we capture
// it on the document's contextmenu event (capture phase, before the menu
// opens) and read it from the command handler.
let lastPageBadgeIndex: number | null = null;

function rememberPageBadgeOnContextMenu(): void {
  document.addEventListener(
    'contextmenu',
    e => {
      const target = e.target as HTMLElement | null;
      const badge = target?.closest?.(
        '.jp-CellLayout-pageNumber'
      ) as HTMLElement | null;
      if (!badge) {
        return;
      }
      const raw = badge.dataset.pageIndex;
      const parsed = raw === undefined ? NaN : parseInt(raw, 10);
      lastPageBadgeIndex = Number.isFinite(parsed) ? parsed : null;
    },
    true
  );
}

function insertPageRelative(
  panel: NotebookPanel,
  position: 'above' | 'below'
): void {
  const s = state.get(panel);
  if (!s || lastPageBadgeIndex === null) {
    return;
  }
  const targetIdx =
    position === 'above' ? lastPageBadgeIndex : lastPageBadgeIndex + 1;
  const result = s.coordinator.insertPageAt(targetIdx);
  if (!result.ok) {
    if (result.message) {
      window.alert(result.message);
    }
    return;
  }
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
  }
}

function deleteSelectedPage(panel: NotebookPanel): void {
  const s = state.get(panel);
  if (!s || lastPageBadgeIndex === null) {
    return;
  }
  const result = s.coordinator.deletePageAt(lastPageBadgeIndex);
  if (!result.ok) {
    if (result.message) {
      window.alert(result.message);
    }
    return;
  }
  if (isSummaryMode(s.manager)) {
    s.canvas.refresh();
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

function updateTocButtonLabel(button: ToolbarButton, on: boolean): void {
  const labelEl = button.node.querySelector('.jp-ToolbarButtonComponent-label');
  if (labelEl) {
    labelEl.textContent = on ? 'Contents' : 'No contents';
  }
}

function applyTocVisibility(panel: NotebookPanel, visible: boolean): void {
  const s = state.get(panel);
  if (!s) {
    return;
  }
  s.canvas.setTocVisible(visible);
  updateTocButtonLabel(s.tocButton, visible);
}

function toggleToc(panel: NotebookPanel): void {
  sessionTocOpen = !sessionTocOpen;
  applyTocVisibility(panel, sessionTocOpen);
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
      const excelBridge = new ExcelBridge(panel);
      const canvas = new LayoutCanvas(
        coordinator,
        manager,
        panel.content.rendermime,
        excelBridge,
        editorServicesRef ?? undefined,
        cellId => runCellById(panel, cellId),
        () => refreshCellAffordances(panel)
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

    const tocButton = new ToolbarButton({
      label: sessionTocOpen ? 'Contents' : 'No contents',
      tooltip:
        'Toggle the contents sidebar in summary mode (one entry per markdown heading)',
      onClick: () => toggleToc(panel)
    });
    tocButton.addClass('jp-CellLayout-tbItem');
    panel.toolbar.insertItem(14, 'cellLayoutToc', tocButton);

    state.set(panel, {
      manager,
      coordinator,
      canvas,
      excelBridge,
      modeButton,
      orientationButton,
      pageCountButton,
      exportButton,
      tocButton
    });

    applyMode(panel, isSummaryMode(manager));
    applyTocVisibility(panel, sessionTocOpen);
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
        tocButton.dispose();
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
  requires: [INotebookTracker, IEditorServices],
  optional: [ISettingRegistry, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    editorServices: IEditorServices,
    settingRegistry: ISettingRegistry | null,
    palette: ICommandPalette | null
  ) => {
    console.log('JupyterLab extension jupyterlab-cell-layout is activated!');
    editorServicesRef = editorServices;

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

    app.commands.addCommand(COMMAND_EXPORT_PDF_WITH_COVER, {
      label: 'Cell Layout: Export to PDF with cover sheet…',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          void exportCurrentNotebookToPdfWithCover(panel);
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

    app.commands.addCommand(COMMAND_TOGGLE_TOC, {
      label: 'Cell Layout: Toggle contents sidebar',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          toggleToc(panel);
        }
      },
      isEnabled: () => notebooks.currentWidget !== null
    });

    app.commands.addCommand(COMMAND_INSERT_PAGE_ABOVE, {
      label: 'Cell Layout: Insert page above (right-clicked page)',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          insertPageRelative(panel, 'above');
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null && lastPageBadgeIndex !== null
    });

    app.commands.addCommand(COMMAND_INSERT_PAGE_BELOW, {
      label: 'Cell Layout: Insert page below (right-clicked page)',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          insertPageRelative(panel, 'below');
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null && lastPageBadgeIndex !== null
    });

    app.commands.addCommand(COMMAND_DELETE_PAGE, {
      label: 'Cell Layout: Delete this page (right-clicked page)',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          deleteSelectedPage(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null && lastPageBadgeIndex !== null
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

    app.commands.addCommand(COMMAND_MARK_AS_EXCEL, {
      label: 'Cell Layout: Mark active cell as Excel range view',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          void markActiveCellAsExcelView(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null &&
        notebooks.currentWidget.content.activeCell !== null
    });

    app.commands.addCommand(COMMAND_CLEAR_EXCEL, {
      label: 'Cell Layout: Clear Excel range link from active cell',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          clearActiveCellExcelView(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null &&
        notebooks.currentWidget.content.activeCell !== null
    });

    app.commands.addCommand(COMMAND_EDIT_EXCEL_HERE, {
      label: 'Edit Excel link…',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          void editExcelLinkHere(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null && lastExcelCellId !== null
    });

    app.commands.addCommand(COMMAND_CLEAR_EXCEL_HERE, {
      label: 'Clear Excel link',
      execute: () => {
        const panel = notebooks.currentWidget;
        if (panel) {
          clearExcelLinkHere(panel);
        }
      },
      isEnabled: () =>
        notebooks.currentWidget !== null && lastExcelCellId !== null
    });

    if (palette) {
      const category = 'Cell Layout';
      for (const command of [
        COMMAND_TOGGLE_MODE,
        COMMAND_TOGGLE_ORIENTATION,
        COMMAND_TOGGLE_TOC,
        COMMAND_ADD_PAGE,
        COMMAND_REMOVE_PAGE,
        COMMAND_EXPORT_PDF,
        COMMAND_EXPORT_PDF_WITH_COVER,
        COMMAND_TOGGLE_CELL_INCLUSION,
        COMMAND_INSERT_PAGE_ABOVE,
        COMMAND_INSERT_PAGE_BELOW,
        COMMAND_DELETE_PAGE,
        COMMAND_MARK_AS_EXCEL,
        COMMAND_CLEAR_EXCEL,
        COMMAND_SHOW_INFO
      ]) {
        palette.addItem({ command, category });
      }
    }

    app.contextMenu.addItem({
      command: COMMAND_TOGGLE_CELL_INCLUSION,
      selector: '.jp-Notebook .jp-Cell',
      rank: 11
    });

    rememberPageBadgeOnContextMenu();
    rememberExcelCellOnContextMenu();

    app.contextMenu.addItem({
      command: COMMAND_EDIT_EXCEL_HERE,
      selector: '.jp-CellLayout-excel',
      rank: 1
    });
    app.contextMenu.addItem({
      command: COMMAND_CLEAR_EXCEL_HERE,
      selector: '.jp-CellLayout-excel',
      rank: 2
    });

    app.contextMenu.addItem({
      command: COMMAND_INSERT_PAGE_ABOVE,
      selector: '.jp-CellLayout-pageNumber',
      rank: 1
    });
    app.contextMenu.addItem({
      command: COMMAND_INSERT_PAGE_BELOW,
      selector: '.jp-CellLayout-pageNumber',
      rank: 2
    });
    app.contextMenu.addItem({
      command: COMMAND_DELETE_PAGE,
      selector: '.jp-CellLayout-pageNumber',
      rank: 3
    });


    notebooks.widgetAdded.connect((_, panel) => attachNotebook(panel));
    for (const panel of notebooks.filter(() => true)) {
      attachNotebook(panel);
    }

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          pluginSettingsRef = settings;
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
