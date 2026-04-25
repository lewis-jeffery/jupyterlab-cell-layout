import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { INotebookModel } from '@jupyterlab/notebook';
import { ISignal, Signal } from '@lumino/signaling';

import {
  type CellType,
  type ICellLayout,
  type IExcelLink,
  type IInputLayout,
  type ILayoutSettings,
  type INotebookLayout,
  type IOutputLayout,
  type IPosition,
  MAX_PAGE_COUNT,
  MetadataManager,
  type OutputSlotId,
  PAGE_SIZES_MM
} from './metadata';

export const PAGE_MARGIN_MM = 20;
export const ROW_GAP_MM = 5;
export const DEFAULT_INPUT_HEIGHT_MM = 40;
export const DEFAULT_OUTPUT_HEIGHT_MM = 45;
export const SLOT_GAP_MM = 2;
export const AUTO_GROW_BOTTOM_MARGIN_MM = 5;

export interface IPageBounds {
  width: number;
  height: number;
  margin: number;
  contentWidth: number;
}

export function pageBoundsFor(settings: ILayoutSettings): IPageBounds {
  const page = PAGE_SIZES_MM[settings.page_size];
  const isLandscape = settings.orientation === 'landscape';
  const width = isLandscape ? page.height : page.width;
  const height = isLandscape ? page.width : page.height;
  return {
    width,
    height,
    margin: PAGE_MARGIN_MM,
    contentWidth: width - PAGE_MARGIN_MM * 2
  };
}

export interface ICellInfo {
  cellType: CellType;
  hasOutputs: boolean;
}

function rowHeightFor(info: ICellInfo): number {
  const hasOut = info.cellType === 'code' && info.hasOutputs;
  if (!hasOut) {
    return DEFAULT_INPUT_HEIGHT_MM;
  }
  return DEFAULT_INPUT_HEIGHT_MM + SLOT_GAP_MM + DEFAULT_OUTPUT_HEIGHT_MM;
}

function defaultInputLayoutAt(
  y: number,
  bounds: IPageBounds,
  visibleLines: number
): IInputLayout {
  return {
    position: { x: bounds.margin, y },
    size: { width: bounds.contentWidth, height: DEFAULT_INPUT_HEIGHT_MM },
    visible_lines: visibleLines,
    z_index: 1,
    auto_fit: true
  };
}

function defaultOutputsBelow(input: IInputLayout): IOutputLayout[] {
  const halfWidth = input.size.width / 2 - 1;
  const outY = input.position.y + input.size.height + SLOT_GAP_MM;
  const aX = input.position.x;
  const bX = input.position.x + halfWidth + 2;
  return [
    {
      output_id: 'output_a',
      type: 'text',
      position: { x: aX, y: outY },
      size: { width: halfWidth, height: DEFAULT_OUTPUT_HEIGHT_MM },
      visible_lines: 10,
      z_index: 2,
      max_image_width: Math.max(halfWidth - 5, 10),
      enabled: true,
      auto_fit: true
    },
    {
      output_id: 'output_b',
      type: 'graphics',
      position: { x: bX, y: outY },
      size: { width: halfWidth, height: DEFAULT_OUTPUT_HEIGHT_MM },
      visible_lines: null,
      z_index: 2,
      max_image_width: Math.max(halfWidth - 5, 10),
      enabled: true,
      auto_fit: true
    }
  ];
}

export function computeDefaultLayoutsForCells(
  cellInfos: ReadonlyArray<ICellInfo>,
  settings: ILayoutSettings
): ICellLayout[] {
  const bounds = pageBoundsFor(settings);
  const layouts: ICellLayout[] = [];
  let y = bounds.margin;
  for (const info of cellInfos) {
    const input = defaultInputLayoutAt(y, bounds, settings.default_summary_lines);
    const hasOut = info.cellType === 'code' && info.hasOutputs;
    const outputs = hasOut ? defaultOutputsBelow(input) : [];
    layouts.push({ type: info.cellType, mode: 'summary', input, outputs });
    y += rowHeightFor(info) + ROW_GAP_MM;
  }
  return layouts;
}

/**
 * Page height in mm honouring portrait/landscape from settings.
 */
