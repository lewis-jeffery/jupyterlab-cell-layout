import { INotebookModel } from '@jupyterlab/notebook';

export const LAYOUT_METADATA_KEY = 'cell_layout';
export const LAYOUT_SCHEMA_VERSION = '1.0';

export type PageSize = 'A4' | 'A3';
export type PageOrientation = 'portrait' | 'landscape';
export type NotebookMode = 'summary' | 'edit';
export type CellMode = 'summary' | 'edit';
export type CellType = 'code' | 'markdown' | 'raw';
export type OutputSlotId = 'output_a' | 'output_b';
export type OutputClassification = 'text' | 'graphics' | 'mixed';

export const PAGE_SIZES_MM: Record<PageSize, { width: number; height: number }> =
  {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 }
  };

export const DEFAULT_PAGE_SIZE: PageSize = 'A4';
export const DEFAULT_PAGE_ORIENTATION: PageOrientation = 'portrait';
export const DEFAULT_GRID_SNAP_MM = 5;
export const DEFAULT_SUMMARY_LINES = 3;

export interface IPosition {
  x: number;
  y: number;
}

export interface ISize {
  width: number;
  height: number;
}

export interface IInputLayout {
  position: IPosition;
  size: ISize;
  visible_lines: number;
  z_index: number;
  auto_fit: boolean;
}

export interface IOutputLayout {
  output_id: OutputSlotId;
  type: OutputClassification;
  position: IPosition;
  size: ISize;
  visible_lines: number | null;
  z_index: number;
  max_image_width: number;
  enabled: boolean;
  auto_fit: boolean;
}

export interface ICellLayout {
  type: CellType;
  mode: CellMode;
  input: IInputLayout;
  outputs: IOutputLayout[];
}

export interface ILayoutSettings {
  page_size: PageSize;
  orientation: PageOrientation;
  grid_snap: number;
  default_summary_lines: number;
  notebook_mode: NotebookMode;
}

export interface INotebookLayout {
  version: string;
  enabled: boolean;
  settings: ILayoutSettings;
  cells: Record<string, ICellLayout>;
}

export function defaultSettings(): ILayoutSettings {
  return {
    page_size: DEFAULT_PAGE_SIZE,
    orientation: DEFAULT_PAGE_ORIENTATION,
    grid_snap: DEFAULT_GRID_SNAP_MM,
    default_summary_lines: DEFAULT_SUMMARY_LINES,
    notebook_mode: 'edit'
  };
}

export function defaultNotebookLayout(): INotebookLayout {
  return {
    version: LAYOUT_SCHEMA_VERSION,
    enabled: false,
    settings: defaultSettings(),
    cells: {}
  };
}

export function defaultInputLayout(): IInputLayout {
  return {
    position: { x: 0, y: 0 },
    size: { width: 150, height: 40 },
    visible_lines: DEFAULT_SUMMARY_LINES,
    z_index: 1,
    auto_fit: true
  };
}

export function defaultOutputLayout(
  slot: OutputSlotId,
  classification: OutputClassification
): IOutputLayout {
  const isGraphics = classification === 'graphics';
  return {
    output_id: slot,
    type: classification,
    position: { x: 0, y: 50 },
    size: { width: isGraphics ? 120 : 150, height: isGraphics ? 90 : 60 },
    visible_lines: isGraphics ? null : 10,
    z_index: 2,
    max_image_width: isGraphics ? 110 : 140,
    enabled: true,
    auto_fit: true
  };
}

