/**
 * Temporary debug dialog: surfaces what MetadataManager and OutputProcessor
 * see for the currently-active notebook. Throwaway — will be replaced by
 * proper layout widgets in task #3.
 */

import { Dialog, showDialog } from '@jupyterlab/apputils';
import type { ICodeCellModel } from '@jupyterlab/cells';
import type * as nbformat from '@jupyterlab/nbformat';
import type { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import {
  MetadataManager,
  PAGE_SIZES_MM,
  type ICellLayout
} from '../managers/metadata';
import { OutputProcessor } from '../managers/output-processor';

function createInfoNode(panel: NotebookPanel): HTMLElement {
  const model = panel.model;
  const root = document.createElement('div');
  root.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  root.style.fontSize = '12px';
  root.style.lineHeight = '1.5';
  root.style.maxWidth = '680px';
  root.style.maxHeight = '60vh';
  root.style.overflow = 'auto';
  root.style.whiteSpace = 'pre-wrap';

  if (!model) {
    root.textContent = 'No notebook model available.';
    return root;
  }

  const manager = new MetadataManager(model);
  const layout = manager.read();
  const processor = new OutputProcessor();
  const pageSize = PAGE_SIZES_MM[layout.settings.page_size];

  const lines: string[] = [];
  lines.push(`Notebook: ${panel.context.path}`);
  lines.push('');
  lines.push(`Notebook mode: ${layout.settings.notebook_mode}`);
  lines.push(
    `Page size:     ${layout.settings.page_size} (${pageSize.width} × ${pageSize.height} mm)`
  );
  lines.push(`Grid snap:     ${layout.settings.grid_snap} mm`);
  lines.push(`Layout enabled: ${layout.enabled}`);
  lines.push(`Schema version: ${layout.version}`);
  lines.push('');

  const cellCount = model.cells.length;
  lines.push(`Cells: ${cellCount}`);
  lines.push('─'.repeat(72));

  for (let i = 0; i < cellCount; i++) {
    const cellModel = model.cells.get(i);
    const id = cellModel.id;
    const cellType = cellModel.type;
    const saved: ICellLayout | undefined = layout.cells[id];
    const mode = saved?.mode ?? 'edit';
    const marker = mode === 'summary' ? '★' : ' ';

    lines.push(`${marker} Cell ${i + 1}: ${id}`);
    lines.push(
      `    type=${cellType}  mode=${mode}  ${saved ? 'layout=saved' : 'layout=default'}`
    );

    if (cellType === 'code') {
      const outputs = (cellModel as ICodeCellModel).outputs;
      const serialized: nbformat.IOutput[] = [];
      for (let j = 0; j < outputs.length; j++) {
        serialized.push(outputs.get(j).toJSON() as nbformat.IOutput);
      }
      const routing = processor.route(serialized);
      const aSummary = summariseSlot(routing.output_a, processor);
      const bSummary = summariseSlot(routing.output_b, processor);
      lines.push(`    outputs: ${serialized.length} total`);
      lines.push(
        `      → slot A (text):    ${aSummary || '(empty)'}`
      );
      lines.push(
        `      → slot B (graphics): ${bSummary || '(empty)'}`
      );
    } else {
      lines.push(`    outputs: (n/a — ${cellType} cell)`);
    }

    if (saved) {
      const { input, outputs: savedOutputs } = saved;
      lines.push(
        `    input:  pos=(${input.position.x},${input.position.y}) mm · size=${input.size.width}×${input.size.height} mm · visible_lines=${input.visible_lines}`
      );
      for (const o of savedOutputs) {
        lines.push(
          `    ${o.output_id}: ${o.enabled ? 'enabled' : 'DISABLED'} · type=${o.type} · pos=(${o.position.x},${o.position.y}) mm · size=${o.size.width}×${o.size.height} mm`
        );
      }
    }
    lines.push('');
  }

  root.textContent = lines.join('\n');
  return root;
}

function summariseSlot(
  outputs: nbformat.IOutput[],
  processor: OutputProcessor
): string {
  if (outputs.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const out of outputs) {
    const mime = processor.primaryMimetype(out) ?? out.output_type;
    parts.push(mime);
  }
  return `${outputs.length} item(s) — ${parts.join(', ')}`;
}

export async function showLayoutInfoDialog(
  panel: NotebookPanel
): Promise<void> {
  const body = new Widget({ node: createInfoNode(panel) });
  await showDialog({
    title: 'Cell Layout — debug view',
    body,
    buttons: [Dialog.okButton({ label: 'Close' })]
  });
}
