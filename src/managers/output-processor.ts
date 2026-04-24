import type * as nbformat from '@jupyterlab/nbformat';

import type { OutputSlotId } from './metadata';

export type OutputClass = 'text' | 'graphics';

const GRAPHICS_MIMETYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.plotly.v1+json',
  'application/vnd.vega.v5+json',
  'application/vnd.vegalite.v2+json',
  'application/vnd.vegalite.v3+json',
  'application/vnd.vegalite.v4+json',
  'application/vnd.vegalite.v5+json',
  'application/vnd.jupyter.widget-view+json'
]);

const TEXT_MIMETYPE_PREFERENCE: ReadonlyArray<string> = [
  'text/html',
  'text/markdown',
  'text/latex',
  'application/json',
  'text/plain'
];

function isGraphicsMimetype(mimetype: string): boolean {
  return GRAPHICS_MIMETYPES.has(mimetype);
}

function hasGraphicsMimetype(data: Record<string, unknown>): boolean {
  for (const key of Object.keys(data)) {
    if (isGraphicsMimetype(key)) {
      return true;
    }
  }
  return false;
}

function pickPrimaryMimetype(data: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(data)) {
    if (isGraphicsMimetype(key)) {
      return key;
    }
  }
  for (const candidate of TEXT_MIMETYPE_PREFERENCE) {
    if (candidate in data) {
      return candidate;
    }
  }
  const keys = Object.keys(data);
  return keys.length > 0 ? keys[0] : undefined;
}

export function classifyOutput(output: nbformat.IOutput): OutputClass {
  switch (output.output_type) {
    case 'stream':
    case 'error':
      return 'text';
    case 'display_data':
    case 'execute_result': {
      const data = (output as nbformat.IDisplayData | nbformat.IExecuteResult)
        .data;
      if (!data || typeof data !== 'object') {
        return 'text';
      }
      return hasGraphicsMimetype(data as Record<string, unknown>)
        ? 'graphics'
        : 'text';
    }
    default:
      return 'text';
  }
}

export function primaryMimetype(
  output: nbformat.IOutput
): string | undefined {
  switch (output.output_type) {
    case 'stream':
      return 'text/plain';
    case 'error':
      return 'application/vnd.jupyter.error';
    case 'display_data':
    case 'execute_result': {
      const data = (output as nbformat.IDisplayData | nbformat.IExecuteResult)
        .data;
      if (!data || typeof data !== 'object') {
        return undefined;
      }
      return pickPrimaryMimetype(data as Record<string, unknown>);
    }
    default:
      return undefined;
  }
}

export interface IOutputRouting {
  output_a: nbformat.IOutput[];
  output_b: nbformat.IOutput[];
}

export function routeOutputs(
  outputs: ReadonlyArray<nbformat.IOutput>
): IOutputRouting {
  const output_a: nbformat.IOutput[] = [];
  const output_b: nbformat.IOutput[] = [];
  for (const out of outputs) {
    const target = classifyOutput(out) === 'graphics' ? output_b : output_a;
    target.push(out);
  }
  return { output_a, output_b };
}

export class OutputProcessor {
  route(outputs: ReadonlyArray<nbformat.IOutput>): IOutputRouting {
    return routeOutputs(outputs);
  }

  classify(output: nbformat.IOutput): OutputClass {
    return classifyOutput(output);
  }

  primaryMimetype(output: nbformat.IOutput): string | undefined {
    return primaryMimetype(output);
  }

  slotContents(
    routing: IOutputRouting,
    slot: OutputSlotId
  ): nbformat.IOutput[] {
    return slot === 'output_a' ? routing.output_a : routing.output_b;
  }
}
