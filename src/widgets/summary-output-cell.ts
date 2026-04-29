import type * as nbformat from '@jupyterlab/nbformat';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import type { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Widget } from '@lumino/widgets';

import type {
  IOutputLayout,
  IPosition,
  ISize,
  OutputSlotId
} from '../managers/metadata';
import {
  enableDrag,
  type IDragController,
  type IDragSibling,
  type ISnapHandler
} from './draggable';
import { enableResize, type IResizeController } from './resizable';
import { coerceText, mmToPx, pxToMm } from './units';

const WIDGET_VIEW_MIMETYPE = 'application/vnd.jupyter.widget-view+json';

export interface IOutputLayoutCallbacks {
  onPositionChange: (pos: IPosition) => void;
  onGeometryChange: (pos: IPosition, size: ISize) => void;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  onAutoFit?: (size: ISize) => void;
  snapHandler?: ISnapHandler;
  getSiblings?: () => IDragSibling[];
}

export interface IOutputCellOptions {
  displayLabel: string;
  /**
   * Optional rendermime registry for rendering rich mime types we don't
   * handle directly — notably `application/vnd.jupyter.widget-view+json`
   * (ipywidgets, including mpl_interactions). The widgets manager
   * registers itself against this registry when the notebook activates,
   * so widget output rendered through it is *live*: sliders work,
   * figures update on kernel callbacks, state syncs with the notebook
   * content view via the same comm channel.
   */
  rendermime?: IRenderMimeRegistry;
  callbacks?: IOutputLayoutCallbacks;
}

/**
 * Mime types we render via hand-rolled DOM in `renderGraphicsItem`,
 * plus widget-view (which has its own dedicated branch in
 * `tryRenderWidgetView`). Anything else falls through to rendermime so
 * JL's renderer factories (plotly, vega, …) get a chance.
 */
const NATIVE_GRAPHICS_MIMETYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  WIDGET_VIEW_MIMETYPE
]);

const MAX_AUTO_FIT_WIDTH_MM = 200;
const MAX_AUTO_FIT_HEIGHT_MM = 280;

export class SummaryOutputCell extends Widget {
  private _outputLayout: IOutputLayout;
  private _items: ReadonlyArray<nbformat.IOutput>;
  private _dragCtl?: IDragController;
  private _resizeCtl?: IResizeController;
  private _displayLabel: string;
  private _rendermime?: IRenderMimeRegistry;
  /**
   * Renderers created for live mime types (e.g. ipywidgets). Disposed
   * before each rebuild so the widget views unsubscribe from their comm
   * channels rather than leaking. Also drained in `dispose()`.
   */
  private _activeRenderers: Array<{ dispose: () => void }> = [];
  private _autoFitObserver?: ResizeObserver;

  constructor(
    layout: IOutputLayout,
    items: ReadonlyArray<nbformat.IOutput>,
    options: IOutputCellOptions
  ) {
    super();
    this._outputLayout = layout;
    this._items = items;
    this._displayLabel = options.displayLabel;
    this._rendermime = options.rendermime;
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
          snapHandler: callbacks.snapHandler,
          getSiblings: callbacks.getSiblings
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
    this._disposeActiveRenderers();
    this._autoFitObserver?.disconnect();
    this._autoFitObserver = undefined;
    this._dragCtl?.dispose();
    this._resizeCtl?.dispose();
    super.dispose();
  }

