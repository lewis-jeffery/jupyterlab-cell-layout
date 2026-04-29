import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type * as nbformat from '@jupyterlab/nbformat';
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
import { OutputProcessor } from './output-processor';

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

/**
 * Shift the y-coordinate of input + output positions by `deltaMm` for any
 * slot whose top edge is at or below `yThresholdMm`. Used by page insert /
 * delete to make room or close gaps. Operates on every cell regardless of
 * `mode` — excluded cells keep meaningful positions for when re-included.
 */
export function shiftCellsAtOrBelow(
  cells: Record<string, ICellLayout>,
  yThresholdMm: number,
  deltaMm: number
): Record<string, ICellLayout> {
  const out: Record<string, ICellLayout> = {};
  for (const [id, cell] of Object.entries(cells)) {
    const input =
      cell.input.position.y >= yThresholdMm
        ? {
            ...cell.input,
            position: {
              ...cell.input.position,
              y: cell.input.position.y + deltaMm
            }
          }
        : cell.input;
    const outputs = cell.outputs.map(o =>
      o.position.y >= yThresholdMm
        ? { ...o, position: { ...o.position, y: o.position.y + deltaMm } }
        : o
    );
    out[id] = { ...cell, input, outputs };
  }
  return out;
}

/**
 * Returns true if any summary-mode cell on the canvas overlaps the y-band
 * `[topMm, bottomMm)`. Used to refuse deletion of a non-empty page.
 */
