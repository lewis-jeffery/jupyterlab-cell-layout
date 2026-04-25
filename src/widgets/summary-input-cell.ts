import type { ICellModel } from '@jupyterlab/cells';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';

import type { IInputLayout, IPosition, ISize } from '../managers/metadata';
import { enableDrag, type IDragController } from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { coerceText, mmToPx, pxToMm } from './units';

const MAX_AUTO_FIT_WIDTH_MM = 200;
const MAX_AUTO_FIT_HEIGHT_MM = 280;
const MIN_AUTO_FIT_WIDTH_MM = 30;
const MIN_AUTO_FIT_HEIGHT_MM = 12;

function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'));
  if (imgs.length === 0) {
    return Promise.resolve();
  }
  return Promise.all(
    imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) {
        return Promise.resolve();
      }
      return new Promise<void>(resolve => {
        const done = (): void => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    })
  ).then(() => undefined);
}

export interface IInputLayoutCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  onAutoFit?: (size: ISize) => void;
}

export interface IInputCellOptions {
  displayLabel: string;
  rendermime?: IRenderMimeRegistry;
  callbacks?: IInputLayoutCallbacks;
}

function clampSizeMm(width: number, height: number): ISize {
  let w = width;
  let h = height;
  const ratio = w > 0 && h > 0 ? w / h : 1;
  if (w > MAX_AUTO_FIT_WIDTH_MM) {
    w = MAX_AUTO_FIT_WIDTH_MM;
    h = w / ratio;
  }
  if (h > MAX_AUTO_FIT_HEIGHT_MM) {
    h = MAX_AUTO_FIT_HEIGHT_MM;
    w = h * ratio;
  }
  if (w < MIN_AUTO_FIT_WIDTH_MM) {
    w = MIN_AUTO_FIT_WIDTH_MM;
  }
  if (h < MIN_AUTO_FIT_HEIGHT_MM) {
    h = MIN_AUTO_FIT_HEIGHT_MM;
  }
  return {
    width: Math.round(w * 10) / 10,
    height: Math.round(h * 10) / 10
  };
}

export class SummaryInputCell extends Widget {
  private _inputLayout: IInputLayout;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;
  private _displayLabel: string;
  private _rendermime?: IRenderMimeRegistry;
  private _callbacks?: IInputLayoutCallbacks;

  constructor(
    private readonly cellModel: ICellModel,
    layout: IInputLayout,
    options: IInputCellOptions
  ) {
    super();
    this._inputLayout = layout;
    this._displayLabel = options.displayLabel;
    this._rendermime = options.rendermime;
    this._callbacks = options.callbacks;
    this.addClass('jp-CellLayout-input');
    this.addClass(`jp-CellLayout-input-${cellModel.type}`);
    this._applyLayout();
    void this._render();
    const callbacks = options.callbacks;
    if (callbacks) {
      this._dragCtl = enableDrag(
        this.node,
        () => this._inputLayout.position,
        pos => {
          this._inputLayout = { ...this._inputLayout, position: pos };
          callbacks.onPositionChange(pos);
        },
        callbacks.getGridSnapMm,
        callbacks.onInteract
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
          onInteract: callbacks.onInteract
        }
      );
    }
  }

  setZIndex(z: number): void {
    this._inputLayout = { ...this._inputLayout, z_index: z };
    this.node.style.zIndex = String(z);
  }

  dispose(): void {
    this._dragCtl?.dispose();
    this._resizeCtl?.dispose();
    super.dispose();
  }

  setLayout(next: IInputLayout): void {
    this._inputLayout = next;
    this._applyLayout();
    void this._render();
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

  private async _render(): Promise<void> {
    const n = this.node;
    n.replaceChildren();

    const label = document.createElement('div');
    label.className = 'jp-CellLayout-label';
    label.textContent = this._displayLabel;
    n.appendChild(label);

    const body = document.createElement('div');
    body.className = 'jp-CellLayout-inputBody';
    n.appendChild(body);

    const source = coerceText(this.cellModel.sharedModel.getSource());

    if (this.cellModel.type === 'markdown' && this._rendermime) {
      await this._renderMarkdown(body, source);
    } else {
      const pre = document.createElement('pre');
      pre.className = 'jp-CellLayout-inputCode';
      pre.textContent = source;
      body.appendChild(pre);
    }
  }

  private async _renderMarkdown(
    body: HTMLElement,
    source: string
  ): Promise<void> {
    if (!this._rendermime) {
      return;
    }
    const trimmed = source.trim().length > 0 ? source : '_(empty)_';
    const renderer = this._rendermime.createRenderer('text/markdown');
    const model = this._rendermime.createModel({
      data: { 'text/markdown': trimmed },
      trusted: true
    });
    try {
      await renderer.renderModel(model);
      renderer.addClass('jp-CellLayout-md');
      body.appendChild(renderer.node);
      // JL's rendermime may attach its own click handlers to anchors during
      // render that swallow external navigation. Deep-clone each <a> and
      // replace the original — the clone has no inherited event listeners,
      // so default browser behaviour (target=_blank navigation) takes over.
      for (const a of Array.from(renderer.node.querySelectorAll('a'))) {
        const clone = a.cloneNode(true) as HTMLAnchorElement;
        clone.setAttribute('target', '_blank');
        clone.setAttribute('rel', 'noopener noreferrer');
        a.replaceWith(clone);
      }
      await waitForImages(renderer.node);
      this._maybeAutoFit(renderer.node);
    } catch (err) {
      const fallback = document.createElement('pre');
      fallback.textContent = source;
      body.appendChild(fallback);
      console.warn('jupyterlab-cell-layout: markdown render failed', err);
    }
  }

  private _maybeAutoFit(content: HTMLElement): void {
    if (this._inputLayout.auto_fit === false) {
      return;
    }
    if (!this._callbacks?.onAutoFit) {
      return;
    }
    const widthPx = content.scrollWidth;
    const heightPx = content.scrollHeight;
    if (widthPx <= 0 || heightPx <= 0) {
      return;
    }
    const newSize = clampSizeMm(pxToMm(widthPx), pxToMm(heightPx));
    this._inputLayout = {
      ...this._inputLayout,
      size: newSize,
      auto_fit: false
    };
    this._applyLayout();
    this._callbacks.onAutoFit(newSize);
  }
}
