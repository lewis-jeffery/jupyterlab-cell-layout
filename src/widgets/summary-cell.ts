import type { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import type * as nbformat from '@jupyterlab/nbformat';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import type { Widget } from '@lumino/widgets';

import type { CellCoordinator } from '../managers/cell-coordinator';
import { OutputProcessor } from '../managers/output-processor';
import type { ICellLayout, OutputSlotId } from '../managers/metadata';

import type { ISnapHandler } from './draggable';
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
  onInteract?: () => void;
  snapHandlerFactory?: ISnapHandlerFactory;
}

/**
 * Logical wrapper around one notebook cell's summary-mode presentation.
 * Owns a SummaryInputCell and up to two SummaryOutputCell widgets.
 * Not itself a Lumino Widget — it returns the widgets to attach to the canvas.
 */
export class SummaryCellWidget {
  readonly cellId: string;
  readonly input: SummaryInputCell;
  readonly outputs: SummaryOutputCell[];
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
      onInteract,
      displayIndex,
      snapHandlerFactory
    } = options;
    const indexLabel = String(displayIndex);

    const getGridSnapMm = coordinator
      ? () => coordinator.gridSnapMm()
      : undefined;
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
    this.input = new SummaryInputCell(cellModel, layout.input, {
      displayLabel: indexLabel,
      rendermime,
      callbacks: inputCallbacks
    });
    this.input.node.dataset.cellId = id;
    this.input.node.dataset.slot = 'input';
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
    this.input.setZIndex(z);
    for (const o of this.outputs) {
      o.setZIndex(z);
    }
  }

  widgets(): Widget[] {
    return [this.input, ...this.outputs];
  }

  dispose(): void {
    this.input.dispose();
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