export function defaultCellLayout(type: CellType): ICellLayout {
  return {
    type,
    mode: 'edit',
    input: defaultInputLayout(),
    outputs: []
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function numberOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function positiveIntOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : fallback;
}

function normalizePosition(raw: unknown): IPosition {
  if (!isObject(raw)) {
    return { x: 0, y: 0 };
  }
  return { x: numberOr(raw.x, 0), y: numberOr(raw.y, 0) };
}

function normalizeSize(raw: unknown, fallback: ISize): ISize {
  if (!isObject(raw)) {
    return { ...fallback };
  }
  return {
    width: numberOr(raw.width, fallback.width),
    height: numberOr(raw.height, fallback.height)
  };
}

function normalizeInput(raw: unknown): IInputLayout {
  const fallback = defaultInputLayout();
  if (!isObject(raw)) {
    return fallback;
  }
  return {
    position: normalizePosition(raw.position),
    size: normalizeSize(raw.size, fallback.size),
    visible_lines: positiveIntOr(raw.visible_lines, fallback.visible_lines),
    z_index: numberOr(raw.z_index, fallback.z_index),
    auto_fit:
      typeof raw.auto_fit === 'boolean' ? raw.auto_fit : fallback.auto_fit
  };
}

function normalizeOutput(raw: unknown, fallbackSlot: OutputSlotId): IOutputLayout {
  const fallback = defaultOutputLayout(fallbackSlot, 'text');
  if (!isObject(raw)) {
    return fallback;
  }
  const slot: OutputSlotId =
    raw.output_id === 'output_a' || raw.output_id === 'output_b'
      ? raw.output_id
      : fallbackSlot;
  const classification: OutputClassification =
    raw.type === 'graphics' || raw.type === 'mixed' ? raw.type : 'text';
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : true;
  const visibleLinesRaw = raw.visible_lines;
  let visibleLines: number | null;
  if (visibleLinesRaw === null) {
    visibleLines = null;
  } else if (
    typeof visibleLinesRaw === 'number' &&
    Number.isFinite(visibleLinesRaw) &&
    visibleLinesRaw >= 1
  ) {
    visibleLines = Math.floor(visibleLinesRaw);
  } else {
    visibleLines = classification === 'graphics' ? null : 10;
  }
  const auto_fit =
    typeof raw.auto_fit === 'boolean' ? raw.auto_fit : fallback.auto_fit;
  return {
    output_id: slot,
    type: classification,
    position: normalizePosition(raw.position),
    size: normalizeSize(raw.size, fallback.size),
    visible_lines: visibleLines,
    z_index: numberOr(raw.z_index, fallback.z_index),
    max_image_width: numberOr(raw.max_image_width, fallback.max_image_width),
    enabled,
    auto_fit
  };
}

function normalizeOutputs(raw: unknown): IOutputLayout[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .slice(0, 2)
    .map((item, idx) =>
      normalizeOutput(item, idx === 0 ? 'output_a' : 'output_b')
    );
}

export function normalizeCell(raw: unknown): ICellLayout | null {
  if (!isObject(raw)) {
    return null;
  }
  const type: CellType =
    raw.type === 'markdown' || raw.type === 'raw' ? raw.type : 'code';
  const mode: CellMode = raw.mode === 'summary' ? 'summary' : 'edit';
  return {
    type,
    mode,
    input: normalizeInput(raw.input),
    outputs: normalizeOutputs(raw.outputs)
  };
}

function normalizeCells(raw: unknown): Record<string, ICellLayout> {
  if (!isObject(raw)) {
    return {};
  }
  const result: Record<string, ICellLayout> = {};
  for (const [id, cell] of Object.entries(raw)) {
    const normalized = normalizeCell(cell);
    if (normalized) {
      result[id] = normalized;
    }
  }
  return result;
}

export function normalizeSettings(raw: unknown): ILayoutSettings {
  const fallback = defaultSettings();
  if (!isObject(raw)) {
    return fallback;
  }
  const page_size: PageSize = raw.page_size === 'A3' ? 'A3' : 'A4';
  const orientation: PageOrientation =
    raw.orientation === 'landscape' ? 'landscape' : 'portrait';
  const grid_snap =
    typeof raw.grid_snap === 'number' &&
    Number.isFinite(raw.grid_snap) &&
    raw.grid_snap >= 0
      ? raw.grid_snap
      : fallback.grid_snap;
  const default_summary_lines = positiveIntOr(
    raw.default_summary_lines,
    fallback.default_summary_lines
  );
  const notebook_mode: NotebookMode =
    raw.notebook_mode === 'summary' ? 'summary' : 'edit';
  return {
    page_size,
    orientation,
    grid_snap,
    default_summary_lines,
    notebook_mode
  };
}

export function normalizeLayout(raw: unknown): INotebookLayout {
  if (!isObject(raw)) {
    return defaultNotebookLayout();
  }
  return {
    version:
      typeof raw.version === 'string' ? raw.version : LAYOUT_SCHEMA_VERSION,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    settings: normalizeSettings(raw.settings),
    cells: normalizeCells(raw.cells)
  };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MetadataManager {
  constructor(private readonly model: INotebookModel) {}

  read(): INotebookLayout {
    const raw = this.model.getMetadata(LAYOUT_METADATA_KEY);
    return normalizeLayout(raw);
  }

  write(layout: INotebookLayout): void {
    this.model.setMetadata(LAYOUT_METADATA_KEY, jsonClone(layout));
  }

  update(
    mutator: (layout: INotebookLayout) => INotebookLayout
  ): INotebookLayout {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }

  getCell(cellId: string): ICellLayout | undefined {
    return this.read().cells[cellId];
  }

  setCell(cellId: string, cell: ICellLayout): void {
    this.update(layout => ({
      ...layout,
      cells: { ...layout.cells, [cellId]: cell }
    }));
  }

  deleteCell(cellId: string): void {
    this.update(layout => {
      const nextCells = { ...layout.cells };
      delete nextCells[cellId];
      return { ...layout, cells: nextCells };
    });
  }

  pageSizeMM(): { width: number; height: number } {
    return { ...PAGE_SIZES_MM[this.read().settings.page_size] };
  }
}
