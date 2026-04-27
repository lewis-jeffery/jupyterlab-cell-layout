import type * as nbformat from '@jupyterlab/nbformat';
import { Widget } from '@lumino/widgets';

import type { IOutputLayout, IPosition, ISize } from '../managers/metadata';
import {
  enableDrag,
  type IDragController,
  type ISnapHandler
} from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { coerceText, mmToPx, pxToMm } from './units';

export interface IOutputLayoutCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  onAutoFit?: (size: ISize) => void;
  snapHandler?: ISnapHandler;
}

export interface IOutputCellOptions {
  displayLabel: string;
  callbacks?: IOutputLayoutCallbacks;
}

const MAX_AUTO_FIT_WIDTH_MM = 200;
const MAX_AUTO_FIT_HEIGHT_MM = 280;

export class SummaryOutputCell extends Widget {
  private _outputLayout: IOutputLayout;
  private _items: ReadonlyArray<nbformat.IOutput>;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;
  private _displayLabel: string;

  constructor(
    layout: IOutputLayout,
    items: ReadonlyArray<nbformat.IOutput>,
    options: IOutputCellOptions
  ) {
    super();
    this._outputLayout = layout;
    this._items = items;
    this._displayLabel = options.displayLabel;
    this.addClass('jp-CellLayout-output');
    this.addClass(`jp-CellLayout-output-${layout.output_id}`);
    this._applyLayout();
    this._cachedCallbacks = options.callbacks;
    this._render();
    const callbacks = options.callbacks;
    if (callbacks) {
      this._dragCtl = enableDrag(
        this.node,
        () => this._outputLayout.position,
        pos => {
          this._outputLayout = { ...this._outputLayout, position: pos };
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
          onInteract: callbacks.onInteract,
          snapHandler: callbacks.snapHandler
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

    const grip = document.createElement('div');
    grip.className = 'jp-CellLayout-dragHandle';
    grip.setAttribute('aria-hidden', 'true');
    n.appendChild(grip);

    const label = document.createElement('div');
    label.className = 'jp-CellLayout-label';
    label.textContent = this._displayLabel;
    n.appendChild(label);

    const body = document.createElement('div');
    body.className = 'jp-CellLayout-outputBody';
    n.appendChild(body);

    if (this._items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jp-CellLayout-outputEmpty';
      empty.textContent = '(no output)';
      body.appendChild(empty);
      return;
    }

    let autoFitImageAttached = false;
    for (const item of this._items) {
      const el =
        this._outputLayout.output_id === 'output_b'
          ? renderGraphicsItem(item)
          : renderTextItem(item);
      if (!el) {
        continue;
      }
      body.appendChild(el);
      if (
        !autoFitImageAttached &&
        this._outputLayout.output_id === 'output_b' &&
        this._outputLayout.auto_fit !== false &&
        el instanceof HTMLImageElement
      ) {
        autoFitImageAttached = true;
        this._attachAutoFit(el);
      }
    }
  }

  private _attachAutoFit(img: HTMLImageElement): void {
    const apply = (): void => {
      if (this._outputLayout.auto_fit === false) {
        return;
      }
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        return;
      }
      let widthMm = pxToMm(w);
      let heightMm = pxToMm(h);
      // Cap at sensible page-friendly bounds, preserving aspect ratio
      const ratio = widthMm / heightMm;
      if (widthMm > MAX_AUTO_FIT_WIDTH_MM) {
        widthMm = MAX_AUTO_FIT_WIDTH_MM;
        heightMm = widthMm / ratio;
      }
      if (heightMm > MAX_AUTO_FIT_HEIGHT_MM) {
        heightMm = MAX_AUTO_FIT_HEIGHT_MM;
        widthMm = heightMm * ratio;
      }
      const newSize = {
        width: Math.round(widthMm * 10) / 10,
        height: Math.round(heightMm * 10) / 10
      };
      this._outputLayout = {
        ...this._outputLayout,
        size: newSize,
        auto_fit: false
      };
      this._applyLayout();
      this._callbacks?.onAutoFit?.(newSize);
    };
    if (img.complete && img.naturalWidth > 0) {
      apply();
    } else {
      img.addEventListener('load', apply, { once: true });
    }
  }

  private get _callbacks(): IOutputLayoutCallbacks | undefined {
    return this._cachedCallbacks;
  }

  private _cachedCallbacks?: IOutputLayoutCallbacks;
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

function renderGraphicsItem(item: nbformat.IOutput): HTMLElement | null {
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

  if ('image/png' in data) {
    return imageElement(
      'data:image/png;base64,' + coerceText(data['image/png'])
    );
  }
  if ('image/jpeg' in data) {
    return imageElement(
      'data:image/jpeg;base64,' + coerceText(data['image/jpeg'])
    );
  }
  if ('image/gif' in data) {
    return imageElement(
      'data:image/gif;base64,' + coerceText(data['image/gif'])
    );
  }
  if ('image/svg+xml' in data) {
    const div = document.createElement('div');
    div.className = 'jp-CellLayout-svg';
    div.innerHTML = coerceText(data['image/svg+xml']);
    return div;
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'jp-CellLayout-placeholder';
  const mime = Object.keys(data)[0] ?? 'unknown';
  placeholder.textContent = `[${mime}]`;
  return placeholder;
}

function imageElement(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'jp-CellLayout-image';
  img.src = src;
  return img;
}
