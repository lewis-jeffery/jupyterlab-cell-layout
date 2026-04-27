import { Widget } from '@lumino/widgets';

import type {
  Alignment,
  CellValue,
  ExcelBridge,
  IExcelFormats,
  ISubscription
} from '../managers/excel-bridge';
import type {
  IExcelLink,
  IInputLayout,
  IPosition,
  ISize
} from '../managers/metadata';

import {
  enableDrag,
  type IDragController,
  type ISnapHandler
} from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { mmToPx } from './units';

export interface IExcelCellCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  snapHandler?: ISnapHandler;
}

export interface IExcelCellOptions {
  displayLabel: string;
  link: IExcelLink;
  bridge?: ExcelBridge;
  callbacks?: IExcelCellCallbacks;
}

export class SummaryExcelCell extends Widget {
  private _inputLayout: IInputLayout;
  private _displayLabel: string;
  private _link: IExcelLink;
  private _bridge?: ExcelBridge;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;
  private _bodyEl?: HTMLElement;
  private _statusEl?: HTMLElement;
  private _isFetching = false;
  private _excelDisposed = false;
  private _currentFetch: Promise<void> = Promise.resolve();
  private _subscription: ISubscription | null = null;
  private _initialPushReceived = false;

  constructor(layout: IInputLayout, options: IExcelCellOptions) {
    super();
    this._inputLayout = layout;
    this._displayLabel = options.displayLabel;
    this._link = options.link;
    this._bridge = options.bridge;
    this.addClass('jp-CellLayout-excel');
    this.addClass('jp-CellLayout-input');
    this._applyLayout();
    this._renderShell();
    this._startSubscription();
    const callbacks = options.callbacks;
    if (callbacks) {
      this._dragCtl = enableDrag(
        this.node,
        () => this._inputLayout.position,
        pos => {
          this._inputLayout = { ...this._inputLayout, position: pos };
          callbacks.onPositionChange(pos);
        },
        {
          getGridSnapMm: callbacks.getGridSnapMm,
          onInteract: callbacks.onInteract,
          snapHandler: callbacks.snapHandler
        }
      );
      this._resizeCtl = enableResize(
        this.node,
        () => ({
          position: this._inputLayout.position,
          size: this._inputLayout.size
        }),
        geom => {
          this._inputLayout = {
            ...this._inputLayout,
            position: geom.position,
            size: geom.size
          };
          callbacks.onGeometryChange(geom.position, geom.size);
        },
        {
          getGridSnapMm: callbacks.getGridSnapMm,
          onInteract: callbacks.onInteract,
          snapHandler: callbacks.snapHandler
        }
      );
    }
  }

  setZIndex(z: number): void {
    this._inputLayout = { ...this._inputLayout, z_index: z };
    this.node.style.zIndex = String(z);
  }

  dispose(): void {
    this._excelDisposed = true;
    this._subscription?.dispose();
    this._subscription = null;
    this._dragCtl?.dispose();
    this._resizeCtl?.dispose();
    super.dispose();
  }

  /**
   * Open the live subscription for this cell's named range. The kernel sends
   * an initial value immediately and then pushes again whenever the range
   * changes. The first push resolves `_currentFetch` so the PDF exporter
   * (which awaits all cells) can capture the rendered table.
   */
  private _startSubscription(): void {
    if (!this._bridge) {
      this._showStatus('No kernel link available');
      return;
    }
    this._isFetching = true;
    this._showStatus('Reading…');
    this.node.classList.add('jp-CellLayout-excelLoading');
    let resolveInitial: (() => void) | null = null;
    this._currentFetch = new Promise<void>(resolve => {
      resolveInitial = resolve;
    });
    const settle = (): void => {
      if (this._isFetching) {
        this._isFetching = false;
        this.node.classList.remove('jp-CellLayout-excelLoading');
      }
      if (resolveInitial) {
        resolveInitial();
        resolveInitial = null;
      }
      this._initialPushReceived = true;
    };
    this._subscription = this._bridge.subscribe(this._link, {
      onData: (rows, formats) => {
        if (this._excelDisposed) {
          return;
        }
        this._renderTable(rows, formats);
        const stamp = new Date().toLocaleTimeString();
        this._showStatus(`${this._link.sheet}!${this._link.range} · ${stamp}`);
        settle();
      },
      onError: msg => {
        if (this._excelDisposed) {
          return;
        }
        if (!this._initialPushReceived) {
          this._renderTable([], emptyFormats());
        }
        this._showStatus(`Error: ${msg}`, true);
        settle();
      }
    });
  }

  private _applyLayout(): void {
    const n = this.node;
    n.style.position = 'absolute';
    n.style.left = `${mmToPx(this._inputLayout.position.x)}px`;
    n.style.top = `${mmToPx(this._inputLayout.position.y)}px`;
    n.style.width = `${mmToPx(this._inputLayout.size.width)}px`;
    n.style.height = `${mmToPx(this._inputLayout.size.height)}px`;
    n.style.zIndex = String(this._inputLayout.z_index);
  }