export function summaryCellsOnPage(
  cells: Record<string, ICellLayout>,
  topMm: number,
  bottomMm: number
): boolean {
  for (const cell of Object.values(cells)) {
    if (cell.mode !== 'summary') {
      continue;
    }
    const inputBot = cell.input.position.y + cell.input.size.height;
    if (inputBot > topMm && cell.input.position.y < bottomMm) {
      return true;
    }
    for (const o of cell.outputs) {
      if (!o.enabled) {
        continue;
      }
      const outBot = o.position.y + o.size.height;
      if (outBot > topMm && o.position.y < bottomMm) {
        return true;
      }
    }
  }
  return false;
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
  private readonly _layoutChanged = new Signal<this, void>(this);
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

  /**
   * Emitted after `persistLayout` writes a single cell's position / size /
   * z-index. `changed` only fires on add/remove/reorder, so listeners that
   * care about cells moving (e.g. the ToC sidebar, which buckets cells by
   * page) need this finer-grained signal.
   */
  get layoutChanged(): ISignal<this, void> {
    return this._layoutChanged;
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
    this._layoutChanged.emit();
  }

  /**
   * If any cell extends past the current canvas, bump page_count up to fit.
   * Never shrinks — page removal is user-initiated. Returns true if
   * page_count grew.
   *
   * Uses render-aware bottom calculation: an output slot whose cell has
   * no items routed to it isn't rendered, so its stale metadata position
   * (e.g. left over from before a kernel restart) shouldn't keep the
   * canvas tall. Without this guard, deleting a trailing empty page used
   * to silently re-grow the page count back, making the delete look
   * like it had failed.
   */
  ensureEnoughPages(): boolean {
    const layout = this.manager.read();
    const needed = this._computeRequiredPageCountRenderAware();
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

  private _computeRequiredPageCountRenderAware(): number {
    const layout = this.manager.read();
    const pageHeight = pageHeightMmFor(layout.settings);
    let maxBottom = 0;
    for (const entry of this.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      const input = entry.layout.input;
      maxBottom = Math.max(
        maxBottom,
        input.position.y + input.size.height
      );
      if (entry.cellModel.type !== 'code') {
        continue;
      }
      const codeCell = entry.cellModel as ICodeCellModel;
      if (codeCell.outputs.length === 0) {
        continue;
      }
      const items: nbformat.IOutput[] = [];
      for (let i = 0; i < codeCell.outputs.length; i++) {
        items.push(codeCell.outputs.get(i).toJSON() as nbformat.IOutput);
      }
      const routed = new OutputProcessor().route(items);
      for (const o of entry.layout.outputs) {
        if (!o.enabled) {
          continue;
        }
        const slotItems =
          o.output_id === 'output_a' ? routed.output_a : routed.output_b;
        if (slotItems.length === 0) {
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

  /**
   * Insert a new blank page at index `idx` (0-based). Cells whose top edge
   * is at or below `idx * pageHeight` shift down by one pageHeight to make
   * room. Refuses if `page_count` is already at the cap.
   *
   * Range of `idx`: 0..pageCount inclusive. `idx === pageCount` is the same
   * as appending a page.
   */
  insertPageAt(idx: number): { ok: boolean; message?: string } {
    const layout = this.manager.read();
    if (layout.settings.page_count >= MAX_PAGE_COUNT) {
      return {
        ok: false,
        message: `Page limit reached (${MAX_PAGE_COUNT}).`
      };
    }
    const clampedIdx = Math.max(
      0,
      Math.min(idx, layout.settings.page_count)
    );
    const pageHeight = pageHeightMmFor(layout.settings);
    const insertY = clampedIdx * pageHeight;
    this.manager.update(l => ({
      ...l,
      settings: { ...l.settings, page_count: l.settings.page_count + 1 },
      cells: shiftCellsAtOrBelow(l.cells, insertY, pageHeight)
    }));
    this._settingsChanged.emit();
    this._changed.emit();
    return { ok: true };
  }

  /**
   * Delete page `idx` (0-based). Refuses if any summary-mode cell *renders*
   * on that page (input box, or an output slot whose cell currently has
   * routed items for that slot) or if it's the only page. Cells below shift
   * up by one pageHeight to close the gap.
   *
   * The check matches `summary-cell.ts` rendering rules: empty / unrouted
   * output slots are not rendered and so don't block deletion, even though
   * their saved metadata may sit on this page.
   */
  deletePageAt(idx: number): { ok: boolean; message?: string } {
    const layout = this.manager.read();
    if (layout.settings.page_count <= 1) {
      return { ok: false, message: 'Cannot delete the only page.' };
    }
    const clampedIdx = Math.max(
      0,
      Math.min(idx, layout.settings.page_count - 1)
    );
    const pageHeight = pageHeightMmFor(layout.settings);
    const top = clampedIdx * pageHeight;
    const bot = top + pageHeight;
    const blocker = this._findRenderedSlotOnPage(top, bot);
    if (blocker !== null) {
      return {
        ok: false,
        message: `Page ${clampedIdx + 1} has cells on it. Move or exclude them first.`
      };
    }
    this.manager.update(l => ({
      ...l,
      settings: { ...l.settings, page_count: l.settings.page_count - 1 },
      cells: shiftCellsAtOrBelow(l.cells, bot, -pageHeight)
    }));
    this._settingsChanged.emit();
    this._changed.emit();
    return { ok: true };
  }

  /**
   * Walk live cell models and check whether any *rendered* slot overlaps the
   * y-band [topMm, bottomMm). Returns the offending cell id, or null if the
   * page is clear. Mirrors summary-cell.ts: an output slot only counts when
   * its cell currently has items routed to it.
   */
  private _findRenderedSlotOnPage(
    topMm: number,
    bottomMm: number
  ): string | null {
    const overlaps = (
      yMm: number,
      hMm: number
    ): boolean => yMm + hMm > topMm && yMm < bottomMm;
    for (const entry of this.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      const input = entry.layout.input;
      if (overlaps(input.position.y, input.size.height)) {
        return entry.cellModel.id;
      }
      if (entry.cellModel.type !== 'code') {
        continue;
      }
      const codeCell = entry.cellModel as ICodeCellModel;
      if (codeCell.outputs.length === 0) {
        continue;
      }
      const items: nbformat.IOutput[] = [];
      for (let i = 0; i < codeCell.outputs.length; i++) {
        items.push(codeCell.outputs.get(i).toJSON() as nbformat.IOutput);
      }
      const routed = new OutputProcessor().route(items);
      for (const o of entry.layout.outputs) {
        if (!o.enabled) {
          continue;
        }
        const slotItems =
          o.output_id === 'output_a' ? routed.output_a : routed.output_b;
        if (slotItems.length === 0) {
          continue;
        }
        if (overlaps(o.position.y, o.size.height)) {
          return entry.cellModel.id;
        }
      }
    }
    return null;
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
