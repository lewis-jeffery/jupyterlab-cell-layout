import { Widget } from '@lumino/widgets';

import { CellCoordinator, pageBoundsFor } from '../managers/cell-coordinator';
import {
  type MetadataManager,
  type PageOrientation,
  type PageSize
} from '../managers/metadata';

import { SummaryCellWidget } from './summary-cell';
import { mmToPx } from './units';

export class LayoutCanvas extends Widget {
  private _cells: SummaryCellWidget[] = [];
  private _groups = new Map<string, SummaryCellWidget>();
  private _page: HTMLElement;
  private _currentPageSize: PageSize = 'A4';
  private _currentOrientation: PageOrientation = 'portrait';

  constructor(
    private readonly coordinator: CellCoordinator,
    private readonly manager: MetadataManager
  ) {
    super();
    this.addClass('jp-CellLayout-root');
    this.node.style.overflow = 'auto';
    this.node.style.padding = '16px';
    this.node.style.boxSizing = 'border-box';

    this._page = document.createElement('div');
    this._page.className = 'jp-CellLayout-page';
    this._page.style.position = 'relative';
    this._page.style.margin = '0 auto';
    this._page.style.background = 'white';
    this._page.style.boxShadow = '0 0 6px rgba(0, 0, 0, 0.2)';
    this._page.style.border = '1px solid #ccc';
    this.node.appendChild(this._page);

    coordinator.changed.connect(this._onCellsChanged, this);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.coordinator.changed.disconnect(this._onCellsChanged, this);
    this._clearCells();
    super.dispose();
  }

  refresh(): void {
    const layout = this.manager.read();
    this._applyPageBounds(layout.settings);
    this._clearCells();
    for (const entry of this.coordinator.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      const cellId = entry.cellModel.id;
      const widget = new SummaryCellWidget(
        entry.cellModel,
        entry.layout,
        this.coordinator,
        () => this.bringCellToFront(cellId)
      );
      this._cells.push(widget);
      this._groups.set(cellId, widget);
      for (const w of widget.widgets()) {
        this._page.appendChild(w.node);
      }
    }
  }

  bringCellToFront(cellId: string): void {
    const group = this._groups.get(cellId);
    if (!group) {
      return;
    }
    let maxOthers = 0;
    for (const [id, g] of this._groups.entries()) {
      if (id === cellId) {
        continue;
      }
      maxOthers = Math.max(maxOthers, g.zIndex);
    }
    if (group.zIndex > maxOthers) {
      return;
    }
    const nextZ = maxOthers + 1;
    group.setZIndex(nextZ);
    this.coordinator.setCellZIndex(cellId, nextZ);
  }

  private _applyPageBounds(settings: {
    page_size: PageSize;
    orientation: PageOrientation;
  }): void {
    this._currentPageSize = settings.page_size;
    this._currentOrientation = settings.orientation;
    const bounds = pageBoundsFor({
      page_size: settings.page_size,
      orientation: settings.orientation,
      grid_snap: 0,
      default_summary_lines: 3,
      notebook_mode: 'edit'
    });
    this._page.style.width = `${mmToPx(bounds.width)}px`;
    this._page.style.height = `${mmToPx(bounds.height)}px`;
    this._page.dataset.pageSize = settings.page_size;
    this._page.dataset.orientation = settings.orientation;
  }

  private _clearCells(): void {
    for (const cell of this._cells) {
      cell.dispose();
    }
    this._cells = [];
    this._groups.clear();
    this._page.replaceChildren();
  }

  private _onCellsChanged(): void {
    if (this.isVisible) {
      this.refresh();
    }
  }

  get currentPageSize(): PageSize {
    return this._currentPageSize;
  }

  get currentOrientation(): PageOrientation {
    return this._currentOrientation;
  }
}
