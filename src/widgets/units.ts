export const MM_PER_INCH = 25.4;
export const CSS_DPI = 96;

export function mmToPx(mm: number): number {
  return (mm * CSS_DPI) / MM_PER_INCH;
}

export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_DPI;
}

export function mmToPt(mm: number): number {
  return (mm * 72) / MM_PER_INCH;
}

export function snapToGrid(v: number, snapMm: number): number {
  if (!Number.isFinite(snapMm) || snapMm <= 0) {
    return v;
  }
  return Math.round(v / snapMm) * snapMm;
}

export function coerceText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join('');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}
