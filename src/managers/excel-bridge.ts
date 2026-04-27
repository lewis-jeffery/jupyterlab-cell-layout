import type { NotebookPanel } from '@jupyterlab/notebook';

import type { IExcelLink } from './metadata';

const TARGET = 'jupyterlab-cell-layout:excel';

export type CellValue = string | number | boolean | null;

/** Per-cell horizontal alignment as seen in Excel. `null` = unknown. */
export type Alignment = 'left' | 'center' | 'right' | 'general' | null;

export interface IExcelReadResult {
  rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  alignments: ReadonlyArray<ReadonlyArray<Alignment>>;
}

export interface ISubscriptionHandler {
  /** Called whenever the kernel pushes new data for this subscription. */
  onData: (rows: CellValue[][], alignments: Alignment[][]) => void;
  /** Called when the kernel reports an error for this subscription. */
  onError: (message: string) => void;
}

export interface ISubscription {
  dispose: () => void;
}

interface IComm {
  onMsg: ((msg: { content: { data: unknown } }) => void) | null;
  onClose: ((msg: unknown) => void) | null;
  open(): unknown;
  send(data: unknown): unknown;
  close(): unknown;
}

interface IIncomingMsg {
  content: { data: unknown };
}

interface IReadWaiter {
  resolve: (value: IExcelReadResult) => void;
  reject: (err: Error) => void;
}

const NOT_REGISTERED_MSG =
  'Excel bridge not registered on the kernel. Run: ' +
  '`from jupyterlab_cell_layout.excel_bridge import register; register()`';

/**
 * Per-notebook client for the kernel-side `excel_bridge.py`.
 *
 * Maintains a single long-lived Comm so the kernel can push subscription
 * updates without us reopening on every read. One-shot reads still work
 * (request_id correlates with a Promise) and live alongside subscriptions
 * (subscription_key correlates with a handler).
 */
export class ExcelBridge {
  private _comm: IComm | null = null;
  private _readWaiters = new Map<string, IReadWaiter>();
  private _subscribers = new Map<string, ISubscriptionHandler>();
  private _next = 1;
  private _disposed = false;

  constructor(private readonly panel: NotebookPanel) {}

  dispose(): void {
    this._disposed = true;
    this._closeComm();
  }

  /**
   * One-shot read — returns the current value of the named range. Used by
   * the manual ⟳ refresh button. Independent of any subscription.
   */
  async read(link: IExcelLink): Promise<IExcelReadResult> {
    const comm = this._ensureComm();
    if (!comm) {
      throw new Error('No active kernel — start the kernel first');
    }
    const requestId = `r${this._next++}`;
    return new Promise<IExcelReadResult>((resolve, reject) => {
      this._readWaiters.set(requestId, { resolve, reject });
      try {
        comm.send({
          type: 'read',
          request_id: requestId,
          workbook: link.workbook,
          sheet: link.sheet,
          range: link.range
        });
      } catch (err) {
        this._readWaiters.delete(requestId);
        reject(err as Error);
      }
    });
  }

  /**
   * Subscribe for live updates. The handler's `onData` fires immediately
   * with the initial value, then again every time the kernel observes a
   * change. Returns an `ISubscription` whose `dispose()` tells the kernel
   * to stop polling for this range.
   */
  subscribe(link: IExcelLink, handler: ISubscriptionHandler): ISubscription {
    const comm = this._ensureComm();
    const key = `s${this._next++}`;
    if (!comm) {
      handler.onError('No active kernel — start the kernel first');
      return { dispose: () => undefined };
    }
    this._subscribers.set(key, handler);
    try {
      comm.send({
        type: 'subscribe',
        subscription_key: key,
        workbook: link.workbook,
        sheet: link.sheet,
        range: link.range
      });
    } catch (err) {
      this._subscribers.delete(key);
      handler.onError((err as Error).message ?? String(err));
      return { dispose: () => undefined };
    }
    return {
      dispose: () => this._unsubscribe(key)
    };
  }