  private _renderShell(): void {
    const n = this.node;
    n.replaceChildren();

    const grip = document.createElement('div');
    grip.className = 'jp-CellLayout-dragHandle';
    grip.setAttribute('aria-hidden', 'true');
    n.appendChild(grip);

    const label = document.createElement('div');
    label.className = 'jp-CellLayout-label';
    label.textContent = `${this._displayLabel} · xl`;
    n.appendChild(label);

    const goto = document.createElement('button');
    goto.type = 'button';
    goto.className = 'jp-CellLayout-gotoButton';
    goto.title = 'Go to next related slot';
    goto.setAttribute('aria-label', 'Go to next related slot');
    goto.textContent = '→';
    n.appendChild(goto);

    const refresh = document.createElement('button');
    refresh.className = 'jp-CellLayout-excelRefresh';
    refresh.type = 'button';
    refresh.title = `Refresh ${this._link.sheet}!${this._link.range} from ${this._link.workbook}`;
    refresh.textContent = '⟳';
    refresh.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      void this._fetch();
    });
    refresh.addEventListener('pointerdown', e => {
      e.stopPropagation();
    });
    n.appendChild(refresh);

    const body = document.createElement('div');
    body.className = 'jp-CellLayout-excelBody';
    n.appendChild(body);
    this._bodyEl = body;

    const status = document.createElement('div');
    status.className = 'jp-CellLayout-excelStatus';
    n.appendChild(status);
    this._statusEl = status;
  }

  /**
   * Resolves once any in-flight fetch has settled. Used by the PDF exporter
   * to make sure the rendered table has actually arrived before html2canvas
   * snapshots the DOM.
   */
  awaitReady(): Promise<void> {
    return this._currentFetch;
  }

  private _fetch(): Promise<void> {
    this._currentFetch = this._fetchInner();
    return this._currentFetch;
  }

  private async _fetchInner(): Promise<void> {
    if (this._isFetching || this._excelDisposed) {
      return;
    }
    if (!this._bridge) {
      this._showStatus('No kernel link available');
      return;
    }
    this._isFetching = true;
    this._showStatus('Reading…');
    this.node.classList.add('jp-CellLayout-excelLoading');
    try {
      const result = await this._bridge.read(this._link);
      if (this._excelDisposed) {
        return;
      }
      this._renderTable(result.rows, result.formats);
      const stamp = new Date().toLocaleTimeString();
      this._showStatus(`${this._link.sheet}!${this._link.range} · ${stamp}`);
    } catch (err) {
      if (this._excelDisposed) {
        return;
      }
      this._renderTable([], emptyFormats());
      this._showStatus(
        `Error: ${(err as Error).message ?? String(err)}`,
        true
      );
    } finally {
      this._isFetching = false;
      this.node.classList.remove('jp-CellLayout-excelLoading');
    }
  }

  private _renderTable(
    rows: ReadonlyArray<ReadonlyArray<CellValue>>,
    formats: IExcelFormats
  ): void {
    const body = this._bodyEl;
    if (!body) {
      return;
    }
    body.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jp-CellLayout-excelEmpty';
      empty.textContent = '(empty range)';
      body.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    table.className = 'jp-CellLayout-excelTable';
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const tr = document.createElement('tr');
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const td = document.createElement('td');
        td.textContent = formatCell(cell);
        applyCellFormatting(td, cell, {
          align: formats.align[r]?.[c] ?? null,
          bold: formats.bold[r]?.[c] ?? null,
          italic: formats.italic[r]?.[c] ?? null,
          fg: formats.fg[r]?.[c] ?? null,
          bg: formats.bg[r]?.[c] ?? null
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    body.appendChild(table);
  }

  private _showStatus(message: string, isError = false): void {
    const status = this._statusEl;
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.toggle('jp-CellLayout-excelStatusError', isError);
  }
}

function formatCell(v: CellValue): string {
  if (v === null) {
    return '';
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      return String(v);
    }
    return String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
}

interface IPerCellFormats {
  align: Alignment;
  bold: boolean | null;
  italic: boolean | null;
  fg: string | null;
  bg: string | null;
}

/** Apply Excel's per-cell formatting to a `<td>`. Explicit values from
 * Excel win; unknowns fall back to defaults that match Excel's rendering
 * (numbers right-aligned by default; black text on no fill). */
function applyCellFormatting(
  td: HTMLTableCellElement,
  value: CellValue,
  fmt: IPerCellFormats
): void {
  if (fmt.align === 'left' || fmt.align === 'center' || fmt.align === 'right') {
    td.style.textAlign = fmt.align;
  } else if (typeof value === 'number') {
    td.classList.add('jp-CellLayout-excelNum');
  }
  if (fmt.bold === true) {
    td.style.fontWeight = 'bold';
  }
  if (fmt.italic === true) {
    td.style.fontStyle = 'italic';
  }
  if (fmt.fg) {
    td.style.color = fmt.fg;
  }
  if (fmt.bg) {
    td.style.backgroundColor = fmt.bg;
  }
}

/** A fully-shaped, all-empty IExcelFormats for the error fallback path. */
function emptyFormats(): IExcelFormats {
  return {
    align: [],
    bold: [],
    italic: [],
    fg: [],
    bg: []
  };
}
