import { coerceText, mmToPt, mmToPx, pxToMm, snapToGrid } from '../units';

describe('mm ↔ px conversion', () => {
  it('converts A4 width 210 mm to 793.7 px at 96 DPI', () => {
    expect(mmToPx(210)).toBeCloseTo(793.7, 1);
  });

  it('converts 0 mm to 0 px', () => {
    expect(mmToPx(0)).toBe(0);
  });

  it('roundtrips through pxToMm', () => {
    expect(pxToMm(mmToPx(100))).toBeCloseTo(100, 5);
  });
});

describe('mm to pt', () => {
  it('converts A4 width 210 mm to 595.3 pt', () => {
    expect(mmToPt(210)).toBeCloseTo(595.3, 1);
  });
});

describe('snapToGrid', () => {
  it('returns value unchanged when snap is 0', () => {
    expect(snapToGrid(12.7, 0)).toBe(12.7);
  });

  it('returns value unchanged when snap is negative', () => {
    expect(snapToGrid(12.7, -5)).toBe(12.7);
  });

  it('snaps to nearest multiple when snap > 0', () => {
    expect(snapToGrid(12, 5)).toBe(10);
    expect(snapToGrid(13, 5)).toBe(15);
    expect(snapToGrid(12.5, 5)).toBe(15);
    expect(snapToGrid(0, 5)).toBe(0);
    expect(snapToGrid(27.3, 10)).toBe(30);
  });

  it('snaps negative values correctly', () => {
    expect(snapToGrid(-7, 5)).toBe(-5);
    expect(snapToGrid(-8, 5)).toBe(-10);
  });
});

describe('coerceText', () => {
  it('returns string as-is', () => {
    expect(coerceText('hello')).toBe('hello');
  });

  it('joins string arrays', () => {
    expect(coerceText(['line1\n', 'line2\n'])).toBe('line1\nline2\n');
  });

  it('returns empty string for null/undefined', () => {
    expect(coerceText(null)).toBe('');
    expect(coerceText(undefined)).toBe('');
  });

  it('coerces numbers via String()', () => {
    expect(coerceText(42)).toBe('42');
  });
});
