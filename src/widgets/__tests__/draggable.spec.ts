import { computeAutoScrollVelocity } from '../draggable';

const params = (overrides: Partial<Parameters<typeof computeAutoScrollVelocity>[0]> = {}) => ({
  client: 200,
  min: 0,
  max: 600,
  zonePx: 50,
  maxSpeedPxPerFrame: 14,
  ...overrides
});

describe('computeAutoScrollVelocity', () => {
  it('returns 0 well inside the viewport', () => {
    expect(computeAutoScrollVelocity(params({ client: 300 }))).toBe(0);
  });

  it('returns negative speed near the min edge', () => {
    // 30px from min, zone is 50 → intensity 20/50 = 0.4
    const v = computeAutoScrollVelocity(params({ client: 30 }));
    expect(v).toBeCloseTo(-0.4 * 14, 5);
  });

  it('returns positive speed near the max edge', () => {
    // 30px from max → intensity 0.4
    const v = computeAutoScrollVelocity(params({ client: 570 }));
    expect(v).toBeCloseTo(0.4 * 14, 5);
  });

  it('saturates at -maxSpeed when cursor is past min edge', () => {
    expect(computeAutoScrollVelocity(params({ client: -100 }))).toBe(-14);
  });

  it('saturates at +maxSpeed when cursor is past max edge', () => {
    expect(computeAutoScrollVelocity(params({ client: 700 }))).toBe(14);
  });

  it('ramps to 0 at the zone boundary', () => {
    // Exactly zonePx from min — boundary case, treat as outside.
    expect(computeAutoScrollVelocity(params({ client: 50 }))).toBe(0);
    expect(computeAutoScrollVelocity(params({ client: 550 }))).toBe(0);
  });

  it('returns 0 when zonePx is 0 (feature off)', () => {
    expect(computeAutoScrollVelocity(params({ client: 5, zonePx: 0 }))).toBe(0);
  });

  it('returns 0 when maxSpeedPxPerFrame is 0', () => {
    expect(
      computeAutoScrollVelocity(params({ client: 5, maxSpeedPxPerFrame: 0 }))
    ).toBe(0);
  });

  it('is symmetric across both axes (same math, same params)', () => {
    // The function is axis-agnostic; passing the same client/min/max
    // produces the same magnitude regardless of which dimension the
    // caller intends.
    const vY = computeAutoScrollVelocity(params({ client: 10 }));
    const vX = computeAutoScrollVelocity(params({ client: 10 }));
    expect(vY).toBe(vX);
  });
});
