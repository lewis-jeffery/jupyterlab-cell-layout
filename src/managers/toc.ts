import type { CellType } from './metadata';

export interface ITocHeading {
  cellId: string;
  level: number; // 1..6
  text: string;
  pageNumber: number; // 1-based
}

export interface ITocSourceCell {
  cellId: string;
  type: CellType;
  source: string;
  yMm: number;
  xMm: number;
}

const ROW_TOLERANCE_MM = 5;
const HEADING_MAX_CHARS = 60;
const MAX_HEADING_LEVEL = 6;

/**
 * Walk every markdown cell on the canvas in PDF reading order and emit
 * one ITocHeading per ATX heading line (`# ...`, `## ...`, ...). Reading
 * order matches the PDF exporter: page bucket, then row-major by y with
 * a small y-tolerance, then x within a row.
 */
export function buildTocHeadings(
  cells: readonly ITocSourceCell[],
  pageHeightMm: number,
  pageCount: number
): ITocHeading[] {
  const sorted = [...cells].sort((a, b) => {
    const pa = pageOf(a.yMm, pageHeightMm, pageCount);
    const pb = pageOf(b.yMm, pageHeightMm, pageCount);
    if (pa !== pb) {
      return pa - pb;
    }
    const dy = a.yMm - b.yMm;
    if (Math.abs(dy) > ROW_TOLERANCE_MM) {
      return dy;
    }
    return a.xMm - b.xMm;
  });
  const headings: ITocHeading[] = [];
  for (const cell of sorted) {
    if (cell.type !== 'markdown') {
      continue;
    }
    const pageNumber = pageOf(cell.yMm, pageHeightMm, pageCount) + 1;
    let inFence = false;
    for (const raw of cell.source.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('```') || line.startsWith('~~~')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        continue;
      }
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!m) {
        continue;
      }
      const level = Math.min(MAX_HEADING_LEVEL, m[1].length);
      headings.push({
        cellId: cell.cellId,
        level,
        text: truncate(m[2]),
        pageNumber
      });
    }
  }
  return headings;
}

function pageOf(yMm: number, pageHeightMm: number, pageCount: number): number {
  if (pageHeightMm <= 0) {
    return 0;
  }
  const idx = Math.floor(yMm / pageHeightMm);
  return clamp(idx, 0, Math.max(0, pageCount - 1));
}

function truncate(s: string, max = HEADING_MAX_CHARS): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) {
    return lo;
  }
  return Math.max(lo, Math.min(hi, value));
}