  private _unsubscribe(key: string): void {
    if (!this._subscribers.delete(key)) {
      return;
    }
    if (!this._comm) {
      return;
    }
    try {
      this._comm.send({ type: 'unsubscribe', subscription_key: key });
    } catch {
      /* best-effort — comm may already be gone */
    }
  }

  private _ensureComm(): IComm | null {
    if (this._disposed) {
      return null;
    }
    if (this._comm) {
      return this._comm;
    }
    const kernel = this.panel.sessionContext.session?.kernel;
    if (!kernel) {
      return null;
    }
    const comm = kernel.createComm(TARGET) as unknown as IComm;
    comm.onMsg = msg => this._handleMsg(msg);
    comm.onClose = () => this._handleClose();
    try {
      comm.open();
    } catch {
      return null;
    }
    this._comm = comm;
    return comm;
  }

  private _closeComm(): void {
    if (!this._comm) {
      return;
    }
    try {
      this._comm.close();
    } catch {
      /* ignore */
    }
    this._comm = null;
  }

  private _handleMsg(msg: IIncomingMsg): void {
    const data = (msg.content?.data ?? {}) as {
      type?: string;
      request_id?: string;
      subscription_key?: string;
      rows?: unknown;
      alignments?: unknown;
      message?: string;
    };
    // Read replies are correlated by request_id.
    if (data.request_id) {
      const waiter = this._readWaiters.get(data.request_id);
      if (!waiter) {
        return;
      }
      this._readWaiters.delete(data.request_id);
      if (data.type === 'data') {
        const rows = coerceRows(data.rows);
        waiter.resolve({
          rows,
          alignments: coerceAlignments(data.alignments, rows)
        });
      } else {
        waiter.reject(
          new Error(data.message ?? 'Unknown error from kernel')
        );
      }
      return;
    }
    // Subscription pushes are correlated by subscription_key.
    if (data.subscription_key) {
      const handler = this._subscribers.get(data.subscription_key);
      if (!handler) {
        return;
      }
      if (data.type === 'data') {
        const rows = coerceRows(data.rows);
        handler.onData(rows, coerceAlignments(data.alignments, rows));
      } else if (data.type === 'error') {
        handler.onError(data.message ?? 'Unknown error from kernel');
      }
    }
  }

  private _handleClose(): void {
    // Fire onError for every active subscriber + read-waiter so they can
    // surface the disconnect, then drop our state. Most likely cause: the
    // user hasn't called register() on the kernel.
    for (const handler of this._subscribers.values()) {
      handler.onError(NOT_REGISTERED_MSG);
    }
    for (const waiter of this._readWaiters.values()) {
      waiter.reject(new Error(NOT_REGISTERED_MSG));
    }
    this._subscribers.clear();
    this._readWaiters.clear();
    this._comm = null;
  }
}

function coerceRows(raw: unknown): CellValue[][] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(row =>
    Array.isArray(row) ? row.map(cell => coerceValue(cell)) : []
  );
}

function coerceValue(v: unknown): CellValue {
  if (v === null) {
    return null;
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  return String(v);
}

/**
 * Coerce the `alignments` field from a comm payload into a 2-D array
 * shape-matched to `rows`. Older kernels (or read failures) may omit
 * alignments — in that case every cell is `null` (means "render with
 * default alignment").
 */
function coerceAlignments(
  raw: unknown,
  rows: CellValue[][]
): Alignment[][] {
  const out: Alignment[][] = [];
  const fallbackRow = (width: number): Alignment[] =>
    Array.from({ length: width }, () => null);
  if (!Array.isArray(raw)) {
    return rows.map(r => fallbackRow(r.length));
  }
  for (let i = 0; i < rows.length; i++) {
    const width = rows[i].length;
    const rawRow = raw[i];
    if (!Array.isArray(rawRow)) {
      out.push(fallbackRow(width));
      continue;
    }
    const row: Alignment[] = [];
    for (let j = 0; j < width; j++) {
      row.push(coerceAlignment(rawRow[j]));
    }
    out.push(row);
  }
  return out;
}

function coerceAlignment(v: unknown): Alignment {
  if (v === 'left' || v === 'center' || v === 'right' || v === 'general') {
    return v;
  }
  return null;
}
