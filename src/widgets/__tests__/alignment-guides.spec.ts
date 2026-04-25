import {
  activePageIndex,
  computeDragSnap,
  computeResizeSnap,
  type IPageBox,
  type IRect
} from '../alignment-guides';

const A4: IPageBox = { width: 210, height: 297, pageCount: 3 };
const TOL = 2;
const MIN_SIZE = { width: 20, height: 15 };

describe('activePageIndex', () => {
  it('returns 0 for a rect at the top of the canvas', () => {
    expect(activePageIndex({ x: 0, y: 0, width: 50, height: 30 }, 297)).toBe(0);
  });
  it('returns 1 for a rect whose centre falls on page 2', () => {
    expect(
      activePageIndex({ x: 0, y: 320, width: 50, height: 30 }, 297)
    ).toBe(1);
  });
  it('clamps to 0 for negative y', () => {
    expect(
      activePageIndex({ x: 0, y: -50, width: 10, height: 5 }, 297)
    ).toBe(0);
  });
});

describe('computeDragSnap', () => {
  it('returns no snap when tolerance is 0', () => {
    const moving: IRect = { x: 50, y: 50, width: 40, height: 30 };
    const sibling: IRect = { x: 51, y: 50, width: 40, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, 0);
    expect(r.snapped).toEqual({ x: false, y: false });
    expect(r.rect).toEqual(moving);
    expect(r.guides).toHaveLength(0);
  });

  it('snaps left edge to a sibling left edge within tolerance', () => {
    const moving: IRect = { x: 51, y: 100, width: 40, height: 30 };
    const sibling: IRect = { x: 50, y: 200, width: 40, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(50);
    expect(r.rect.y).toBe(100);
    expect(r.guides.find(g => g.axis === 'x')?.position).toBe(50);
  });

  it('snaps right edge of moving rect to right edge of sibling', () => {
    // Sibling spans x: 50..150. Moving spans x: 109..149 — right edge at 149,
    // 1mm short of sibling.right=150 → should snap so moving.right = 150 → moving.x = 110.
    const moving: IRect = { x: 109, y: 100, width: 40, height: 30 };
    const sibling: IRect = { x: 50, y: 200, width: 100, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(110);
  });

  it('snaps centre to sibling centre on x', () => {
    // Sibling centreX = 50+50 = 100. Moving centreX = 30+20 = 50 → no.
    // Make moving centreX = 99 → snaps to 100.
    const moving: IRect = { x: 79, y: 100, width: 40, height: 30 };
    const sibling: IRect = { x: 50, y: 200, width: 100, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    expect(r.snapped.x).toBe(true);
    // moving.x adjusted so centre = 100 → x = 80.
    expect(r.rect.x).toBe(80);
  });

  it('snaps to page edges', () => {
    const moving: IRect = { x: 1, y: 100, width: 40, height: 30 };
    const r = computeDragSnap(moving, [], A4, TOL);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(0);
  });

  it('snaps to page horizontal centre', () => {
    // Page width centre = 105. Moving centreX at 106 → snap to 105.
    const moving: IRect = { x: 86, y: 100, width: 40, height: 30 };
    const r = computeDragSnap(moving, [], A4, TOL);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x + r.rect.width / 2).toBeCloseTo(105);
  });

  it('does not snap to siblings on a different page', () => {
    // Moving rect on page 0 (y centre ≈ 100). Sibling on page 1 (y > 297).
    const moving: IRect = { x: 51, y: 100, width: 40, height: 30 };
    const sibling: IRect = { x: 50, y: 350, width: 40, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    // Should not snap to sibling.left=50 because sibling is on a different page.
    // But moving.x=51 → could it snap to page edge x=0? distance=51, no.
    // Or page centre x=105 → moving.right=91 vs 105 dist 14, no. So no snap.
    expect(r.snapped.x).toBe(false);
    expect(r.rect.x).toBe(51);
  });

  it('snaps independently on x and y', () => {
    const moving: IRect = { x: 51, y: 101, width: 40, height: 30 };
    const sibling: IRect = { x: 50, y: 100, width: 40, height: 30 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    expect(r.snapped.x).toBe(true);
    expect(r.snapped.y).toBe(true);
    expect(r.rect.x).toBe(50);
    expect(r.rect.y).toBe(100);
    expect(r.guides).toHaveLength(2);
  });

  it('picks the closest target when multiple are within tolerance', () => {
    // sibling1.left=50, sibling2.left=51. moving.x=51.5 → distance to 51 is 0.5,
    // to 50 is 1.5. Should pick 51.
    const moving: IRect = { x: 51.5, y: 100, width: 40, height: 30 };
    const sib1: IRect = { x: 50, y: 200, width: 40, height: 30 };
    const sib2: IRect = { x: 51, y: 220, width: 40, height: 30 };
    const r = computeDragSnap(moving, [sib1, sib2], A4, TOL);
    expect(r.rect.x).toBe(51);
  });

  it('does not snap when nothing is within tolerance', () => {
    // moving spans x: 60..80, sibling spans x: 130..160. Closest distance is
    // 50mm which is far outside the 2mm tolerance. Same on y.
    const moving: IRect = { x: 60, y: 30, width: 20, height: 15 };
    const sibling: IRect = { x: 130, y: 250, width: 30, height: 20 };
    const r = computeDragSnap(moving, [sibling], A4, TOL);
    expect(r.snapped).toEqual({ x: false, y: false });
    expect(r.rect).toEqual(moving);
  });
});

describe('computeResizeSnap', () => {
  it('east handle snaps right edge to sibling left edge', () => {
    const moving: IRect = { x: 20, y: 100, width: 29, height: 30 };
    // moving.right = 49. Sibling.left = 50, distance 1 → snap.
    const sibling: IRect = { x: 50, y: 100, width: 40, height: 30 };
    const r = computeResizeSnap(moving, 'e', [sibling], A4, TOL, MIN_SIZE);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(20);
    expect(r.rect.width).toBe(30);
  });

  it('west handle snaps left edge to sibling right edge', () => {
    const moving: IRect = { x: 91, y: 100, width: 40, height: 30 };
    // moving.left = 91. Sibling.right = 50 + 40 = 90, distance 1.
    const sibling: IRect = { x: 50, y: 100, width: 40, height: 30 };
    const r = computeResizeSnap(moving, 'w', [sibling], A4, TOL, MIN_SIZE);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(90);
    // width grew by 1 (from 40 to 41) since right edge unchanged.
    expect(r.rect.width).toBe(41);
  });

  it('does not snap to centre candidates', () => {
    // Sibling centreX = 50+20 = 70. Moving.right = 71 → distance 1, would snap on drag.
    // But for resize, centre candidates are excluded → no snap.
    const moving: IRect = { x: 30, y: 100, width: 41, height: 30 };
    const sibling: IRect = { x: 50, y: 200, width: 40, height: 30 };
    const r = computeResizeSnap(moving, 'e', [sibling], A4, TOL, MIN_SIZE);
    expect(r.snapped.x).toBe(false);
  });

  it('south handle snaps bottom to sibling top', () => {
    const moving: IRect = { x: 50, y: 50, width: 40, height: 49 };
    // moving.bottom = 99. Sibling.top = 100, distance 1.
    const sibling: IRect = { x: 50, y: 100, width: 40, height: 30 };
    const r = computeResizeSnap(moving, 's', [sibling], A4, TOL, MIN_SIZE);
    expect(r.snapped.y).toBe(true);
    expect(r.rect.y).toBe(50);
    expect(r.rect.height).toBe(50);
  });

  it('respects min width when west handle would snap past the right edge', () => {
    // Moving 40-wide, west handle, sibling.right just inside our left edge.
    const moving: IRect = { x: 50, y: 100, width: 40, height: 30 };
    // close.right = 51, moving.left = 50, distance 1 → snap.
    // newLeft = min(51, 90 - 20) = 51, width = 90 - 51 = 39.
    const close: IRect = { x: 0, y: 100, width: 51, height: 30 };
    const r = computeResizeSnap(moving, 'w', [close], A4, TOL, MIN_SIZE);
    expect(r.snapped.x).toBe(true);
    expect(r.rect.x).toBe(51);
    expect(r.rect.width).toBe(39);
  });

  it('north-east handle snaps both top and right edges', () => {
    const moving: IRect = { x: 30, y: 51, width: 39, height: 60 };
    // moving.right = 69. Sibling.left = 70, distance 1 → snap.
    // moving.top = 51. Sibling.top = 50, distance 1 → snap.
    const sibling: IRect = { x: 70, y: 50, width: 40, height: 60 };
    const r = computeResizeSnap(moving, 'ne', [sibling], A4, TOL, MIN_SIZE);
    expect(r.snapped.x).toBe(true);
    expect(r.snapped.y).toBe(true);
    expect(r.rect.x + r.rect.width).toBe(70);
    expect(r.rect.y).toBe(50);
  });
});
