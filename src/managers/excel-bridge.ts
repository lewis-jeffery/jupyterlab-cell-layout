import type { NotebookPanel } from '@jupyterlab/notebook';

import type { IExcelLink } from './metadata';

const TARGET = 'jupyterlab-cell-layout:excel';

export type CellValue = string | number | boolean | null;

export interface IExcelReadResult {
  rows: ReadonlyArray<ReadonlyArray<CellValue>>;
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

/**
 * Per-notebook Comm client for the kernel-side `excel_bridge.py`.
 *
 * Phase 1: each `read` opens a fresh Comm, sends one request, awaits one
 * response, then closes. Re-using a long-lived comm is a future
 * optimisation; the latency of open-then-close is fine for manual refresh.
 */
export class ExcelBridge {
  private _next = 1;

  constructor(private readonly panel: NotebookPanel) {}

  async read(link: IExcelLink): Promise<IExcelReadResult> {
    const kernel = this.panel.sessionContext.session?.kernel;
    if (!kernel) {
      throw new Error(
        'No active kernel — start the kernel and run `from jupyterlab_cell_layout.excel_bridge import register; register()`'
      );
    }
    const requestId = `r${this._next++}`;
    const comm = kernel.createComm(TARGET) as unknown as IComm;
    return new Promise<IExcelReadResult>((resolve, reject) => {
      let settled = false;
      const settle = (
        action: 'resolve' | 'reject',
        value: IExcelReadResult | Error
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          comm.close();
        } catch {
          /* ignore */
        }
        if (action === 'resolve') {
          resolve(value as IExcelReadResult);
        } else {
          reject(value as Error);
        }
      };
      comm.onMsg = (msg: IIncomingMsg) => {
        const data = (msg.content?.data ?? {}) as {
          type?: string;
          request_id?: string;
          rows?: unknown;
          message?: string;
        };
        if (data.request_id !== requestId) {
          return;
        }
        if (data.type === 'data') {
          settle('resolve', {
            rows: coerceRows(data.rows)
          });
        } else if (data.type === 'error') {
          settle(
            'reject',
            new Error(data.message ?? 'Unknown error from kernel')
          );
        }
      };
      comm.onClose = () => {
        settle(
          'reject',
          new Error(
            'Excel bridge not registered on the kernel. Run: ' +
              '`from jupyterlab_cell_layout.excel_bridge import register; register()`'
          )
        );
      };
      try {
        comm.open();
        comm.send({
          type: 'read',
          request_id: requestId,
          workbook: link.workbook,
          sheet: link.sheet,
          range: link.range
        });
      } catch (err) {
        settle('reject', err as Error);
      }
    });
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