export function pageHeightMmFor(settings: ILayoutSettings): number {
  const dims = PAGE_SIZES_MM[settings.page_size];
  return settings.orientation === 'landscape' ? dims.width : dims.height;
}

/**
 * Compute the minimum number of pages required to fit every summary-mode
 * cell on the canvas, with a small bottom margin so content doesn't crowd
 * the page edge. Capped at MAX_PAGE_COUNT.
 */
export function computeRequiredPageCount(layout: INotebookLayout): number {
  const pageHeight = pageHeightMmFor(layout.settings);
  let maxBottom = 0;
  for (const cell of Object.values(layout.cells)) {
    if (cell.mode !== 'summary') {
      continue;
    }
    maxBottom = Math.max(
      maxBottom,
      cell.input.position.y + cell.input.size.height
    );
    for (const o of cell.outputs) {
      if (!o.enabled) {
        continue;
      }
      maxBottom = Math.max(maxBottom, o.position.y + o.size.height);
    }
  }
  if (maxBottom <= 0) {
    return Math.max(1, layout.settings.page_count);
  }
  const needed = Math.ceil(
    (maxBottom + AUTO_GROW_BOTTOM_MARGIN_MM) / pageHeight
  );
  return Math.max(1, Math.min(MAX_PAGE_COUNT, needed));
}

export function pruneStaleCells(
  cells: Record<string, ICellLayout>,
  liveIds: ReadonlySet<string>
): Record<string, ICellLayout> {
  const result: Record<string, ICellLayout> = {};
  for (const [id, layout] of Object.entries(cells)) {
    if (liveIds.has(id)) {
      result[id] = layout;
    }
  }
  return result;
}

export interface ICellEntry {
  cellModel: ICellModel;
  layout: ICellLayout;
  hasSavedLayout: boolean;
  index: number;
}

export class CellCoordinator {
  private readonly _changed = new Signal<this, void>(this);
  private readonly _settingsChanged = new Signal<this, void>(this);
  private _disposed = false;

  constructor(
    private readonly model: INotebookModel,
    private readonly manager: MetadataManager
  ) {
    model.cells.changed.connect(this._onCellsChanged, this);
  }

  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /**
   * Emitted when notebook-level settings (e.g. page_count) change as a
   * side-effect of layout edits — distinct from `changed`, which fires on
   * cell add/remove/reorder.
   */
  get settingsChanged(): ISignal<this, void> {
    return this._settingsChanged;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this.model.cells.changed.disconnect(this._onCellsChanged, this);
    Signal.clearData(this);
  }

  private _onCellsChanged(): void {
    this._changed.emit();
  }

  gridSnapMm(): number {
    return this.manager.read().settings.grid_snap;
  }

  liveCellIds(): Set<string> {
    const ids = new Set<string>();
    for (let i = 0; i < this.model.cells.length; i++) {
      ids.add(this.model.cells.get(i).id);
    }
    return ids;
  }

  list(): ICellEntry[] {
    const notebookLayout = this.manager.read();
    const settings = notebookLayout.settings;
    const infos: ICellInfo[] = [];
    const cellModels: ICellModel[] = [];
    for (let i = 0; i < this.model.cells.length; i++) {
      const cm = this.model.cells.get(i);
      cellModels.push(cm);
      infos.push({
        cellType: cm.type as CellType,
        hasOutputs:
          cm.type === 'code' && (cm as ICodeCellModel).outputs.length > 0
      });
    }
    const defaults = computeDefaultLayoutsForCells(infos, settings);
    return cellModels.map((cellModel, index) => {
      const saved = notebookLayout.cells[cellModel.id];
      return {
        cellModel,
        layout: saved ?? defaults[index],
        hasSavedLayout: !!saved,
        index
      };
    });
  }

  persistLayout(cellId: string, layout: ICellLayout): void {
    this.manager.setCell(cellId, layout);
    this.ensureEnoughPages();
  }

  /**
   * If any cell extends past the current canvas, bump page_count up to fit.
   * Never shrinks — page removal is user-initiated. Returns true if
   * page_count grew.
   */
  ensureEnoughPages(): boolean {
    const layout = this.manager.read();
    const needed = computeRequiredPageCount(layout);
    if (needed <= layout.settings.page_count) {
      return false;
    }
    this.manager.update(l => ({
      ...l,
      settings: { ...l.settings, page_count: needed }
    }));
    this._settingsChanged.emit();
    return true;
  }

