import {
  buildTocHeadings,
  type ITocHeading,
  type ITocSourceCell
} from '../managers/toc';

export { buildTocHeadings };
export type { ITocHeading, ITocSourceCell };

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
