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

/**
 * One sibling DOM node that should follow the primary by the same delta
 * during a drag. Used for group-drag (a "linked" cell where input + outputs
 * move as one).
 */
export interface IDragSibling {
  node: HTMLElement;
  /** Read the sibling's current position at drag start (in mm). */
  getInitialMm: () => IPosition;
  /** Persist the sibling's final position on pointerup. */
  onPositionChange: (pos: IPosition) => void;
}

export interface IDragOptions {
  getGridSnapMm?: () => number;
  onInteract?: () => void;
  snapHandler?: ISnapHandler;
  /**
   * Optional callback returning sibling nodes that should follow the
   * dragged primary by the same delta. Evaluated on each pointerdown so
   * the membership can change between drags (e.g. group-drag mode toggled
   * by a double-click).
   */
  getSiblings?: () => IDragSibling[];
  /**
   * Called when the auto-scroll loop wants to scroll the container further
   * downward (cursor at bottom edge) but `scrollTop` is already at its
   * maximum — i.e. the canvas has nothing more to expose. Implementations
   * typically respond by appending a blank page so the scroll container
   * gains room. Return true if more space was made available; the rAF
   * loop then re-evaluates next frame and the now-larger container can
   * scroll. Return false to give up. Throttled internally so a single
   * sustained drag at the bottom edge doesn't add pages every frame.
   */
  requestMorePageSpace?: () => boolean;
}

function roundMm(v: number): number {
  return Math.round(v * 10) / 10;
}

// Edge auto-scroll tuning. ZONE_PX is how close (in client px) the cursor must
// be to the scroll container's edge before the loop kicks in; MAX_SPEED is the
// per-frame scroll delta when the cursor is at or past the edge. Linear ramp
// in between; ~14 px/frame at 60fps ≈ 840 px/s, brisk but not runaway.
const AUTOSCROLL_ZONE_PX = 50;
const AUTOSCROLL_MAX_SPEED_PX = 14;

/**
 * Per-frame scroll velocity for one axis given the cursor's client coord and
 * the viewport edges along that axis. Returns 0 when the cursor is outside
 * the start zone on both ends, a negative value to scroll toward `min`, and
 * a positive value to scroll toward `max`. Past-edge cursors saturate at
 * `maxSpeedPxPerFrame`. Pure — no DOM access; unit-tested.
 */
export function computeAutoScrollVelocity(params: {
  client: number;
  min: number;
  max: number;
  zonePx: number;
  maxSpeedPxPerFrame: number;
}): number {
  const { client, min, max, zonePx, maxSpeedPxPerFrame } = params;
  if (zonePx <= 0 || maxSpeedPxPerFrame <= 0) {
    return 0;
  }
  const distFromMin = client - min;
  const distFromMax = max - client;
  if (distFromMin < zonePx) {
    const intensity = Math.min(1, Math.max(0, (zonePx - distFromMin) / zonePx));
    return -intensity * maxSpeedPxPerFrame;
  }
  if (distFromMax < zonePx) {
    const intensity = Math.min(1, Math.max(0, (zonePx - distFromMax) / zonePx));
    return intensity * maxSpeedPxPerFrame;
  }
  return 0;
}

/**
 * Walk up from `node` to the nearest ancestor whose computed overflow on either
 * axis is `auto` or `scroll`. Returns null if none found (e.g. detached node).
 * Cached by `enableDrag` per drag-start so we don't re-walk every frame.
 */
