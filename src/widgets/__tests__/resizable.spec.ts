import { computeResizedGeometry } from '../resizable';

const start = {
  position: { x: 20, y: 40 },
  size: { width: 100, height: 60 }
};
const minSize = { width: 20, height: 15 };

describe('computeResizedGeometry', () => {
  it('east handle grows width only, position unchanged', () => {
    const g = computeResizedGeometry('e', start, { x: 10, y: 0 }, minSize);
    expect(g.size.width).toBe(110);
    expect(g.size.height).toBe(60);
    expect(g.position).toEqual(start.position);
  });

  it('east handle shrinks to min width at clamp', () => {
    const g = computeResizedGeometry('e', start, { x: -500, y: 0 }, minSize);
    expect(g.size.width).toBe(minSize.width);
    expect(g.position).toEqual(start.position);
  });

  it('west handle shrinks width and moves left edge right', () => {
    const g = computeResizedGeometry('w', start, { x: 10, y: 0 }, minSize);
    expect(g.size.width).toBe(90);
    expect(g.position.x).toBe(30);
    expect(g.position.y).toBe(start.position.y);
  });

  it('west handle grows width when dragged left (negative dx)', () => {
    const g = computeResizedGeometry('w', start, { x: -10, y: 0 }, minSize);
    expect(g.size.width).toBe(110);
    expect(g.position.x).toBe(10);
  });

  it('west handle stops moving position when min width reached', () => {
    const g = computeResizedGeometry('w', start, { x: 500, y: 0 }, minSize);
    expect(g.size.width).toBe(minSize.width);
    // Left edge should have moved by (start.width - min.width) = 80
    expect(g.position.x).toBe(100);
  });

  it('south handle grows height only', () => {
    const g = computeResizedGeometry('s', start, { x: 0, y: 20 }, minSize);
    expect(g.size.height).toBe(80);
    expect(g.size.width).toBe(100);
    expect(g.position).toEqual(start.position);
  });

  it('north handle shrinks height and moves top edge down', () => {
    const g = computeResizedGeometry('n', start, { x: 0, y: 10 }, minSize);
    expect(g.size.height).toBe(50);
    expect(g.position.y).toBe(50);
  });

  it('nw corner changes width, height, x, y together', () => {
    const g = computeResizedGeometry('nw', start, { x: 5, y: 10 }, minSize);
    expect(g.size.width).toBe(95);
    expect(g.size.height).toBe(50);
    expect(g.position.x).toBe(25);
    expect(g.position.y).toBe(50);
  });

  it('ne corner grows width, shrinks height, moves top', () => {
    const g = computeResizedGeometry('ne', start, { x: 5, y: 10 }, minSize);
    expect(g.size.width).toBe(105);
    expect(g.size.height).toBe(50);
    expect(g.position.x).toBe(start.position.x);
    expect(g.position.y).toBe(50);
  });

  it('se corner grows width and height, position unchanged', () => {
    const g = computeResizedGeometry('se', start, { x: 5, y: 10 }, minSize);
    expect(g.size.width).toBe(105);
    expect(g.size.height).toBe(70);
    expect(g.position).toEqual(start.position);
  });

  it('sw corner changes width, height, x but not y', () => {
    const g = computeResizedGeometry('sw', start, { x: 5, y: 10 }, minSize);
    expect(g.size.width).toBe(95);
    expect(g.size.height).toBe(70);
    expect(g.position.x).toBe(25);
    expect(g.position.y).toBe(start.position.y);
  });

  it('clamps position x to 0 when west handle dragged far left', () => {
    // Start at x=20, width=100. Drag west handle left by 30mm.
    // Expected: width = 130, x = 20 - 30 = -10, clamped to 0.
    const g = computeResizedGeometry('w', start, { x: -30, y: 0 }, minSize);
    expect(g.position.x).toBe(0);
  });

  it('clamps position y to 0 when north handle dragged far up', () => {
    const g = computeResizedGeometry('n', start, { x: 0, y: -60 }, minSize);
    expect(g.position.y).toBe(0);
  });
});
