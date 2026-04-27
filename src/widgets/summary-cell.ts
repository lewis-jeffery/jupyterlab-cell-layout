import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type { IEditorServices } from '@jupyterlab/codeeditor';
import type * as nbformat from '@jupyterlab/nbformat';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import type { Widget } from '@lumino/widgets';

import type { CellCoordinator } from '../managers/cell-coordinator';
import type { ExcelBridge } from '../managers/excel-bridge';
import { OutputProcessor } from '../managers/output-processor';
import type { ICellLayout, OutputSlotId } from '../managers/metadata';

import type { ISnapHandler } from './draggable';
import { SummaryExcelCell } from './summary-excel-cell';
import { SummaryInputCell } from './summary-input-cell';
import { SummaryOutputCell } from './summary-output-cell';

export type SlotKey = 'input' | OutputSlotId;

export interface ISnapHandlerFactory {
  (cellId: string, slot: SlotKey): ISnapHandler | null;
}

export interface ISummaryCellOptions {
  displayIndex: number;
  coordinator?: CellCoordinator;
  rendermime?: IRenderMimeRegistry;
  excelBridge?: ExcelBridge;
  editorServices?: IEditorServices;
  onRunCell?: (cellId: string) => void;
  onInteract?: () => void;
  snapHandlerFactory?: ISnapHandlerFactory;
}

/**
 * Logical wrapper around one notebook cell's summary-mode presentation.
 *
 * Most cells own a SummaryInputCell + 0..2 SummaryOutputCell widgets. Cells
 * with `layout.excel` set are rendered as a single SummaryExcelCell that
 * mirrors a named range from an Excel workbook (read-only in Phase 1).
 *
 * Not itself a Lumino Widget — it returns the widgets to attach to the canvas.
 */
export class SummaryCellWidget {
  readonly cellId: string;
  readonly outputs: SummaryOutputCell[];
  private _main: SummaryInputCell | SummaryExcelCell;
  private _zIndex: number;

  constructor(
    cellModel: ICellModel,
    layout: ICellLayout,
    options: ISummaryCellOptions
  ) {
    this._zIndex = layout.input.z_index;
    this.cellId = cellModel.id;
    const id = this.cellId;
    const {
      coordinator,
      rendermime,
      excelBridge,
      onInteract,
      displayIndex,
      snapHandlerFactory
    } = options;
    const indexLabel = String(displayIndex);

    const getGridSnapMm = coordinator
      ? () => coordinator.gridSnapMm()
      : undefined;

    if (layout.excel) {
      const excelCallbacks = coordinator
        ? {
            onPositionChange: (pos: { x: number; y: number }) =>
              coordinator.updateInputPosition(id, pos),
            onGeometryChange: (
              pos: { x: number; y: number },
              size: { width: number; height: number }
            ) =>
              coordinator.updateInputLayout(id, {
                position: pos,
                size,
                auto_fit: false
              }),
            getGridSnapMm,
            onInteract,
            snapHandler: snapHandlerFactory?.(id, 'input') ?? undefined
          }
        : undefined;
      this._main = new SummaryExcelCell(layout.input, {
        displayLabel: indexLabel,
        link: layout.excel,
        bridge: excelBridge,
        callbacks: excelCallbacks
      });
      this._main.node.dataset.cellId = id;
      this._main.node.dataset.slot = 'input';
      this.outputs = [];
      return;
    }

    const inputCallbacks = coordinator
      ? {
          onPositionChange: (pos: { x: number; y: number }) =>
            coordinator.updateInputPosition(id, pos),
          onGeometryChange: (
            pos: { x: number; y: number },
            size: { width: number; height: number }
          ) =>
            coordinator.updateInputLayout(id, {
              position: pos,
              size,
              auto_fit: false
            }),
          getGridSnapMm,
          onInteract,
          onAutoFit: (size: { width: number; height: number }) =>
            coordinator.updateInputLayout(id, { size, auto_fit: false }),
          snapHandler: snapHandlerFactory?.(id, 'input') ?? undefined
        }
      : undefined;
    const onRunCell = options.onRunCell;
    this._main = new SummaryInputCell(cellModel, layout.input, {
      displayLabel: indexLabel,
      rendermime,
      editorServices: options.editorServices,
      onRun: onRunCell ? () => onRunCell(id) : undefined,
      callbacks: inputCallbacks
    });
    this._main.node.dataset.cellId = id;
    this._main.node.dataset.slot = 'input';
    this.outputs = [];

    const routed = routeCellOutputs(cellModel);
    for (const outLayout of layout.outputs) {
      if (!outLayout.enabled) {
        continue;
      }
      const items = selectRoutedItems(routed, outLayout.output_id);
      // Suppress empty output slots — when a code cell has produced no output
      // for this slot, don't render an empty box on the canvas. The slot's
      // saved position/size persist in metadata; if the cell later produces
      // output, it'll reappear at the same place.
      if (items.length === 0) {
        continue;
      }
      const slotId = outLayout.output_id;
      const slotLetter = slotId === 'output_a' ? 'A' : 'B';
      const outputCallbacks = coordinator
        ? {
            onPositionChange: (pos: { x: number; y: number }) =>
              coordinator.updateOutputPosition(id, slotId, pos),
            onGeometryChange: (
              pos: { x: number; y: number },
              size: { width: number; height: number }
            ) =>
              coordinator.updateOutputLayout(id, slotId, {
                position: pos,
                size,
                auto_fit: false
              }),
            getGridSnapMm,
            onInteract,
            onAutoFit: (size: { width: number; height: number }) =>
              coordinator.updateOutputLayout(id, slotId, {
                size,
                auto_fit: false
              }),
            snapHandler: snapHandlerFactory?.(id, slotId) ?? undefined
          }
        : undefined;
      const outputCell = new SummaryOutputCell(outLayout, items, {
        displayLabel: `${indexLabel}${slotLetter}`,
        callbacks: outputCallbacks
      });
      outputCell.node.dataset.cellId = id;
      outputCell.node.dataset.slot = slotId;
      this.outputs.push(outputCell);
    }
  }

  get zIndex(): number {
    return this._zIndex;
  }

  setZIndex(z: number): void {
    this._zIndex = z;
    this._main.setZIndex(z);
    for (const o of this.outputs) {
      o.setZIndex(z);
    }
  }

  widgets(): Widget[] {
    return [this._main, ...this.outputs];
  }

  /**
   * Resolved once this cell's content is ready to be captured. For Excel
   * cells this awaits the in-flight fetch; for everything else it resolves
   * immediately.
   */
  awaitReady(): Promise<void> {
    if (this._main instanceof SummaryExcelCell) {
      return this._main.awaitReady();
    }
    return Promise.resolve();
  }

  dispose(): void {
    this._main.dispose();
    for (const w of this.outputs) {
      w.dispose();
    }
  }
}

function routeCellOutputs(cellModel: ICellModel): {
  output_a: nbformat.IOutput[];
  output_b: nbformat.IOutput[];
} {
  if (cellModel.type !== 'code') {
    return { output_a: [], output_b: [] };
  }
  const model = cellModel as ICodeCellModel;
  const items: nbformat.IOutput[] = [];
  for (let i = 0; i < model.outputs.length; i++) {
    items.push(model.outputs.get(i).toJSON() as nbformat.IOutput);
  }
  const processor = new OutputProcessor();
  return processor.route(items);
}

function selectRoutedItems(
  routed: { output_a: nbformat.IOutput[]; output_b: nbformat.IOutput[] },
  slot: OutputSlotId
): nbformat.IOutput[] {
  return slot === 'output_a' ? routed.output_a : routed.output_b;
}
