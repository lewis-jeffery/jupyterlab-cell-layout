import type { ICellModel } from '@jupyterlab/cells';
import {
  CodeEditorWrapper,
  type IEditorServices
} from '@jupyterlab/codeeditor';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';

import type { IInputLayout, IPosition, ISize } from '../managers/metadata';
import {
  enableDrag,
  type IDragController,
  type ISnapHandler
} from './draggable';
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
  snapHandler?: ISnapHandler;
}

export interface IInputCellOptions {
  displayLabel: string;
  rendermime?: IRenderMimeRegistry;
  editorServices?: IEditorServices;
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
  private _editorServices?: IEditorServices;
  private _editor?: CodeEditorWrapper;
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
    this._editorServices = options.editorServices;
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
        {
          getGridSnapMm: callbacks.getGridSnapMm,
          onInteract: callbacks.onInteract,
          snapHandler: callbacks.snapHandler
        }
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
          onInteract: callbacks.onInteract,
          snapHandler: callbacks.snapHandler
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
    this._editor?.dispose();
    this._editor = undefined;
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
    // Tear down any prior editor before clearing the DOM. CodeMirror needs
    // its widget lifecycle observed cleanly; just reaping the DOM nodes
    // would leak the editor's internal state.
    if (this._editor) {
      this._editor.dispose();
      this._editor = undefined;
    }
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
    body.className = 'jp-CellLayout-inputBody';
    n.appendChild(body);

    const source = coerceText(this.cellModel.sharedModel.getSource());

    if (this.cellModel.type === 'markdown' && this._rendermime) {
      await this._renderMarkdown(body, source);
    } else if (this._editorServices) {
      this._renderCodeEditor(body);
    } else {
      // Fallback when editor services aren't available — keeps the widget
      // useful in unit tests / standalone construction.
      const pre = document.createElement('pre');
      pre.className = 'jp-CellLayout-inputCode';
      pre.textContent = source;
      body.appendChild(pre);
    }
  }

  /**
   * Render the cell's source via JL's CodeMirror editor, bound directly to
   * the cell's model. The editor is read-only in this stage; later stages
   * will toggle editability and add a Run button.
   *
   * Two views (the notebook's own cell editor and this one) share the same
   * model — JL's collaborative-aware sharedModel — so edits propagate
   * automatically without a manual subscribe loop.
   */
  private _renderCodeEditor(body: HTMLElement): void {
    if (!this._editorServices) {
      return;
    }
    const wrapper = new CodeEditorWrapper({
      factory: this._editorServices.factoryService.newInlineEditor,
      model: this.cellModel,
      editorOptions: {
        config: {
          readOnly: false,
          lineNumbers: false
        }
      }
    });
    wrapper.addClass('jp-CellLayout-inputEditor');
    body.appendChild(wrapper.node);
    this._editor = wrapper;
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
    // Attach BEFORE rendering so JL's latex typesetter (run at the end of
    // renderModel) sees a node that's already in the DOM. Typesetting a
    // detached node leaves `$…$` as raw text.
    renderer.addClass('jp-CellLayout-md');
    body.appendChild(renderer.node);
    try {
      await renderer.renderModel(model);
      // Belt-and-braces: re-typeset explicitly. typeset() is idempotent on
      // already-rendered math, so the second pass is harmless and catches
      // cases where the in-renderModel pass missed (e.g. detached parent
      // chains during initial layout).
      this._rendermime.latexTypesetter?.typeset(renderer.node);
      for (const a of Array.from(renderer.node.querySelectorAll('a'))) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
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
