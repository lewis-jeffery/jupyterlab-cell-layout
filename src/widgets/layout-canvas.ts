import type { ICodeCellModel } from '@jupyterlab/cells';
import type { IEditorServices } from '@jupyterlab/codeeditor';
import type { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Widget } from '@lumino/widgets';

import { CellCoordinator, pageBoundsFor } from '../managers/cell-coordinator';
import type { ExcelBridge } from '../managers/excel-bridge';
import {
  type MetadataManager,
  type PageOrientation,
  type PageSize,
  SMART_GUIDES_TOLERANCE_MM
} from '../managers/metadata';

import {
  computeDragSnap,
  computeResizeSnap,
  type IGuideLine,
  type IPageBox,
  type IRect
} from './alignment-guides';
import type { ISnapHandler } from './draggable';
import type { ResizeHandle } from './resizable';
import { SummaryCellWidget, type SlotKey } from './summary-cell';
import { mmToPx, pxToMm } from './units';

const SNAP_MIN_SIZE = { width: 20, height: 15 };
const PAGE_BREAK_HEIGHT_PX = 12;

export class LayoutCanvas extends Widget {
  private _cells: SummaryCellWidget[] = [];
  private _groups = new Map<string, SummaryCellWidget>();
  private _page: HTMLElement;
  private _currentPageSize: PageSize = 'A4';
  private _currentOrientation: PageOrientation = 'portrait';
  private _activeCellId: string | null = null;
  // Cleanup hooks for per-cell `outputs.changed` subscriptions; refilled
  // every refresh, drained in `_clearCells` (and via clearAll on dispose).
  private _outputDisconnects: Array<() => void> = [];
  private _pendingOutputRefresh: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly coordinator: CellCoordinator,
    private readonly manager: MetadataManager,
    private readonly rendermime?: IRenderMimeRegistry,
    private readonly excelBridge?: ExcelBridge,
    private readonly editorServices?: IEditorServices,
    private readonly runCellById?: (cellId: string) => void
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
    coordinator.settingsChanged.connect(this._onSettingsChanged, this);
  }

  private _onSettingsChanged(): void {
    if (!this.isVisible) {
      return;
    }
    const layout = this.manager.read();
    this._applyPageBounds(layout.settings);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.coordinator.changed.disconnect(this._onCellsChanged, this);
    this.coordinator.settingsChanged.disconnect(this._onSettingsChanged, this);
    this._clearCells();
    super.dispose();
  }

  refresh(): void {
    this.coordinator.ensureEnoughPages();
    const layout = this.manager.read();
    this._clearCells();
    this._applyPageBounds(layout.settings);
    for (const entry of this.coordinator.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      const cellId = entry.cellModel.id;
      const widget = new SummaryCellWidget(entry.cellModel, entry.layout, {
        displayIndex: entry.index + 1,
        coordinator: this.coordinator,
        rendermime: this.rendermime,
        excelBridge: this.excelBridge,
        editorServices: this.editorServices,
        onRunCell: this.runCellById,
        onInteract: () => this.bringCellToFront(cellId),
        snapHandlerFactory: (id, slot) => this._snapHandlerFor(id, slot)
      });
      this._cells.push(widget);
      this._groups.set(cellId, widget);
      for (const w of widget.widgets()) {
        this._page.appendChild(w.node);
      }
      // Stage C reactivity: when a code cell's outputs change (typically
      // from execution), schedule a debounced canvas refresh so the
      // SummaryOutputCell mirrors the new content. Without this, hitting
      // the in-canvas Run button updates the notebook's cell but the
      // summary view stays stale until mode-toggle.
      if (entry.cellModel.type === 'code') {
        const codeModel = entry.cellModel as ICodeCellModel;
        const outputs = codeModel.outputs;
        const handler = (): void => this._scheduleOutputRefresh();
        outputs.changed.connect(handler);
        this._outputDisconnects.push(() =>
          outputs.changed.disconnect(handler)
        );
      }
    }
  }

  private _scheduleOutputRefresh(): void {
    if (!this.isVisible) {
      return;
    }
    // Debounce: streaming output emits many `changed` events per second;
    // collapsing them into one refresh per ~100 ms keeps the UI fluid.
    if (this._pendingOutputRefresh !== null) {
      clearTimeout(this._pendingOutputRefresh);
    }
    this._pendingOutputRefresh = setTimeout(() => {
      this._pendingOutputRefresh = null;
      if (!this.isVisible) {
        return;
      }
      this.refresh();
    }, 100);
  }

  private _snapHandlerFor(cellId: string, slot: SlotKey): ISnapHandler | null {
    const excludeKey = `${cellId}:${slot}`;
    const collect = (): IRect[] => this._collectSnapRects(excludeKey);
    const getPageBox = (): IPageBox => this._pageBox();
    return {
      computeDrag: (rect: IRect) =>
        computeDragSnap(
          rect,
          collect(),
          getPageBox(),
          this._snapTolerance()
        ),
      computeResize: (rect: IRect, handle: ResizeHandle) =>
        computeResizeSnap(
          rect,
          handle,
          collect(),
          getPageBox(),
          this._snapTolerance(),
          SNAP_MIN_SIZE
        ),
      showGuides: (guides: IGuideLine[]) => this._renderGuides(guides)
    };
  }

  private _snapTolerance(): number {
    return this.manager.read().settings.smart_guides
      ? SMART_GUIDES_TOLERANCE_MM
      : 0;
  }

  private _pageBox(): IPageBox {
    const settings = this.manager.read().settings;
    const bounds = pageBoundsFor(settings);
    return {
      width: bounds.width,
      height: bounds.height,
      pageCount: settings.page_count
    };
  }

  private _collectSnapRects(excludeKey: string): IRect[] {
    const rects: IRect[] = [];
    const nodes = this._page.querySelectorAll(
      '.jp-CellLayout-input, .jp-CellLayout-output'
    );
    for (const node of Array.from(nodes)) {
      const el = node as HTMLElement;
      const cellId = el.dataset.cellId ?? '';
      const slot = el.dataset.slot ?? '';
      const key = `${cellId}:${slot}`;
      if (key === excludeKey || cellId === '' || slot === '') {
        continue;
      }
      rects.push({
        x: pxToMm(el.offsetLeft),
        y: pxToMm(el.offsetTop),
        width: pxToMm(el.offsetWidth),
        height: pxToMm(el.offsetHeight)
      });
    }
    return rects;
  }

  private _renderGuides(guides: IGuideLine[]): void {
    for (const old of Array.from(
      this._page.querySelectorAll('.jp-CellLayout-snapGuide')
    )) {
      old.remove();
    }
    for (const g of guides) {
      const div = document.createElement('div');
      div.className = `jp-CellLayout-snapGuide jp-CellLayout-snapGuide-${g.axis}`;
      if (g.axis === 'x') {
        div.style.left = `${mmToPx(g.position)}px`;
        div.style.top = `${mmToPx(g.start)}px`;
        div.style.height = `${mmToPx(g.end - g.start)}px`;
      } else {
        div.style.top = `${mmToPx(g.position)}px`;
        div.style.left = `${mmToPx(g.start)}px`;
        div.style.width = `${mmToPx(g.end - g.start)}px`;
      }
      this._page.appendChild(div);
    }
  }

  /**
   * Id of the cell most recently interacted with on the canvas. Cleared on
   * `consumeActiveCellId()`. Used to carry selection from summary mode back
   * into edit mode.
   */
  get activeCellId(): string | null {
    return this._activeCellId;
  }

  consumeActiveCellId(): string | null {
    const id = this._activeCellId;
    this._activeCellId = null;
    return id;
  }

  /**
   * Resolves once every cell on the canvas has finished any in-flight
   * content fetch. Used by the PDF exporter to ensure Excel-linked cells
   * have their tables rendered before html2canvas snapshots the DOM.
   */
  async awaitReady(): Promise<void> {
    await Promise.all(this._cells.map(c => c.awaitReady()));
  }

  bringCellToFront(cellId: string): void {
    this._activeCellId = cellId;
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
    page_count: number;
  }): void {
    this._currentPageSize = settings.page_size;
    this._currentOrientation = settings.orientation;
    const bounds = pageBoundsFor({
      page_size: settings.page_size,
      orientation: settings.orientation,
      page_count: 1,
      grid_snap: 0,
      default_summary_lines: 3,
      notebook_mode: 'edit',
      smart_guides: false
    });
    const pageCount = Math.max(1, Math.floor(settings.page_count));
    const pageHeightPx = mmToPx(bounds.height);
    const widthPx = mmToPx(bounds.width);
    this._page.style.width = `${widthPx}px`;
    this._page.style.height = `${pageHeightPx * pageCount}px`;
    this._page.dataset.pageSize = settings.page_size;
    this._page.dataset.orientation = settings.orientation;
    this._page.dataset.pageCount = String(pageCount);
    this._renderPageBreaks(pageCount, widthPx, pageHeightPx);
  }

  private _renderPageBreaks(
    count: number,
    widthPx: number,
    pageHeightPx: number
  ): void {
    // Remove any old break/label nodes
    for (const el of Array.from(
      this._page.querySelectorAll('.jp-CellLayout-pageBreak, .jp-CellLayout-pageNumber')
    )) {
      el.remove();
    }
    for (let i = 0; i < count; i++) {
      const label = document.createElement('div');
      label.className = 'jp-CellLayout-pageNumber';
      label.textContent = `Page ${i + 1} of ${count}`;
      label.dataset.pageIndex = String(i);
      label.title = 'Right-click for page actions';
      // Anchor at the bottom-right of page i: 18px above the bottom edge of the page
      label.style.top = `${pageHeightPx * (i + 1) - 18}px`;
      this._page.appendChild(label);
      if (i > 0) {
        const brk = document.createElement('div');
        brk.className = 'jp-CellLayout-pageBreak';
        // Centre the gap-strip on the boundary so cells straddling the page
        // break are visually cut in half — an obvious cue to move them.
        brk.style.top = `${pageHeightPx * i - PAGE_BREAK_HEIGHT_PX / 2}px`;
        brk.style.width = `${widthPx}px`;
        brk.style.height = `${PAGE_BREAK_HEIGHT_PX}px`;
        this._page.appendChild(brk);
      }
    }
  }

  private _clearCells(): void {
    for (const disconnect of this._outputDisconnects) {
      try {
        disconnect();
      } catch {
        /* signal already gone — ignore */
      }
    }
    this._outputDisconnects = [];
    if (this._pendingOutputRefresh !== null) {
      clearTimeout(this._pendingOutputRefresh);
      this._pendingOutputRefresh = null;
    }
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
