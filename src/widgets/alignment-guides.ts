import type { ResizeHandle } from './resizable';

export interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IPageBox {
  width: number;
  height: number;
  pageCount: number;
}

export type GuideAxis = 'x' | 'y';

export interface IGuideLine {
  axis: GuideAxis;
  position: number;
  start: number;
  end: number;
}

export interface ISnapResult {
  rect: IRect;
  guides: IGuideLine[];
  snapped: { x: boolean; y: boolean };
}

type CandidateKind = 'edge' | 'centre';

interface ICandidate {
  value: number;
  guideStart: number;
  guideEnd: number;
  kind: CandidateKind;
}

/**
 * Index of the page on which the rect's vertical centre falls. Used to
 * restrict snap targets to rects on the same page.
 */
export function activePageIndex(rect: IRect, pageHeight: number): number {
  if (pageHeight <= 0) {
    return 0;
  }
  const cy = rect.y + rect.height / 2;
  return Math.max(0, Math.floor(cy / pageHeight));
}

function pageOverlap(rect: IRect, pageIndex: number, pageHeight: number): boolean {
  const top = pageIndex * pageHeight;
  const bot = top + pageHeight;
  return rect.y + rect.height > top && rect.y < bot;
}

function collectXCandidates(
  siblings: IRect[],
  pageBox: IPageBox,
  pageIndex: number
): ICandidate[] {
  const top = pageIndex * pageBox.height;
  const bot = top + pageBox.height;
  const out: ICandidate[] = [];
  for (const s of siblings) {
    out.push({ value: s.x, guideStart: s.y, guideEnd: s.y + s.height, kind: 'edge' });
    out.push({
      value: s.x + s.width,
      guideStart: s.y,
      guideEnd: s.y + s.height,
      kind: 'edge'
    });
    out.push({
      value: s.x + s.width / 2,
      guideStart: s.y,
      guideEnd: s.y + s.height,
      kind: 'centre'
    });
  }
  out.push({ value: 0, guideStart: top, guideEnd: bot, kind: 'edge' });
  out.push({ value: pageBox.width, guideStart: top, guideEnd: bot, kind: 'edge' });
  out.push({ value: pageBox.width / 2, guideStart: top, guideEnd: bot, kind: 'centre' });
  return out;
}

function collectYCandidates(
  siblings: IRect[],
  pageBox: IPageBox,
  pageIndex: number
): ICandidate[] {
  const top = pageIndex * pageBox.height;
  const bot = top + pageBox.height;
  const out: ICandidate[] = [];
  for (const s of siblings) {
    out.push({ value: s.y, guideStart: s.x, guideEnd: s.x + s.width, kind: 'edge' });
    out.push({
      value: s.y + s.height,
      guideStart: s.x,
      guideEnd: s.x + s.width,
      kind: 'edge'
    });
    out.push({
      value: s.y + s.height / 2,
      guideStart: s.x,
      guideEnd: s.x + s.width,
      kind: 'centre'
    });
  }
  out.push({ value: top, guideStart: 0, guideEnd: pageBox.width, kind: 'edge' });
  out.push({ value: bot, guideStart: 0, guideEnd: pageBox.width, kind: 'edge' });
  out.push({
    value: top + pageBox.height / 2,
    guideStart: 0,
    guideEnd: pageBox.width,
    kind: 'centre'
  });
  return out;
}

interface IBestSnap {
  delta: number;
  candidate: ICandidate;
}

function bestSnapOnAxis(
  movingEdges: { value: number }[],
  candidates: ICandidate[],
  tolerance: number
): IBestSnap | null {
  let best: IBestSnap | null = null;
  let bestDist = tolerance + 1;
  for (const edge of movingEdges) {
    for (const c of candidates) {
      const dist = Math.abs(c.value - edge.value);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        best = {
          delta: c.value - edge.value,
          candidate: c
        };
      }
    }
  }
  return best;
}

function buildGuide(
  axis: GuideAxis,
  best: IBestSnap,
  movedRect: IRect
): IGuideLine {
  const movedStart = axis === 'x' ? movedRect.y : movedRect.x;
  const movedEnd =
    axis === 'x' ? movedRect.y + movedRect.height : movedRect.x + movedRect.width;
  const start = Math.min(best.candidate.guideStart, movedStart);
  const end = Math.max(best.candidate.guideEnd, movedEnd);
  return {
    axis,
    position: best.candidate.value,
    start,
    end
  };
}

/**
 * Compute a snap for a rect being dragged. Tries to align any of the moving
 * rect's edges (left, right, centreX, top, bottom, centreY) to a sibling or
 * page edge / centre on the active page, within tolerance. Returns at most
 * one guide per axis.
 */
