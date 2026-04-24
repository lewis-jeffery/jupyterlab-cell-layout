import type { IPosition, ISize } from '../managers/metadata';
import { mmToPx, pxToMm, snapToGrid } from './units';

export type ResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se';

export const ALL_HANDLES: ReadonlyArray<ResizeHandle> = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w'
];

export interface IGeometry {
  position: IPosition;
  size: ISize;
}

export interface IResizeController {
  dispose(): void;
}

export interface IResizeOptions {
  minSize?: ISize;
  getGridSnapMm?: () => number;
  onInteract?: () => void;
}

const HANDLE_CONFIG: Record<
  ResizeHandle,
  { dx: -1 | 0 | 1; dy: -1 | 0 | 1; movesX: boolean; movesY: boolean }
> = {
  e: { dx: 1, dy: 0, movesX: false, movesY: false },
  se: { dx: 1, dy: 1, movesX: false, movesY: false },
  s: { dx: 0, dy: 1, movesX: false, movesY: false },
  sw: { dx: -1, dy: 1, movesX: true, movesY: false },
  w: { dx: -1, dy: 0, movesX: true, movesY: false },
  nw: { dx: -1, dy: -1, movesX: true, movesY: true },
  n: { dx: 0, dy: -1, movesX: false, movesY: true },
  ne: { dx: 1, dy: -1, movesX: false, movesY: true }
};

/**
 * Pure function: given the starting geometry, which handle is being dragged,
 * and the mouse delta in mm, compute the new geometry enforcing min size and
 * a non-negative origin.
 */
export function computeResizedGeometry(
  handle: ResizeHandle,
  start: IGeometry,
  deltaMm: { x: number; y: number },
  minSize: ISize
): IGeometry {
  const cfg = HANDLE_CONFIG[handle];
  const rawWidth = start.size.width + cfg.dx * deltaMm.x;
  const rawHeight = start.size.height + cfg.dy * deltaMm.y;
  const width = Math.max(minSize.width, rawWidth);
  const height = Math.max(minSize.height, rawHeight);
  let x = start.position.x;
  let y = start.position.y;
  if (cfg.movesX) {
    x = start.position.x - (width - start.size.width);
  }
  if (cfg.movesY) {
    y = start.position.y - (height - start.size.height);
  }
  x = Math.max(0, x);
  y = Math.max(0, y);
  return { position: { x, y }, size: { width, height } };
}

function roundMm(v: number): number {
  return Math.round(v * 10) / 10;
}

function createHandleElement(handle: ResizeHandle): HTMLElement {
  const el = document.createElement('div');
  el.className = `jp-CellLayout-handle jp-CellLayout-handle-${handle}`;
  el.dataset.handle = handle;
  return el;
}

export function enableResize(
  rootNode: HTMLElement,
  getInitialGeometry: () => IGeometry,
  onGeometryChange: (geom: IGeometry) => void,
  options: IResizeOptions = {}
): IResizeController {
  const minSize = options.minSize ?? { width: 20, height: 15 };
  const handles: HTMLElement[] = [];
  let startClientX = 0;
  let startClientY = 0;
  let startGeom: IGeometry | null = null;
  let activeHandle: ResizeHandle | null = null;
  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const target = e.currentTarget as HTMLElement;
    const handle = target.dataset.handle as ResizeHandle | undefined;
    if (!handle) {
      return;
    }
    options.onInteract?.();
    activeHandle = handle;
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startGeom = {
      position: { ...getInitialGeometry().position },
      size: { ...getInitialGeometry().size }
    };
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    rootNode.classList.add('jp-CellLayout-resizing');
    e.preventDefault();
    e.stopPropagation();
  };

  const applyGeom = (geom: IGeometry): void => {
    rootNode.style.left = `${mmToPx(geom.position.x)}px`;
    rootNode.style.top = `${mmToPx(geom.position.y)}px`;
    rootNode.style.width = `${mmToPx(geom.size.width)}px`;
    rootNode.style.height = `${mmToPx(geom.size.height)}px`;
  };

  const computeCurrent = (e: PointerEvent): IGeometry | null => {
    if (!startGeom || !activeHandle) {
      return null;
    }
    const deltaMm = {
      x: pxToMm(e.clientX - startClientX),
      y: pxToMm(e.clientY - startClientY)
    };
    const raw = computeResizedGeometry(
      activeHandle,
      startGeom,
      deltaMm,
      minSize
    );
    const snap = options.getGridSnapMm?.() ?? 0;
    if (snap <= 0) {
      return raw;
    }
    return {
      position: {
        x: Math.max(0, snapToGrid(raw.position.x, snap)),
        y: Math.max(0, snapToGrid(raw.position.y, snap))
      },
      size: {
        width: Math.max(minSize.width, snapToGrid(raw.size.width, snap)),
        height: Math.max(minSize.height, snapToGrid(raw.size.height, snap))
      }
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activeHandle === null || e.pointerId !== activePointerId) {
      return;
    }
    const geom = computeCurrent(e);
    if (geom) {
      applyGeom(geom);
    }
  };

  const endResize = (e: PointerEvent) => {
    if (activeHandle === null || e.pointerId !== activePointerId) {
      return;
    }
    const geom = computeCurrent(e);
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    rootNode.classList.remove('jp-CellLayout-resizing');
    activeHandle = null;
    activePointerId = null;
    startGeom = null;
    if (geom) {
      onGeometryChange({
        position: { x: roundMm(geom.position.x), y: roundMm(geom.position.y) },
        size: {
          width: roundMm(geom.size.width),
          height: roundMm(geom.size.height)
        }
      });
    }
  };

  for (const handle of ALL_HANDLES) {
    const el = createHandleElement(handle);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endResize);
    el.addEventListener('pointercancel', endResize);
    rootNode.appendChild(el);
    handles.push(el);
  }

  return {
    dispose: () => {
      for (const h of handles) {
        h.removeEventListener('pointerdown', onPointerDown);
        h.removeEventListener('pointermove', onPointerMove);
        h.removeEventListener('pointerup', endResize);
        h.removeEventListener('pointercancel', endResize);
        h.parentElement?.removeChild(h);
      }
    }
  };
}