  pruneStaleLayouts(): void {
    const liveIds = this.liveCellIds();
    this.manager.update(layout => ({
      ...layout,
      cells: pruneStaleCells(layout.cells, liveIds)
    }));
  }

  ensureDefaultLayouts(): void {
    const entries = this.list();
    this.manager.update(layout => {
      const nextCells = { ...layout.cells };
      for (const entry of entries) {
        if (!(entry.cellModel.id in nextCells)) {
          nextCells[entry.cellModel.id] = entry.layout;
        }
      }
      return { ...layout, cells: nextCells };
    });
  }

  /**
   * Persist a partial update to the input layout for a cell.
   * Seeds default layout if the cell has no saved layout yet.
   */
  updateInputLayout(cellId: string, updates: Partial<IInputLayout>): void {
    const entry = this.list().find(e => e.cellModel.id === cellId);
    if (!entry) {
      return;
    }
    this.persistLayout(cellId, {
      ...entry.layout,
      input: { ...entry.layout.input, ...updates }
    });
  }

  updateInputPosition(cellId: string, position: IPosition): void {
    this.updateInputLayout(cellId, { position });
  }

  /**
   * Persist a partial update to an output slot's layout.
   */
  updateOutputLayout(
    cellId: string,
    slotId: OutputSlotId,
    updates: Partial<IOutputLayout>
  ): void {
    const entry = this.list().find(e => e.cellModel.id === cellId);
    if (!entry) {
      return;
    }
    const outputs = entry.layout.outputs.map(o =>
      o.output_id === slotId ? { ...o, ...updates } : o
    );
    this.persistLayout(cellId, { ...entry.layout, outputs });
  }

  updateOutputPosition(
    cellId: string,
    slotId: OutputSlotId,
    position: IPosition
  ): void {
    this.updateOutputLayout(cellId, slotId, { position });
  }

  /**
   * Set the z-index of a cell's input AND all its output slots to the same
   * value. Keeps the cell's widgets in a single logical layer.
   */
  setCellZIndex(cellId: string, zIndex: number): void {
    const entry = this.list().find(e => e.cellModel.id === cellId);
    if (!entry) {
      return;
    }
    this.persistLayout(cellId, {
      ...entry.layout,
      input: { ...entry.layout.input, z_index: zIndex },
      outputs: entry.layout.outputs.map(o => ({ ...o, z_index: zIndex }))
    });
  }

  /**
   * Returns the max z-index observed across all cell layouts in metadata,
   * including defaults for unsaved cells. Useful for computing the next
   * "bring to front" value.
   */
  maxZIndex(): number {
    let max = 0;
    for (const entry of this.list()) {
      max = Math.max(max, entry.layout.input.z_index);
      for (const o of entry.layout.outputs) {
        max = Math.max(max, o.z_index);
      }
    }
    return max;
  }

  /**
   * Set or clear the Excel-link metadata for a cell. Pass `null` to remove.
   */
  setExcelLink(cellId: string, link: IExcelLink | null): void {
    const entry = this.list().find(e => e.cellModel.id === cellId);
    if (!entry) {
      return;
    }
    const next: ICellLayout = { ...entry.layout };
    if (link) {
      next.excel = { ...link };
    } else {
      delete next.excel;
    }
    this.persistLayout(cellId, next);
  }

  /**
   * Toggle whether a cell participates in the summary canvas.
   * - "summary" = included (default for new cells)
   * - "edit"    = excluded (appears only in standard edit-mode flow)
   *
   * Returns the new mode.
   */
  toggleCellInclusion(cellId: string): 'summary' | 'edit' {
    const entry = this.list().find(e => e.cellModel.id === cellId);
    if (!entry) {
      return 'summary';
    }
    const nextMode: 'summary' | 'edit' =
      entry.layout.mode === 'summary' ? 'edit' : 'summary';
    this.persistLayout(cellId, { ...entry.layout, mode: nextMode });
    return nextMode;
  }
}