export function computeDragSnap(
  moving: IRect,
  siblings: IRect[],
  pageBox: IPageBox,
  tolerance: number
): ISnapResult {
  if (tolerance <= 0) {
    return {
      rect: moving,
      guides: [],
      snapped: { x: false, y: false }
    };
  }
  const pageIndex = activePageIndex(moving, pageBox.height);
  const eligible = siblings.filter(s =>
    pageOverlap(s, pageIndex, pageBox.height)
  );
  const xCands = collectXCandidates(eligible, pageBox, pageIndex);
  const yCands = collectYCandidates(eligible, pageBox, pageIndex);

  const movingXEdges = [
    { value: moving.x },
    { value: moving.x + moving.width },
    { value: moving.x + moving.width / 2 }
  ];
  const movingYEdges = [
    { value: moving.y },
    { value: moving.y + moving.height },
    { value: moving.y + moving.height / 2 }
  ];

  const bestX = bestSnapOnAxis(movingXEdges, xCands, tolerance);
  const bestY = bestSnapOnAxis(movingYEdges, yCands, tolerance);

  const newX = bestX ? moving.x + bestX.delta : moving.x;
  const newY = bestY ? moving.y + bestY.delta : moving.y;
  const snappedRect: IRect = {
    x: newX,
    y: newY,
    width: moving.width,
    height: moving.height
  };
  const guides: IGuideLine[] = [];
  if (bestX) {
    guides.push(buildGuide('x', bestX, snappedRect));
  }
  if (bestY) {
    guides.push(buildGuide('y', bestY, snappedRect));
  }
  return {
    rect: snappedRect,
    guides,
    snapped: { x: !!bestX, y: !!bestY }
  };
}

/**
 * Compute a snap for a rect being resized. Only the edges driven by the
 * active resize handle participate. Centre candidates are excluded — aligning
 * a moving edge to a sibling centre rarely matches intent during resize.
 */
export function computeResizeSnap(
  moving: IRect,
  handle: ResizeHandle,
  siblings: IRect[],
  pageBox: IPageBox,
  tolerance: number,
  minSize: { width: number; height: number }
): ISnapResult {
  if (tolerance <= 0) {
    return {
      rect: moving,
      guides: [],
      snapped: { x: false, y: false }
    };
  }
  const pageIndex = activePageIndex(moving, pageBox.height);
  const eligible = siblings.filter(s =>
    pageOverlap(s, pageIndex, pageBox.height)
  );
  const xMover = movingHorizontalEdge(handle);
  const yMover = movingVerticalEdge(handle);

  let result = { ...moving };
  let snappedX = false;
  let snappedY = false;
  const guides: IGuideLine[] = [];

  if (xMover !== null) {
    const xCands = collectXCandidates(eligible, pageBox, pageIndex).filter(
      c => c.kind === 'edge'
    );
    const movingValue =
      xMover === 'left' ? result.x : result.x + result.width;
    const best = bestSnapOnAxis([{ value: movingValue }], xCands, tolerance);
    if (best) {
      if (xMover === 'left') {
        const right = result.x + result.width;
        const newLeft = Math.min(best.candidate.value, right - minSize.width);
        result = { ...result, x: newLeft, width: right - newLeft };
      } else {
        const newRight = Math.max(
          best.candidate.value,
          result.x + minSize.width
        );
        result = { ...result, width: newRight - result.x };
      }
      snappedX = true;
      guides.push(buildGuide('x', best, result));
    }
  }

  if (yMover !== null) {
    const yCands = collectYCandidates(eligible, pageBox, pageIndex).filter(
      c => c.kind === 'edge'
    );
    const movingValue =
      yMover === 'top' ? result.y : result.y + result.height;
    const best = bestSnapOnAxis([{ value: movingValue }], yCands, tolerance);
    if (best) {
      if (yMover === 'top') {
        const bottom = result.y + result.height;
        const newTop = Math.min(best.candidate.value, bottom - minSize.height);
        result = { ...result, y: newTop, height: bottom - newTop };
      } else {
        const newBottom = Math.max(
          best.candidate.value,
          result.y + minSize.height
        );
        result = { ...result, height: newBottom - result.y };
      }
      snappedY = true;
      guides.push(buildGuide('y', best, result));
    }
  }

  return {
    rect: result,
    guides,
    snapped: { x: snappedX, y: snappedY }
  };
}

function movingHorizontalEdge(handle: ResizeHandle): 'left' | 'right' | null {
  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    return 'left';
  }
  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    return 'right';
  }
  return null;
}

function movingVerticalEdge(handle: ResizeHandle): 'top' | 'bottom' | null {
  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    return 'top';
  }
  if (handle === 's' || handle === 'sw' || handle === 'se') {
    return 'bottom';
  }
  return null;
}
