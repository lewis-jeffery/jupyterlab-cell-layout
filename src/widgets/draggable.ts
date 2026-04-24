import type { IPosition } from '../managers/metadata';
import { mmToPx, pxToMm, snapToGrid } from './units';

export interface IDragController {
  dispose(): void;
}

function roundMm(v: number): number {
  return Math.round(v * 10) / 10;
}

export function enableDrag(
  node: HTMLElement,
  getInitialPositionMm: () => IPosition,
  onPositionChange: (posMm: IPosition) => void,
  getGridSnapMm?: () => number,
  onInteract?: () => void
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
    onInteract?.();
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

  const currentDeltaMm = (e: PointerEvent): IPosition => {
    const dxPx = e.clientX - startClientX;
    const dyPx = e.clientY - startClientY;
    const snap = getGridSnapMm?.() ?? 0;
    return {
      x: Math.max(0, snapToGrid(startMm.x + pxToMm(dxPx), snap)),
      y: Math.max(0, snapToGrid(startMm.y + pxToMm(dyPx), snap))
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    const mm = currentDeltaMm(e);
    node.style.left = `${mmToPx(mm.x)}px`;
    node.style.top = `${mmToPx(mm.y)}px`;
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    dragging = false;
    const mm = currentDeltaMm(e);
    const rounded: IPosition = { x: roundMm(mm.x), y: roundMm(mm.y) };
    try {
      node.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    node.classList.remove('jp-CellLayout-dragging');
    activePointerId = null;
    onPositionChange(rounded);
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);

  return {
    dispose: () => {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endDrag);
      node.removeEventListener('pointercancel', endDrag);
    }
  };
}
