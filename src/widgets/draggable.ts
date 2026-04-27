import type {
  IGuideLine,
  IRect,
  ISnapResult
} from './alignment-guides';
import type { IPosition } from '../managers/metadata';
import type { ResizeHandle } from './resizable';
import { mmToPx, pxToMm, snapToGrid } from './units';

export interface IDragController {
  dispose(): void;
}

export interface ISnapHandler {
  computeDrag(rect: IRect): ISnapResult;
  computeResize(rect: IRect, handle: ResizeHandle): ISnapResult;
  showGuides(guides: IGuideLine[]): void;
}

export interface IDragOptions {
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  snapHandler?: ISnapHandler;
}

function roundMm(v: number): number {
  return Math.round(v * 10) / 10;
}

export function enableDrag(
  node: HTMLElement,
  getInitialPositionMm: () => IPosition,
  onPositionChange: (posMm: IPosition) => void,
  options: IDragOptions = {}
): IDragController {
  let startClientX = 0;
  let startClientY = 0;
  let startMm: IPosition = { x: 0, y: 0 };
  let dragging = false;
  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const target = e.target as Element | null;
    // If the user pressed on a navigable anchor, let the browser handle the
    // click. Calling preventDefault on pointerdown suppresses the synthesized
    // click event for any descendant, which otherwise blocks link navigation.
    // Still record the interaction so the cell is tracked as "last clicked"
    // for the mode-switch carryover feature.
    const anchor = target?.closest?.('a');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href && /^(https?|mailto|ftp):/i.test(href)) {
        options.onInteract?.();
        return;
      }
    }
    // If the user pressed inside an embedded CodeMirror editor, hand the
    // click off to it for cursor placement / typing. Without this skip,
    // every click on a code cell starts a drag and never reaches CM's
    // selection handling. Still record the interaction.
    if (target?.closest?.('.cm-editor')) {
      options.onInteract?.();
      return;
    }
    // Pointerdown on a resize handle must reach the resizable.ts listener
    // (bubble phase). Our capture-phase handler runs first; if we claim the
    // event with preventDefault/stopPropagation, resize never starts. Skip
    // drag here — resize.ts will fire its own onInteract.
    if (target?.closest?.('.jp-CellLayout-handle')) {
      return;
    }
    // Pointerdown on any button descendant (Excel refresh, code-cell Run,
    // future cell-toolbar items…) must reach the button's own click flow.
    // Stage B's capture-phase listener would otherwise claim the event with
    // stopPropagation and the click is never synthesised.
    if (target?.closest?.('button')) {
      options.onInteract?.();
      return;
    }
    options.onInteract?.();
    dragging = true;
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startMm = { ...getInitialPositionMm() };
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    node.classList.add('jp-CellLayout-dragging');
    e.preventDefault();
    e.stopPropagation();
  };

  const rawDeltaMm = (e: PointerEvent): IPosition => {
    return {
      x: Math.max(0, startMm.x + pxToMm(e.clientX - startClientX)),
      y: Math.max(0, startMm.y + pxToMm(e.clientY - startClientY))
    };
  };

  const applySnaps = (
    raw: IPosition
  ): { pos: IPosition; guides: IGuideLine[] } => {
    let guides: IGuideLine[] = [];
    let snappedX = false;
    let snappedY = false;
    let pos: IPosition = raw;
    if (options.snapHandler) {
      const widthMm = pxToMm(node.offsetWidth);
      const heightMm = pxToMm(node.offsetHeight);
      const result = options.snapHandler.computeDrag({
        x: raw.x,
        y: raw.y,
        width: widthMm,
        height: heightMm
      });
      snappedX = result.snapped.x;
      snappedY = result.snapped.y;
      guides = result.guides;
      if (snappedX) {
        pos = { x: result.rect.x, y: pos.y };
      }
      if (snappedY) {
        pos = { x: pos.x, y: result.rect.y };
      }
    }
    const grid = options.getGridSnapMm?.() ?? 0;
    pos = {
      x: snappedX ? pos.x : Math.max(0, snapToGrid(pos.x, grid)),
      y: snappedY ? pos.y : Math.max(0, snapToGrid(pos.y, grid))
    };
    return { pos, guides };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    const raw = rawDeltaMm(e);
    const { pos, guides } = applySnaps(raw);
    node.style.left = `${mmToPx(pos.x)}px`;
    node.style.top = `${mmToPx(pos.y)}px`;
    options.snapHandler?.showGuides(guides);
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    dragging = false;
    const raw = rawDeltaMm(e);
    const { pos } = applySnaps(raw);
    const rounded: IPosition = { x: roundMm(pos.x), y: roundMm(pos.y) };
    try {
      node.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    node.classList.remove('jp-CellLayout-dragging');
    activePointerId = null;
    options.snapHandler?.showGuides([]);
    onPositionChange(rounded);
  };

  // Capture phase for pointerdown so the cell-level handler runs before any
  // inner widget (e.g. CodeMirror) can stopPropagation. Without this, clicks
  // inside an embedded editor never reach our `onInteract` callback and the
  // mode-switch carryover (#38) silently breaks. The other phase listeners
  // can stay on bubble — once dragging is active we use pointer capture.
  node.addEventListener('pointerdown', onPointerDown, { capture: true });
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);

  return {
    dispose: () => {
      node.removeEventListener('pointerdown', onPointerDown, { capture: true });
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endDrag);
      node.removeEventListener('pointercancel', endDrag);
    }
  };
}
