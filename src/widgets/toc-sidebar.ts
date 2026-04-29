import type { CellType } from '../managers/metadata';

export interface ITocHeading {
  cellId: string;
  level: number;        // 1..6 (clamped from any number of leading '#')
  text: string;
  pageNumber: number;   // 1-based, for the right-aligned hint
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
 *
 * Setext-style headings (`Title\n=====`) are not recognised; if they show
 * up in real notebooks I'll add them — most engineering notebooks use
 * the ATX style.
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
      // Skip headings inside fenced code blocks.
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

/**
 * Lightweight DOM-only ToC sidebar. Mounted into the LayoutCanvas's root
 * node when summary mode + showToc setting are both on. Lists one entry
 * per markdown heading found across summary-mode cells; clicking an entry
 * scrolls the cell containing that heading into view.
 */
export class TocSidebar {
  readonly node: HTMLElement;
  private readonly _list: HTMLUListElement;
  private readonly _empty: HTMLElement;
  private _onNavigate: ((cellId: string) => void) | null = null;

  constructor() {
    this.node = document.createElement('div');
    this.node.className = 'jp-CellLayout-toc';

    const header = document.createElement('div');
    header.className = 'jp-CellLayout-tocHeader';
    header.textContent = 'Contents';
    this.node.appendChild(header);

    this._list = document.createElement('ul');
    this._list.className = 'jp-CellLayout-tocList';
    this.node.appendChild(this._list);

    this._empty = document.createElement('div');
    this._empty.className = 'jp-CellLayout-tocEmpty';
    this._empty.textContent =
      'No headings on the canvas. Add a markdown cell with "# Title" to populate this list.';
    this._empty.style.display = 'none';
    this.node.appendChild(this._empty);

    this._list.addEventListener('click', e => {
      const target = (e.target as HTMLElement | null)?.closest?.(
        '[data-cell-id]'
      ) as HTMLElement | null;
      if (!target) {
        return;
      }
      const cellId = target.dataset.cellId ?? '';
      if (cellId) {
        this._onNavigate?.(cellId);
      }
    });
    this._list.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }
      const target = (e.target as HTMLElement | null)?.closest?.(
        '[data-cell-id]'
      ) as HTMLElement | null;
      if (!target) {
        return;
      }
      e.preventDefault();
      const cellId = target.dataset.cellId ?? '';
      if (cellId) {
        this._onNavigate?.(cellId);
      }
    });
  }

  setOnNavigate(fn: (cellId: string) => void): void {
    this._onNavigate = fn;
  }

  setEntries(entries: readonly ITocHeading[]): void {
    this._list.replaceChildren();
    if (entries.length === 0) {
      this._list.style.display = 'none';
      this._empty.style.display = '';
      return;
    }
    this._list.style.display = '';
    this._empty.style.display = 'none';
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = `jp-CellLayout-tocItem jp-CellLayout-tocItem-l${entry.level}`;
      li.dataset.cellId = entry.cellId;
      li.dataset.level = String(entry.level);
      li.tabIndex = 0;
      li.title = `${entry.text} — Page ${entry.pageNumber}`;

      const text = document.createElement('span');
      text.className = 'jp-CellLayout-tocHeading';
      text.textContent = entry.text;
      li.appendChild(text);

      const num = document.createElement('span');
      num.className = 'jp-CellLayout-tocPage';
      num.textContent = `${entry.pageNumber}`;
      li.appendChild(num);

      this._list.appendChild(li);
    }
  }

  setActiveCell(cellId: string | null): void {
    const items = this._list.querySelectorAll('.jp-CellLayout-tocItem');
    items.forEach(el => {
      const id = (el as HTMLElement).dataset.cellId ?? '';
      el.classList.toggle(
        'jp-CellLayout-tocItemActive',
        cellId !== null && id === cellId
      );
    });
  }
}
