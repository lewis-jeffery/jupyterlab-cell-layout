import type { ICellModel } from '@jupyterlab/cells';
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

export class SummaryInputCell extends Widget {
  private _inputLayout: IInputLayout;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;

  constructor(
    private readonly cellModel: ICellModel,
    layout: IInputLayout,
    callbacks?: IInputLayoutCallbacks
  ) {
    super();
    this._inputLayout = layout;
    this.addClass('jp-CellLayout-input');
    this._applyLayout();
    this._render();
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
    this._render();
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

  private _render(): void {
    const n = this.node;
    n.replaceChildren();

    const header = document.createElement('div');
    header.className = 'jp-CellLayout-inputHeader';
    const shortId = this.cellModel.id.slice(0, 8);
    header.textContent = `${this.cellModel.type} · ${shortId}`;
    n.appendChild(header);

    const body = document.createElement('pre');
    body.className = 'jp-CellLayout-inputBody';
    const source = coerceText(this.cellModel.sharedModel.getSource());
    const lines = source.split('\n');
    const limit = this._inputLayout.visible_lines;
    const shown = lines.slice(0, limit);
    const truncated = lines.length > limit;
    body.textContent = shown.join('\n') + (truncated ? '\n…' : '');
    n.appendChild(body);
  }
}
