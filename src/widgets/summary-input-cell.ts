import type { ICellModel } from '@jupyterlab/cells';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';

import type { IInputLayout, IPosition, ISize } from '../managers/metadata';
import { enableDrag, type IDragController } from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { coerceText, mmToPx } from './units';

export interface IInputLayoutCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
}

export interface IInputCellOptions {
  displayLabel: string;
  rendermime?: IRenderMimeRegistry;
  callbacks?: IInputLayoutCallbacks;
}

export class SummaryInputCell extends Widget {
  private _inputLayout: IInputLayout;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;
  private _displayLabel: string;
  private _rendermime?: IRenderMimeRegistry;

  constructor(
    private readonly cellModel: ICellModel,
    layout: IInputLayout,
    options: IInputCellOptions
  ) {
    super();
    this._inputLayout = layout;
    this._displayLabel = options.displayLabel;
    this._rendermime = options.rendermime;
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
    } catch (err) {
      const fallback = document.createElement('pre');
      fallback.textContent = source;
      body.appendChild(fallback);
      console.warn('jupyterlab-cell-layout: markdown render failed', err);
    }
  }
}