  private _disposeActiveRenderers(): void {
    for (const r of this._activeRenderers) {
      try {
        r.dispose();
      } catch {
        /* ignore */
      }
    }
    this._activeRenderers = [];
    this._autoFitObserver?.disconnect();
    this._autoFitObserver = undefined;
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

  /** Slot id (`output_a` or `output_b`) — needed by group-drag plumbing. */
  get slotId(): OutputSlotId {
    return this._outputLayout.output_id;
  }

  /**
   * Update internal layout state and DOM in one call. Used by group drag
   * to keep this cell's state in sync with on-canvas mutations performed
   * by another slot's drag controller.
   */
  commitPosition(pos: IPosition): void {
    this._outputLayout = { ...this._outputLayout, position: pos };
    this._applyLayout();
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
    this._disposeActiveRenderers();
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

    const goto = document.createElement('button');
    goto.type = 'button';
    goto.className = 'jp-CellLayout-gotoButton';
    goto.title = 'Go to next related slot';
    goto.setAttribute('aria-label', 'Go to next related slot');
    goto.textContent = '→';
    n.appendChild(goto);

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
    let liveRendererAttached = false;
    for (const item of this._items) {
      const rendered =
        this._outputLayout.output_id === 'output_b'
          ? renderGraphicsItem(item, this._rendermime)
          : { node: renderTextItem(item), disposable: null };
      if (!rendered || !rendered.node) {
        continue;
      }
      body.appendChild(rendered.node);
      if (rendered.disposable) {
        this._activeRenderers.push(rendered.disposable);
        liveRendererAttached = true;
      }
      if (
        !autoFitImageAttached &&
        this._outputLayout.output_id === 'output_b' &&
        this._outputLayout.auto_fit !== false &&
        rendered.node instanceof HTMLImageElement
      ) {
        autoFitImageAttached = true;
        this._attachAutoFit(rendered.node);
      }
    }
    // Live renderers (ipywidgets, plotly, etc.) populate their DOM
    // asynchronously, so the natural content size isn't known until
    // after `renderModel` has resolved and the kernel-side widget has
    // dispatched its initial state. ResizeObserver bridges that — it
    // fires whenever the body's content size changes. We capture the
    // first non-zero size and resize the slot once.
    if (
      liveRendererAttached &&
      this._outputLayout.auto_fit !== false &&
      this._outputLayout.output_id === 'output_b'
    ) {
      this._attachContentAutoFit(body);
    }
  }

  /**
   * Watch the body's natural content size with a ResizeObserver. When a
   * non-zero size lands and `auto_fit` is still on, resize the slot to
   * fit (capped by MAX_AUTO_FIT_*), persist via `onAutoFit`, and
   * disconnect. Subsequent content size changes are ignored — the user
   * has manually-controlled sizing from this point.
   */
  private _attachContentAutoFit(body: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this._autoFitObserver?.disconnect();
    const observer = new ResizeObserver(() => {
      if (this._outputLayout.auto_fit === false) {
        observer.disconnect();
        this._autoFitObserver = undefined;
        return;
      }
      const wPx = body.scrollWidth || body.offsetWidth;
      const hPx = body.scrollHeight || body.offsetHeight;
      if (!wPx || !hPx) {
        // Content hasn't been measured yet — wait for the next
        // resize fire, no-op now.
        return;
      }
      let widthMm = pxToMm(wPx);
      let heightMm = pxToMm(hPx);
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
      // Skip if the slot is already roughly the right size — avoids
      // cosmetic jiggle when the widget settles 1 mm differently.
      const currentW = this._outputLayout.size.width;
      const currentH = this._outputLayout.size.height;
      const needsResize =
        Math.abs(newSize.width - currentW) > 1 ||
        Math.abs(newSize.height - currentH) > 1;
      this._outputLayout = {
        ...this._outputLayout,
        size: needsResize ? newSize : this._outputLayout.size,
        auto_fit: false
      };
      this._applyLayout();
      if (needsResize) {
        this._callbacks?.onAutoFit?.(newSize);
      }
      observer.disconnect();
      this._autoFitObserver = undefined;
    });
    observer.observe(body);
    this._autoFitObserver = observer;
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

interface IRenderedItem {
  node: HTMLElement;
  /** Disposable for live renderers (rendermime) — null for plain DOM. */
  disposable: { dispose: () => void } | null;
}

function renderGraphicsItem(
  item: nbformat.IOutput,
  rendermime?: IRenderMimeRegistry
): IRenderedItem | null {
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

  // Live widget view first, when present and the widgets manager has
  // registered itself. ipywidgets bundles typically include `image/png`
  // as a static fallback for environments without the widgets manager;
  // we'd rather render the interactive view (sliders, plotly canvas,
  // mpl_interactions controls). Falls through to the static handlers
  // below if widgets manager isn't loaded.
  if (rendermime && WIDGET_VIEW_MIMETYPE in data) {
    const widgetRender = tryRenderWidgetView(rendermime, item);
    if (widgetRender) {
      return widgetRender;
    }
  }

  if ('image/png' in data) {
    return staticItem(
      imageElement('data:image/png;base64,' + coerceText(data['image/png']))
    );
  }
  if ('image/jpeg' in data) {
    return staticItem(
      imageElement('data:image/jpeg;base64,' + coerceText(data['image/jpeg']))
    );
  }
  if ('image/gif' in data) {
    return staticItem(
      imageElement('data:image/gif;base64,' + coerceText(data['image/gif']))
    );
  }
  if ('image/svg+xml' in data) {
    const div = document.createElement('div');
    div.className = 'jp-CellLayout-svg';
    div.innerHTML = coerceText(data['image/svg+xml']);
    return staticItem(div);
  }
  // Other rich types: plotly, vega-lite, vendor JSON. Filtered subset
  // ensures we don't pick up text/plain by mistake.
  if (rendermime) {
    const viaRendermime = renderViaRendermime(rendermime, item);
    if (viaRendermime) {
      return viaRendermime;
    }
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'jp-CellLayout-placeholder';
  const mime = Object.keys(data)[0] ?? 'unknown';
  placeholder.textContent = `[${mime}]`;
  return staticItem(placeholder);
}

/**
 * Render a `application/vnd.jupyter.widget-view+json` output via JL's
 * widgets manager. Returns null if the widgets manager isn't registered
 * for the mime type (caller falls back to the static `image/png`).
 */
function tryRenderWidgetView(
  rendermime: IRenderMimeRegistry,
  item: nbformat.IOutput
): IRenderedItem | null {
  if (
    item.output_type !== 'display_data' &&
    item.output_type !== 'execute_result'
  ) {
    return null;
  }
  const cast = item as nbformat.IDisplayData | nbformat.IExecuteResult;
  const data = cast.data;
  if (!data || !(WIDGET_VIEW_MIMETYPE in data)) {
    return null;
  }
  // Confirm the widgets manager has registered a renderer for the
  // widget mime type. Without this check we'd happily produce a
  // placeholder via the default text/plain renderer, which is worse
  // than the static `image/png` fallback the bundle provides.
  let canRender = false;
  try {
    const widgetOnly: Record<string, unknown> = {
      [WIDGET_VIEW_MIMETYPE]: (data as Record<string, unknown>)[
        WIDGET_VIEW_MIMETYPE
      ]
    };
    canRender =
      rendermime.preferredMimeType(
        widgetOnly as ReadonlyPartialJSONObject,
        'any'
      ) === WIDGET_VIEW_MIMETYPE;
  } catch {
    canRender = false;
  }
  if (!canRender) {
    return null;
  }
  let renderer: ReturnType<IRenderMimeRegistry['createRenderer']>;
  try {
    renderer = rendermime.createRenderer(WIDGET_VIEW_MIMETYPE);
  } catch (err) {
    console.warn(
      'jupyterlab-cell-layout: widget-view createRenderer failed',
      err
    );
    return null;
  }
  const model = rendermime.createModel({
    data: data as ReadonlyPartialJSONObject,
    metadata: (cast.metadata ?? {}) as ReadonlyPartialJSONObject,
    trusted: true
  });
  void renderer.renderModel(model).catch(err => {
    console.warn(
      'jupyterlab-cell-layout: widget-view renderModel failed',
      err
    );
  });
  renderer.addClass('jp-CellLayout-rendered');
  renderer.addClass('jp-CellLayout-widget');
  return {
    node: renderer.node,
    disposable: renderer
  };
}

function staticItem(node: HTMLElement): IRenderedItem {
  return { node, disposable: null };
}

function renderViaRendermime(
  rendermime: IRenderMimeRegistry,
  item: nbformat.IDisplayData | nbformat.IExecuteResult | nbformat.IOutput
): IRenderedItem | null {
  if (
    item.output_type !== 'display_data' &&
    item.output_type !== 'execute_result'
  ) {
    return null;
  }
  const cast = item as nbformat.IDisplayData | nbformat.IExecuteResult;
  const data = cast.data;
  if (!data) {
    return null;
  }
  // Skip mime types we already handle natively above — we only want
  // rendermime to take over for the rich types.
  const candidates = Object.keys(data).filter(
    k => !NATIVE_GRAPHICS_MIMETYPES.has(k)
  );
  if (candidates.length === 0) {
    return null;
  }
  // Build a data subset jsonified so rendermime sees only the candidates
  // we want it to consider — otherwise it might pick text/plain from
  // alongside a widget-view bundle.
  const subset: Record<string, unknown> = {};
  for (const k of candidates) {
    subset[k] = (data as Record<string, unknown>)[k];
  }
  let mimeType: string | undefined;
  try {
    mimeType = rendermime.preferredMimeType(
      subset as ReadonlyPartialJSONObject,
      'any'
    );
  } catch {
    mimeType = undefined;
  }
  if (!mimeType) {
    return null;
  }
  let renderer: ReturnType<IRenderMimeRegistry['createRenderer']>;
  try {
    renderer = rendermime.createRenderer(mimeType);
  } catch (err) {
    console.warn(
      'jupyterlab-cell-layout: rendermime createRenderer failed',
      mimeType,
      err
    );
    return null;
  }
  const model = rendermime.createModel({
    data: subset as ReadonlyPartialJSONObject,
    metadata: (cast.metadata ?? {}) as ReadonlyPartialJSONObject,
    trusted: true
  });
  // renderModel returns Promise<void>; the renderer node may stay
  // empty until it resolves. The widgets manager wires its comm
  // bindings inside renderModel, so awaiting isn't strictly needed —
  // appending the node now and letting it fill in is fine.
  void renderer.renderModel(model).catch(err => {
    console.warn(
      'jupyterlab-cell-layout: rendermime renderModel failed',
      mimeType,
      err
    );
  });
  renderer.addClass('jp-CellLayout-rendered');
  return {
    node: renderer.node,
    disposable: renderer
  };
}

function imageElement(src: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'jp-CellLayout-image';
  img.src = src;
  return img;
}
