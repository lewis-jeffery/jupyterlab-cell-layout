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
  // Group-drag link state: when set to a cellId, dragging any of its slots
  // moves all slots together. Set on double-click; cleared by Esc, single
  // click on a different cell, or click on empty page.
  private _linkedCellId: string | null = null;
  // Cleanup hooks for per-cell `outputs.changed` subscriptions; refilled
  // every refresh, drained in `_clearCells` (and via clearAll on dispose).
  private _outputDisconnects: Array<() => void> = [];
  private _pendingOutputRefresh: ReturnType<typeof setTimeout> | null = null;
  // Cells the canvas has rendered at least once. Any cellId that's missing
  // from this set when refresh runs is "newly added" and gets lifted to
  // the top of the z-order so it's visible if it lands at a default
  // position that overlaps an existing cell.
  private _knownCellIds = new Set<string>();
  private _hoverLinkDispose: (() => void) | null = null;
  private _newCellDismissDispose: (() => void) | null = null;
  private _pinDispose: (() => void) | null = null;
  private _gotoDispose: (() => void) | null = null;

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

    // Prime the known-cells set so existing cells aren't all flagged as
    // "new" on the first refresh (which would lift every cell to the
    // top, scrambling the user's z-order).
    for (const entry of this.coordinator.list()) {
      if (entry.layout.mode === 'summary') {
        this._knownCellIds.add(entry.cellModel.id);
      }
    }
    this._wireHoverLinking();
    this._wireNewCellDismiss();
    this._wirePinHandling();
    this._wireGotoButton();
  }

  /**
   * Delegated listeners on the page so hovering any cell slot temporarily
   * outlines all slots that share its cellId — making it easy to find a
   * code cell's outputs (or vice versa) when they're spread across the
   * canvas. Outline class is added in mouseover and removed in mouseout
   * (skipping leave events that move into a sibling slot of the same
   * group, so the highlight is stable while you traverse the group).
   */
  private _wireHoverLinking(): void {
    const SLOT = '.jp-CellLayout-input, .jp-CellLayout-output';
    const HIGHLIGHT = 'jp-CellLayout-cellGroupHover';
    const slotOf = (el: EventTarget | null): HTMLElement | null => {
      const t = el as HTMLElement | null;
      return t?.closest?.(SLOT) as HTMLElement | null;
    };
    const setHighlight = (cellId: string, on: boolean): void => {
      const matching = this._page.querySelectorAll(
        `[data-cell-id="${cellId}"]`
      );
      matching.forEach(el => el.classList.toggle(HIGHLIGHT, on));
    };
    const onOver = (e: Event): void => {
      const slot = slotOf(e.target);
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (cellId) {
        setHighlight(cellId, true);
      }
    };
    const onOut = (e: Event): void => {
      const slot = slotOf(e.target);
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (!cellId) {
        return;
      }
      // Don't drop the highlight if the cursor is moving into a sibling
      // slot of the same cell group — keep the outline stable until the
      // mouse actually leaves the group.
      const related = (e as MouseEvent).relatedTarget as Element | null;
      const intoSameGroup = related?.closest?.(
        `[data-cell-id="${cellId}"]`
      );
      if (intoSameGroup) {
        return;
      }
      setHighlight(cellId, false);
    };
    this._page.addEventListener('mouseover', onOver);
    this._page.addEventListener('mouseout', onOut);
    this._hoverLinkDispose = () => {
      this._page.removeEventListener('mouseover', onOver);
      this._page.removeEventListener('mouseout', onOut);
    };
  }

  /**
   * Persistent highlight on the active cell's group. Survives scrolling
   * and other on-canvas activity — useful when input and output slots
   * are on different pages and the transient hover-link can't follow.
   *
   * Pin moves with `_activeCellId` (which `bringCellToFront` updates on
   * every interact). Two ways to clear: pressing Escape inside the
   * canvas, or clicking on an empty area of the page.
   */
  private _wirePinHandling(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        let changed = false;
        if (this._linkedCellId) {
          this._linkedCellId = null;
          changed = true;
        }
        if (this._activeCellId) {
          this._activeCellId = null;
          changed = true;
        }
        if (changed) {
          this._updatePinHighlight();
        }
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!this._activeCellId && !this._linkedCellId) {
        return;
      }
      const target = e.target as HTMLElement | null;
      // Click landed on a slot — interact will set a new pin (and may
      // clear the link below if it's a different cell).
      if (target?.closest?.('.jp-CellLayout-input, .jp-CellLayout-output')) {
        return;
      }
      // Click on empty page area — drop both pin and link.
      this._activeCellId = null;
      this._linkedCellId = null;
      this._updatePinHighlight();
    };
    const onDblClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const slot = target?.closest?.(
        '.jp-CellLayout-input, .jp-CellLayout-output'
      ) as HTMLElement | null;
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (!cellId) {
        return;
      }
      // Toggle: double-clicking a cell that's already linked clears it.
      this._linkedCellId =
        this._linkedCellId === cellId ? null : cellId;
      this._updatePinHighlight();
    };
    this.node.addEventListener('keydown', onKeyDown);
    this._page.addEventListener('pointerdown', onPointerDown);
    this._page.addEventListener('dblclick', onDblClick);
    this._pinDispose = () => {
      this.node.removeEventListener('keydown', onKeyDown);
      this._page.removeEventListener('pointerdown', onPointerDown);
      this._page.removeEventListener('dblclick', onDblClick);
    };
  }

  /** Returns true if `cellId` is the currently group-linked cell. Used by
   *  per-slot drag wiring to decide whether to attach sibling nodes. */
  isCellLinked(cellId: string): boolean {
    return this._linkedCellId === cellId;
  }

  /**
   * Delegated click handler for the per-slot "go-to next related" buttons.
   * The button is only visible (per CSS) when its slot is pinned, so a
   * click on it always means "scroll to the next slot of the same cell"
   * — useful when input and outputs are pages apart and pin alone tells
   * the user *that* a slot exists elsewhere but not *where*. Cycles in
   * DOM order (input → output_a → output_b → input → …).
   */
  private _wireGotoButton(): void {
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest?.(
        '.jp-CellLayout-gotoButton'
      ) as HTMLElement | null;
      if (!btn) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const slot = btn.closest('[data-cell-id]') as HTMLElement | null;
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (!cellId) {
        return;
      }
      const related = Array.from(
        this._page.querySelectorAll(`[data-cell-id="${cellId}"]`)
      ) as HTMLElement[];
      if (related.length <= 1) {
        return;
      }
      const idx = related.indexOf(slot);
      const next = related[(idx + 1) % related.length];
      next.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    this._page.addEventListener('click', onClick);
    this._gotoDispose = () => {
      this._page.removeEventListener('click', onClick);
    };
  }

  private _updatePinHighlight(): void {
    const PIN = 'jp-CellLayout-cellGroupPinned';
    const LINK = 'jp-CellLayout-cellGroupLinked';
    this._page
      .querySelectorAll(`.${PIN}, .${LINK}`)
      .forEach(el => el.classList.remove(PIN, LINK));
    if (this._activeCellId) {
      this._page
        .querySelectorAll(`[data-cell-id="${this._activeCellId}"]`)
        .forEach(el => el.classList.add(PIN));
    }
    if (this._linkedCellId) {
      this._page
        .querySelectorAll(`[data-cell-id="${this._linkedCellId}"]`)
        .forEach(el => el.classList.add(LINK));
    }
  }

  /**
   * Drop the "newly added" highlight from a cell as soon as the user
   * interacts with it — pointerdown anywhere on the cell (drag, resize,
   * click) or keydown inside its editor (typing). Capture phase so we
   * see the event before any inner widget can stopPropagation.
   */
  private _wireNewCellDismiss(): void {
    const dismiss = (e: Event): void => {
      const target = e.target as HTMLElement | null;
      const slot = target?.closest?.(
        '.jp-CellLayout-newCell'
      ) as HTMLElement | null;
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (cellId) {
        this._dismissNewCellHighlight(cellId);
      }
    };
    this._page.addEventListener('pointerdown', dismiss, { capture: true });
    this._page.addEventListener('keydown', dismiss, { capture: true });
    this._newCellDismissDispose = () => {
      this._page.removeEventListener('pointerdown', dismiss, {
        capture: true
      });
      this._page.removeEventListener('keydown', dismiss, { capture: true });
    };
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
    this._hoverLinkDispose?.();
    this._hoverLinkDispose = null;
    this._newCellDismissDispose?.();
    this._newCellDismissDispose = null;
    this._pinDispose?.();
    this._pinDispose = null;
    this._gotoDispose?.();
    this._gotoDispose = null;
    this._clearCells();
    super.dispose();
  }

  refresh(): void {
    this.coordinator.ensureEnoughPages();
    const layout = this.manager.read();
    this._clearCells();
    this._applyPageBounds(layout.settings);
    const newlyAdded: string[] = [];
    for (const entry of this.coordinator.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      const cellId = entry.cellModel.id;
      if (!this._knownCellIds.has(cellId)) {
        newlyAdded.push(cellId);
        this._knownCellIds.add(cellId);
      }
      const widget = new SummaryCellWidget(entry.cellModel, entry.layout, {
        displayIndex: entry.index + 1,
        coordinator: this.coordinator,
        rendermime: this.rendermime,
        excelBridge: this.excelBridge,
        editorServices: this.editorServices,
        onRunCell: this.runCellById,
        onInteract: () => this.bringCellToFront(cellId),
        snapHandlerFactory: (id, slot) => this._snapHandlerFor(id, slot),
        isCellLinked: id => this.isCellLinked(id)
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
    // Lift any newly-added cell to the top of the z-order so it's visible
    // even if its default-layout position lands under an existing cell,
    // and apply a "new cell" highlight class to its slots so the user can
    // spot it on a busy canvas. The highlight is dismissed on the next
    // interaction with that cell (drag, resize, click, type) — see
    // `_wireNewCellDismiss`.
    for (const cellId of newlyAdded) {
      this.bringCellToFront(cellId);
      const matching = this._page.querySelectorAll(
        `[data-cell-id="${cellId}"]`
      );
      matching.forEach(el => el.classList.add('jp-CellLayout-newCell'));
    }
    // Re-apply the pinned-cell highlight after the DOM is rebuilt — the
    // active cell id survives refresh, but its slot nodes were just
    // recreated and lost the class.
    this._updatePinHighlight();
  }

  private _dismissNewCellHighlight(cellId: string): void {
    const matching = this._page.querySelectorAll(
      `[data-cell-id="${cellId}"]`
    );
    matching.forEach(el => el.classList.remove('jp-CellLayout-newCell'));
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
    // When a cell is linked for group drag every sibling moves with the
    // primary; if we left them in the snap-target set, snap distances
    // would be locked at drag start (siblings move with primary so the
    // distance never changes) and would either fire instantly or never.
    // Exclude the whole cellId in that case.
    const collect = (): IRect[] =>
      this.isCellLinked(cellId)
        ? this._collectSnapRects(excludeKey, cellId)
        : this._collectSnapRects(excludeKey);
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

  private _collectSnapRects(
    excludeKey: string,
    excludeCellId?: string
  ): IRect[] {
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
      if (excludeCellId && cellId === excludeCellId) {
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
    // Single-click on a different cell drops any group-link from the
    // previous cell — link must be re-established with another double
    // click on the new cell if the user wants group drag there.
    if (this._linkedCellId && this._linkedCellId !== cellId) {
      this._linkedCellId = null;
    }
    this._activeCellId = cellId;
    this._updatePinHighlight();
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