function findScrollContainer(node: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const style =
      typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style) {
      const oy = style.overflowY;
      const ox = style.overflowX;
      if (oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll') {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
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
  // Active sibling tracking — populated on each drag start, drained on end.
  let activeSiblings: Array<IDragSibling & { startMm: IPosition }> = [];
  // Scroll container tracked for the duration of a drag. The cell's mm
  // coordinate must move not just with the cursor but also with the scroll
  // delta, otherwise scrolling (manual or auto) detaches the cell from the
  // cursor — the cell stays "anchored" to the page while the cursor lands
  // over a different page-relative position.
  let scrollContainer: HTMLElement | null = null;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  // Latest pointer coords from pointermove. The auto-scroll rAF loop replays
  // updates with these so the cell keeps following the cursor while the
  // viewport scrolls past it (cursor stationary, scroll moving).
  let lastClientX = 0;
  let lastClientY = 0;
  let autoScrollFrame: number | null = null;
  // Throttle the page-grow callback: even at 60 fps with the cursor pinned
  // to the bottom, we shouldn't add a new page every frame. 250 ms ≈ 4 pages
  // per second under sustained pressure, which matches typical scroll feel
  // without spamming the metadata.
  let lastSpaceRequestAt = 0;

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
    // Pointerdown inside an interactive ipywidget (slider, dropdown, the
    // mpl_interactions canvas itself…) must reach the widget so the
    // user can actually use it. JL's widgets manager wraps every widget
    // view in a `.jupyter-widgets` element, so a closest()-walk is a
    // reliable bypass.
    if (target?.closest?.('.jupyter-widgets')) {
      options.onInteract?.();
      return;
    }
    options.onInteract?.();
    dragging = true;
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    startMm = { ...getInitialPositionMm() };
    scrollContainer = findScrollContainer(node);
    startScrollLeft = scrollContainer?.scrollLeft ?? 0;
    startScrollTop = scrollContainer?.scrollTop ?? 0;
    // Capture sibling start positions for group drag. Their DOM is
    // mutated live during pointermove and persisted on pointerup.
    activeSiblings = (options.getSiblings?.() ?? []).map(s => ({
      ...s,
      startMm: { ...s.getInitialMm() }
    }));
    for (const s of activeSiblings) {
      s.node.classList.add('jp-CellLayout-dragging');
    }
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    node.classList.add('jp-CellLayout-dragging');
    e.preventDefault();
    e.stopPropagation();
  };

  const rawDeltaFromCursor = (clientX: number, clientY: number): IPosition => {
    const scrollDx = (scrollContainer?.scrollLeft ?? 0) - startScrollLeft;
    const scrollDy = (scrollContainer?.scrollTop ?? 0) - startScrollTop;
    return {
      x: Math.max(0, startMm.x + pxToMm(clientX - startClientX + scrollDx)),
      y: Math.max(0, startMm.y + pxToMm(clientY - startClientY + scrollDy))
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

  const updatePositionsForCursor = (clientX: number, clientY: number): void => {
    const raw = rawDeltaFromCursor(clientX, clientY);
    const { pos, guides } = applySnaps(raw);
    node.style.left = `${mmToPx(pos.x)}px`;
    node.style.top = `${mmToPx(pos.y)}px`;
    options.snapHandler?.showGuides(guides);
    // Move siblings by the same (post-snap) delta. Snap operates on the
    // primary; siblings just follow.
    const dx = pos.x - startMm.x;
    const dy = pos.y - startMm.y;
    for (const s of activeSiblings) {
      const sx = s.startMm.x + dx;
      const sy = s.startMm.y + dy;
      s.node.style.left = `${mmToPx(sx)}px`;
      s.node.style.top = `${mmToPx(sy)}px`;
    }
  };

  const stopAutoScroll = (): void => {
    if (autoScrollFrame !== null) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
  };

  // Visible edges of the scroll container, clipped to the document viewport.
  // Clipping matters when the container's bounding rect extends past the
  // visible viewport (e.g. the notebook panel sits inside a JL parent that
  // scrolls). Without clipping, `rect.bottom` may be below the user's screen
  // bottom and the cursor can never reach the bottom auto-scroll zone — top
  // works because `rect.top` typically falls inside the viewport, but bottom
  // does not. The fix uses the intersection of the container rect and the
  // window viewport for edge calculations.
  const visibleEdges = (): { top: number; bottom: number; left: number; right: number } => {
    const rect = scrollContainer!.getBoundingClientRect();
    const viewW =
      typeof window !== 'undefined'
        ? window.innerWidth
        : Number.POSITIVE_INFINITY;
    const viewH =
      typeof window !== 'undefined'
        ? window.innerHeight
        : Number.POSITIVE_INFINITY;
    return {
      top: Math.max(rect.top, 0),
      bottom: Math.min(rect.bottom, viewH),
      left: Math.max(rect.left, 0),
      right: Math.min(rect.right, viewW)
    };
  };

  // rAF tick: while the cursor is in the auto-scroll zone, scroll the
  // container by the velocity computed from edge proximity, then replay
  // the position update so the cell keeps following the cursor as the
  // viewport scrolls beneath it. Self-cancels when velocity falls to zero
  // on both axes (e.g. cursor moved out of the zone, or container hit a
  // scroll boundary).
  const autoScrollTick = (): void => {
    autoScrollFrame = null;
    if (!dragging || !scrollContainer) {
      return;
    }
    const edges = visibleEdges();
    const vy = computeAutoScrollVelocity({
      client: lastClientY,
      min: edges.top,
      max: edges.bottom,
      zonePx: AUTOSCROLL_ZONE_PX,
      maxSpeedPxPerFrame: AUTOSCROLL_MAX_SPEED_PX
    });
    const vx = computeAutoScrollVelocity({
      client: lastClientX,
      min: edges.left,
      max: edges.right,
      zonePx: AUTOSCROLL_ZONE_PX,
      maxSpeedPxPerFrame: AUTOSCROLL_MAX_SPEED_PX
    });
    if (vy === 0 && vx === 0) {
      // Cursor not in any auto-scroll zone — let pointermove restart us
      // if it re-enters one.
      return;
    }
    // Try to scroll. Returns true if either axis moved.
    const tryScroll = (): { movedY: boolean; movedX: boolean } => {
      const beforeTop = scrollContainer!.scrollTop;
      const beforeLeft = scrollContainer!.scrollLeft;
      if (vy !== 0) {
        scrollContainer!.scrollTop = beforeTop + vy;
      }
      if (vx !== 0) {
        scrollContainer!.scrollLeft = beforeLeft + vx;
      }
      return {
        movedY: scrollContainer!.scrollTop !== beforeTop,
        movedX: scrollContainer!.scrollLeft !== beforeLeft
      };
    };
    let { movedY, movedX } = tryScroll();
    if (!movedY && vy > 0 && options.requestMorePageSpace) {
      // Cursor pinned at bottom edge but the container can't scroll further.
      // Ask the canvas to append a page (throttled). The page-grow callback
      // mutates `_page.style.height` synchronously, but the browser's reflow
      // is normally deferred — so the scrollTop assignment we just made was
      // clamped against the *old* scrollHeight. Force a reflow by reading
      // scrollHeight, then retry the scroll in this same frame so the cell
      // actually advances rather than waiting for the next rAF tick (which
      // would only spend more throttle budget on more page-grows without
      // ever scrolling, the symptom that made this fix necessary).
      const now = Date.now();
      if (now - lastSpaceRequestAt > 250) {
        lastSpaceRequestAt = now;
        if (options.requestMorePageSpace()) {
          // Force sync layout so `scrollHeight` reflects the new page.
          void scrollContainer.scrollHeight;
          const retry = tryScroll();
          movedY = retry.movedY;
          movedX = movedX || retry.movedX;
        }
      }
    }
    if (movedY || movedX) {
      updatePositionsForCursor(lastClientX, lastClientY);
    }
    // Keep ticking while the cursor is in any zone — even when we couldn't
    // scroll this frame, the user may still be holding at the edge waiting
    // for a page-grow to take effect. The loop self-cancels next time the
    // cursor leaves all zones (see the early return above).
    autoScrollFrame = requestAnimationFrame(autoScrollTick);
  };

  const maybeStartAutoScroll = (): void => {
    if (!dragging || !scrollContainer || autoScrollFrame !== null) {
      return;
    }
    const edges = visibleEdges();
    const vy = computeAutoScrollVelocity({
      client: lastClientY,
      min: edges.top,
      max: edges.bottom,
      zonePx: AUTOSCROLL_ZONE_PX,
      maxSpeedPxPerFrame: AUTOSCROLL_MAX_SPEED_PX
    });
    const vx = computeAutoScrollVelocity({
      client: lastClientX,
      min: edges.left,
      max: edges.right,
      zonePx: AUTOSCROLL_ZONE_PX,
      maxSpeedPxPerFrame: AUTOSCROLL_MAX_SPEED_PX
    });
    if (vy !== 0 || vx !== 0) {
      autoScrollFrame = requestAnimationFrame(autoScrollTick);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    updatePositionsForCursor(e.clientX, e.clientY);
    maybeStartAutoScroll();
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== activePointerId) {
      return;
    }
    dragging = false;
    stopAutoScroll();
    const raw = rawDeltaFromCursor(e.clientX, e.clientY);
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
    // Persist sibling positions using the same final delta (post-snap,
    // post-clamp). Each sibling's onPositionChange is the equivalent of
    // its own drag-end callback.
    const dx = pos.x - startMm.x;
    const dy = pos.y - startMm.y;
    for (const s of activeSiblings) {
      s.node.classList.remove('jp-CellLayout-dragging');
      const finalPos: IPosition = {
        x: roundMm(s.startMm.x + dx),
        y: roundMm(s.startMm.y + dy)
      };
      s.onPositionChange(finalPos);
    }
    activeSiblings = [];
    scrollContainer = null;
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
      stopAutoScroll();
      node.removeEventListener('pointerdown', onPointerDown, { capture: true });
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endDrag);
      node.removeEventListener('pointercancel', endDrag);
    }
  };
}
