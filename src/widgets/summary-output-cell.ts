import type * as nbformat from '@jupyterlab/nbformat';
import { Widget } from '@lumino/widgets';

import type { IOutputLayout, IPosition, ISize } from '../managers/metadata';
import { enableDrag, type IDragController } from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { coerceText, mmToPx } from './units';

export interface IOutputLayoutCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
}

export class SummaryOutputCell extends Widget {
  private _outputLayout: IOutputLayout;
  private _items: ReadonlyArray<nbformat.IOutput>;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;

  constructor(
    layout: IOutputLayout,
    items: ReadonlyArray<nbformat.IOutput>,
    callbacks?: IOutputLayoutCallbacks
  ) {
    super();
    this._outputLayout = layout;
    this._items = items;
    this.addClass('jp-CellLayout-output');
    this.addClass(`jp-CellLayout-output-${layout.output_id}`);
    this._applyLayout();
    this._render();
    if (callbacks) {
      this._dragCtl = enableDrag(
        this.node,
        () => this._outputLayout.position,
        pos => {
          this._outputLayout = { ...this._outputLayout, position: pos };
          callbacks.onPositionChange(pos);
        },
        callbacks.getGridSnapMm,
        callbacks.onInteract
      );
      this._resizeCtl = enableResize(
        this.node,
        () => ({
          position: this._outputLayout.position,
          size: this._outputLayout.size
        }),
        geom => {
          this._outputLayout = {
            ...this._outputLayout,
            position: geom.position,
            size: geom.size
          };
          callbacks.onGeometryChange(geom.position, geom.size);
        },
        {
          getGridSnapMm: callbacks.getGridSnapMm,
          onInteract: callbacks.onInteract
        }
      );
    }
  }

  setZIndex(z: number): void {
    this._outputLayout = { ...this._outputLayout, z_index: z };
    this.node.style.zIndex = String(z);
  }

  dispose(): void {
    this._dragCtl?.dispose();
    this._resizeCtl?.dispose();
    super.dispose();
  }

  setContent(
    layout: IOutputLayout,
    items: ReadonlyArray<nbformat.IOutput>
  ): void {
    this._outputLayout = layout;
    this._items = items;
    this._applyLayout();
    this._render();
  }

  private _applyLayout(): void {
    const n = this.node;
    n.style.position = 'absolute';
    n.style.left = `${mmToPx(this._outputLayout.position.x)}px`;
    n.style.top = `${mmToPx(this._outputLayout.position.y)}px`;
    n.style.width = `${mmToPx(this._outputLayout.size.width)}px`;
    n.style.height = `${mmToPx(this._outputLayout.size.height)}px`;
    n.style.zIndex = String(this._outputLayout.z_index);
  }

  private _render(): void {
    const n = this.node;
    n.replaceChildren();

    if (this._items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jp-CellLayout-outputEmpty';
      empty.textContent = '(no output)';
      n.appendChild(empty);
      return;
    }

    for (const item of this._items) {
      const el =
        this._outputLayout.output_id === 'output_b'
          ? renderGraphicsItem(item, this._outputLayout.max_image_width)
          : renderTextItem(item);
      if (el) {
        n.appendChild(el);
      }
    }
  }
}

function renderTextItem(item: nbformat.IOutput): HTMLElement | null {
  switch (item.output_type) {
    case 'stream': {
      const pre = document.createElement('pre');
      pre.className = `jp-CellLayout-stream jp-CellLayout-stream-${(item as nbformat.IStream).name}`;
      pre.textContent = coerceText((item as nbformat.IStream).text);
      return pre;
    }
    case 'error': {
      const pre = document.createElement('pre');
      pre.className = 'jp-CellLayout-error';
      const tb = (item as nbformat.IError).traceback;
      pre.textContent = Array.isArray(tb) ? tb.join('\n') : String(tb);
      return pre;
    }
    case 'display_data':
    case 'execute_result': {
      const data = (item as nbformat.IDisplayData | nbformat.IExecuteResult)
        .data;
      if (!data) {
        return null;
      }
      if ('text/html' in data) {
        const div = document.createElement('div');
        div.className = 'jp-CellLayout-html';
        div.innerHTML = coerceText(data['text/html']);
        return div;
      }
      if ('text/plain' in data) {
        const pre = document.createElement('pre');
        pre.className = 'jp-CellLayout-plain';
        pre.textContent = coerceText(data['text/plain']);
        return pre;
      }
      return null;
    }
    default:
      return null;
  }
}

function renderGraphicsItem(
  item: nbformat.IOutput,
  maxWidthMm: number
): HTMLElement | null {
  if (
    item.output_type !== 'display_data' &&
    item.output_type !== 'execute_result'
  ) {
    return null;
  }
  const data = (item as nbformat.IDisplayData | nbformat.IExecuteResult).data;
  if (!data) {
    return null;
  }
  const maxWidthPx = `${mmToPx(maxWidthMm)}px`;

  if ('image/png' in data) {
    return imageElement(
      'data:image/png;base64,' + coerceText(data['image/png']),
      maxWidthPx
    );
  }
  if ('image/jpeg' in data) {
    return imageElement(
      'data:image/jpeg;base64,' + coerceText(data['image/jpeg']),
      maxWidthPx
    );
  }
  if ('image/gif' in data) {
    return imageElement(
      'data:image/gif;base64,' + coerceText(data['image/gif']),
      maxWidthPx
    );
  }
  if ('image/svg+xml' in data) {
    const div = document.createElement('div');
    div.className = 'jp-CellLayout-svg';
    div.style.maxWidth = maxWidthPx;
    div.innerHTML = coerceText(data['image/svg+xml']);
    return div;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'jp-CellLayout-placeholder';
  const mime = Object.keys(data)[0] ?? 'unknown';
  placeholder.textContent = `[${mime}]`;
  return placeholder;
}

function imageElement(src: string, maxWidthPx: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'jp-CellLayout-image';
  img.src = src;
  img.style.maxWidth = maxWidthPx;
  img.style.height = 'auto';
  return img;
}
