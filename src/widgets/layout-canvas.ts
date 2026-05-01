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
import {
  buildTocHeadings,
  TocSidebar,
  type ITocSourceCell
} from './toc-sidebar';
import { coerceText, mmToPx, pxToMm } from './units';

const SNAP_MIN_SIZE = { width: 20, height: 15 };
const PAGE_BREAK_HEIGHT_PX = 12;
const MARQUEE_DRAG_THRESHOLD_PX = 3;

export class LayoutCanvas extends Widget {
  private _cells: SummaryCellWidget[] = [];
  private _groups = new Map<string, SummaryCellWidget>();
  private _page: HTMLElement;
  private _toc: TocSidebar;
  private _tocVisible = false;
  private _currentPageSize: PageSize = 'A4';
  private _currentOrientation: PageOrientation = 'portrait';
  // The current multi-cell selection. Single-cell selection looks
  // identical to the old "pin" highlight; shift-click adds/removes;
  // marquee + bulk ops are layered on top in later P1 iterations.
  private _selection = new Set<string>();
  // Most recently clicked cell — survives selection changes and is
  // consumed by the mode-switch carryover (`consumeActiveCellId`).
  private _lastTouchedCellId: string | null = null;
  // Group-drag link state: when set to a cellId, dragging any of its slots
  // moves all slots together. Set on double-click; cleared by Esc, single
  // click on a different cell, or click on empty page.
  private _linkedCellId: string | null = null;
  // Cleanup hooks for per-cell signal subscriptions (output changes for code
  // cells, sharedModel.changed for markdown cells so the ToC re-derives
  // headings as the user edits). Refilled every refresh, drained in
  // `_clearCells` (and via clearAll on dispose).
  private _outputDisconnects: Array<() => void> = [];
  private _pendingOutputRefresh: ReturnType<typeof setTimeout> | null = null;
  private _pendingTocRefresh: ReturnType<typeof setTimeout> | null = null;
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
    private readonly runCellById?: (cellId: string) => void,
    private readonly onInclusionChanged?: () => void
  ) {
    super();
    this.addClass('jp-CellLayout-root');
    this.node.style.overflow = 'auto';
    this.node.style.padding = '16px';
    this.node.style.boxSizing = 'border-box';

    this._toc = new TocSidebar();
    this._toc.setOnNavigate(cellId => this.scrollToCell(cellId));
    // Mounted/unmounted in `setTocVisible`; not in the DOM by default.

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
    coordinator.layoutChanged.connect(this._onLayoutChanged, this);

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
   * Selection + link handling. Selection is a Set<cellId>; click replaces
   * selection with one cell; shift-click toggles. Selection drives the
   * "pinned" outline (single-cell selection looks identical to the old
   * F5 pin). Link (F7) stays a parallel one-cell quick-group concept,
   * toggled with double-click.
   *
   * Two pointerdown listeners cooperate:
   *  - Capture-phase on `_page` runs before the per-slot drag handler
   *    (which is also capture-phase on the slot itself but at a lower
   *    DOM level). Updates selection on slot clicks. Shift-click also
   *    suppresses drag init by stopping propagation, so shift-click is
   *    a pure selection toggle.
   *  - Bubble-phase clears selection + link when the click lands on an
   *    empty area of the page.
   */
  private _wirePinHandling(): void {
    const SLOT = '.jp-CellLayout-input, .jp-CellLayout-output';
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        let changed = false;
        if (this._linkedCellId) {
          this._linkedCellId = null;
          changed = true;
        }
        if (this._selection.size > 0) {
          this._selection.clear();
          this._lastTouchedCellId = null;
          changed = true;
        }
        if (changed) {
          this._updatePinHighlight();
        }
        return;
      }
      // The bulk-op shortcuts only act when the canvas has at least one
      // cell selected. They never fire from inside a focused editor —
      // CodeMirror consumes Delete / Backspace and the bracket keys
      // for its own editing, so the canvas's bubble-phase listener only
      // sees them when focus is on the canvas itself.
      if (this._selection.size === 0) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this._deleteSelectionFromCanvas();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        this._bringSelectionToFront();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        this._sendSelectionToBack();
        return;
      }
    };
    const onCapturePointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const slot = target?.closest?.(SLOT) as HTMLElement | null;
      if (!slot) {
        return;
      }
      const cellId = slot.dataset.cellId;
      if (!cellId) {
        return;
      }
      this._lastTouchedCellId = cellId;
      if (e.shiftKey) {
        // Shift-click: toggle membership; do not start a drag. The slot's
        // own drag handler runs after this in the same capture phase, so
        // we have to stop propagation to suppress it.
        if (this._selection.has(cellId)) {
          this._selection.delete(cellId);
        } else {
          this._selection.add(cellId);
        }
        this._updatePinHighlight();
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      // Plain click — replace selection, but only when the click is on a
      // cell not already in the selection. Clicking inside an existing
      // selected cell preserves the multi-cell group so the user can
      // drag the whole group from any of its members (drag wiring
      // arrives in a later step; for now this just keeps the highlight
      // intact while the drag handler initiates a single-slot move).
      if (!this._selection.has(cellId)) {
        this._selection.clear();
        this._selection.add(cellId);
        this._updatePinHighlight();
      }
    };
    // Marquee state. Tracks a potential drag-select that starts on an
    // empty area of the page. Lazy: nothing materialises in the DOM until
    // the user actually moves the cursor past `MARQUEE_DRAG_THRESHOLD_PX`,
    // so a plain click on empty area still works as "clear selection".
    let marqueeActive = false;
    let marqueeMaterialised = false;
    let marqueeAdditive = false;
    let marqueeStartX = 0;
    let marqueeStartY = 0;
    let marqueePointerId: number | null = null;
    let marqueeEl: HTMLElement | null = null;

    const removeMarqueeEl = (): void => {
      marqueeEl?.remove();
      marqueeEl = null;
    };

    const updateMarqueeRect = (clientX: number, clientY: number): {
      leftPx: number;
      topPx: number;
      widthPx: number;
      heightPx: number;
    } => {
      const pageRect = this._page.getBoundingClientRect();
      const x1 = marqueeStartX - pageRect.left;
      const y1 = marqueeStartY - pageRect.top;
      const x2 = clientX - pageRect.left;
      const y2 = clientY - pageRect.top;
      const leftPx = Math.min(x1, x2);
      const topPx = Math.min(y1, y2);
      const widthPx = Math.abs(x2 - x1);
      const heightPx = Math.abs(y2 - y1);
      if (marqueeEl) {
        marqueeEl.style.left = `${leftPx}px`;
        marqueeEl.style.top = `${topPx}px`;
        marqueeEl.style.width = `${widthPx}px`;
        marqueeEl.style.height = `${heightPx}px`;
      }
      return { leftPx, topPx, widthPx, heightPx };
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!marqueeActive || e.pointerId !== marqueePointerId) {
        return;
      }
      const dx = e.clientX - marqueeStartX;
      const dy = e.clientY - marqueeStartY;
      if (
        !marqueeMaterialised &&
        Math.hypot(dx, dy) < MARQUEE_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      if (!marqueeMaterialised) {
        marqueeMaterialised = true;
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'jp-CellLayout-marquee';
        this._page.appendChild(marqueeEl);
      }
      updateMarqueeRect(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!marqueeActive || e.pointerId !== marqueePointerId) {
        return;
      }
      const wasMaterialised = marqueeMaterialised;
      const additive = marqueeAdditive;
      const finalRect = wasMaterialised
        ? updateMarqueeRect(e.clientX, e.clientY)
        : null;
      // Reset state up front so any selection-side effects below see a
      // clean slate.
      marqueeActive = false;
      marqueeMaterialised = false;
      marqueeAdditive = false;
      marqueePointerId = null;
      removeMarqueeEl();
      try {
        this._page.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasMaterialised && finalRect) {
        const hits = this._collectCellsInRect(finalRect);
        if (additive) {
          for (const id of hits) {
            this._selection.add(id);
          }
        } else {
          this._selection.clear();
          for (const id of hits) {
            this._selection.add(id);
          }
        }
        if (hits.length > 0) {
          this._lastTouchedCellId = hits[hits.length - 1];
        }
        this._updatePinHighlight();
        return;
      }
      // No movement → treat as a click on empty: clear selection (and
      // link) unless shift was held (shift-empty-click is a no-op).
      if (!additive) {
        if (this._selection.size > 0 || this._linkedCellId) {
          this._selection.clear();
          this._linkedCellId = null;
          this._lastTouchedCellId = null;
          this._updatePinHighlight();
        }
      }
    };

    const onBubblePointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) {
        return;
      }
      const target = e.target as HTMLElement | null;
      // Click landed on a slot — selection was handled in the
      // capture-phase listener above and the slot's own drag handler
      // takes over. Marquee only triggers on empty-canvas drags.
      if (target?.closest?.(SLOT)) {
        return;
      }
      // Empty area — start a potential marquee. Material doesn't appear
      // until the user moves past the threshold; a static click resolves
      // as "clear selection" in onPointerUp.
      marqueeActive = true;
      marqueeMaterialised = false;
      marqueeAdditive = e.shiftKey;
      marqueeStartX = e.clientX;
      marqueeStartY = e.clientY;
      marqueePointerId = e.pointerId;
      try {
        this._page.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onDblClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const slot = target?.closest?.(SLOT) as HTMLElement | null;
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
    this._page.addEventListener('pointerdown', onCapturePointerDown, {
      capture: true
    });
    this._page.addEventListener('pointerdown', onBubblePointerDown);
    this._page.addEventListener('pointermove', onPointerMove);
    this._page.addEventListener('pointerup', onPointerUp);
    this._page.addEventListener('pointercancel', onPointerUp);
    this._page.addEventListener('dblclick', onDblClick);
    this._pinDispose = () => {
      this.node.removeEventListener('keydown', onKeyDown);
      this._page.removeEventListener('pointerdown', onCapturePointerDown, {
        capture: true
      });
      this._page.removeEventListener('pointerdown', onBubblePointerDown);
      this._page.removeEventListener('pointermove', onPointerMove);
      this._page.removeEventListener('pointerup', onPointerUp);
      this._page.removeEventListener('pointercancel', onPointerUp);
      this._page.removeEventListener('dblclick', onDblClick);
      removeMarqueeEl();
    };
  }

  /**
   * Hit-test cells against a marquee rect (in `_page`-relative px).
   * A cell is selected if any of its slots' bounding box overlaps the
   * marquee. Returns cellIds in DOM order, deduplicated.
   */
  private _collectCellsInRect(rect: {
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
  }): string[] {
    const right = rect.leftPx + rect.widthPx;
    const bottom = rect.topPx + rect.heightPx;
    const seen = new Set<string>();
    const result: string[] = [];
    const slots = this._page.querySelectorAll<HTMLElement>(
      '.jp-CellLayout-input, .jp-CellLayout-output'
    );
    for (const slot of Array.from(slots)) {
      const cellId = slot.dataset.cellId ?? '';
      if (!cellId || seen.has(cellId)) {
        continue;
      }
      const left = slot.offsetLeft;
      const top = slot.offsetTop;
      const slotRight = left + slot.offsetWidth;
      const slotBottom = top + slot.offsetHeight;
      const overlaps =
        slotRight >= rect.leftPx &&
        left <= right &&
        slotBottom >= rect.topPx &&
        top <= bottom;
      if (overlaps) {
        seen.add(cellId);
        result.push(cellId);
      }
    }
    return result;
  }

  /** Returns true if `cellId` is the currently group-linked cell. Used by
   *  per-slot drag wiring to decide whether to attach sibling nodes. */
  isCellLinked(cellId: string): boolean {
    return this._linkedCellId === cellId;
  }

  /** True when the cell is in the selection AND the selection contains
   *  more than one cell. Selection-of-1 doesn't group-drag (preserves
   *  the old pin behaviour); only multi-cell selection does. */
  private _isInMultiSelection(cellId: string): boolean {
    return this._selection.size > 1 && this._selection.has(cellId);
  }

  /**
   * Remove every selected cell from the summary canvas (toggle mode →
   * 'edit'). Refreshes the canvas once after all toggles so the user
   * sees a single rebuild rather than N intermediate states.
   */
  private _deleteSelectionFromCanvas(): void {
    if (this._selection.size === 0) {
      return;
    }
    const ids = Array.from(this._selection);
    for (const id of ids) {
      this.coordinator.toggleCellInclusion(id);
    }
    this._selection.clear();
    this._lastTouchedCellId = null;
    this.refresh();
    // Sync the edit-mode eye-toggle affordances so they reflect the new
    // included/excluded state when the user switches modes next.
    this.onInclusionChanged?.();
  }

  /**
   * Bring every selected cell above all non-selected cells, preserving
   * the relative z-order within the selection.
   */
  private _bringSelectionToFront(): void {
    const selected = this._sortedSelectionByZ();
    if (selected.length === 0) {
      return;
    }
    let maxOther = 0;
    for (const [id, group] of this._groups.entries()) {
      if (this._selection.has(id)) {
        continue;
      }
      maxOther = Math.max(maxOther, group.zIndex);
    }
    for (let i = 0; i < selected.length; i++) {
      const { id, group } = selected[i];
      const z = maxOther + i + 1;
      group.setZIndex(z);
      this.coordinator.setCellZIndex(id, z);
    }
  }

  /**
   * Send every selected cell below all non-selected cells, preserving
   * the relative z-order within the selection. Re-bases all z-indexes
   * to start at 1 so we don't accumulate ever-decreasing values across
   * repeated invocations.
   */
  private _sendSelectionToBack(): void {
    const selected = this._sortedSelectionByZ();
    if (selected.length === 0) {
      return;
    }
    const others: Array<{ id: string; group: SummaryCellWidget }> = [];
    for (const [id, group] of this._groups.entries()) {
      if (this._selection.has(id)) {
        continue;
      }
      others.push({ id, group });
    }
    others.sort((a, b) => a.group.zIndex - b.group.zIndex);
    let z = 1;
    // Selected cells first (back of stack), in their relative order.
    for (const { id, group } of selected) {
      group.setZIndex(z);
      this.coordinator.setCellZIndex(id, z);
      z++;
    }
    for (const { id, group } of others) {
      group.setZIndex(z);
      this.coordinator.setCellZIndex(id, z);
      z++;
    }
  }

  /**
   * Selection sorted by current z-index (lowest first). Cells whose
   * widget isn't currently mounted are dropped silently — selection
   * may include ids no longer on the canvas if a refresh races with
   * a key event.
   */
  private _sortedSelectionByZ(): Array<{
    id: string;
    group: SummaryCellWidget;
  }> {
    const selected: Array<{ id: string; group: SummaryCellWidget }> = [];
    for (const id of this._selection) {
      const group = this._groups.get(id);
      if (group) {
        selected.push({ id, group });
      }
    }
    selected.sort((a, b) => a.group.zIndex - b.group.zIndex);
    return selected;
  }

  /**
   * Collect drag siblings for every slot of every OTHER cell in the
   * multi-cell selection. Used by `SummaryCellWidget` when one of its
   * slots is being dragged — those nodes follow the primary by the
   * same delta and persist their final positions on pointerup.
   */
  private _collectMultiSelectionSiblings(
    excludeCellId: string
  ): import('./draggable').IDragSibling[] {
    const siblings: import('./draggable').IDragSibling[] = [];
    for (const cellId of this._selection) {
      if (cellId === excludeCellId) {
        continue;
      }
      const group = this._groups.get(cellId);
      if (!group) {
        continue;
      }
      for (const sibling of group.collectDragSiblings()) {
        siblings.push(sibling);
      }
    }
    return siblings;
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
    for (const cellId of this._selection) {
      this._page
        .querySelectorAll(`[data-cell-id="${cellId}"]`)
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
    this.coordinator.layoutChanged.disconnect(this._onLayoutChanged, this);
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

  /**
   * Show or hide the ToC sidebar. Called by the toolbar / settings handler
   * in index.ts. Visibility is independent of summary-mode visibility so a
   * notebook switching modes keeps the user's preference.
   */
  setTocVisible(visible: boolean): void {
    if (this._tocVisible === visible) {
      return;
    }
    this._tocVisible = visible;
    if (visible) {
      // Insert as the first child so the canvas's page (with margin: 0 auto)
      // still reads as the main content.
      this.node.insertBefore(this._toc.node, this.node.firstChild);
      this._refreshToc();
    } else {
      this._toc.node.remove();
    }
  }

  /**
   * Scroll the canvas so the given cell's input slot is near the top of
   * the viewport. Used by the ToC sidebar — clicking a heading entry
   * navigates to the cell that contains the heading. Falls back to a
   * no-op if the cell isn't on the current canvas.
   */
  scrollToCell(cellId: string): void {
    const slot = this._page.querySelector(
      `.jp-CellLayout-input[data-cell-id="${cellId}"]`
    ) as HTMLElement | null;
    if (!slot) {
      return;
    }
    // Use the slot's offset within the page rather than getBoundingClientRect
    // — getBoundingClientRect would change with current scroll, while
    // offsetTop is a stable layout coordinate inside the page.
    const target = Math.max(0, slot.offsetTop - 16);
    this.node.scrollTo({ top: target, behavior: 'smooth' });
    this._toc.setActiveCell(cellId);
  }

  private _onLayoutChanged(): void {
    if (!this.isVisible || !this._tocVisible) {
      return;
    }
    this._refreshToc();
  }

  private _refreshToc(): void {
    if (!this._tocVisible) {
      return;
    }
    const settings = this.manager.read().settings;
    const bounds = pageBoundsFor({
      page_size: settings.page_size,
      orientation: settings.orientation,
      page_count: 1,
      grid_snap: 0,
      default_summary_lines: 3,
      notebook_mode: 'edit',
      smart_guides: false,
      page_margin: 0
    });
    const sources: ITocSourceCell[] = [];
    for (const entry of this.coordinator.list()) {
      if (entry.layout.mode !== 'summary') {
        continue;
      }
      sources.push({
        cellId: entry.cellModel.id,
        type: entry.layout.type,
        source: coerceText(entry.cellModel.sharedModel.getSource()),
        xMm: entry.layout.input.position.x,
        yMm: entry.layout.input.position.y
      });
    }
    const headings = buildTocHeadings(
      sources,
      bounds.height,
      Math.max(1, Math.floor(settings.page_count))
    );
    this._toc.setEntries(headings);
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
        isCellLinked: id => this.isCellLinked(id),
        isInMultiSelection: id => this._isInMultiSelection(id),
        getMultiSelectionSiblings: id => this._collectMultiSelectionSiblings(id)
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
      // Markdown source changes don't affect rendered cells (those re-render
      // through their own subscription) but the ToC walks markdown headings,
      // so subscribe to the shared model's text changes and debounce a ToC
      // rebuild. Skip when the ToC is invisible — handler is a cheap signal
      // hop in that case.
      if (entry.cellModel.type === 'markdown') {
        const sharedModel = entry.cellModel.sharedModel;
        const handler = (): void => this._scheduleTocRefresh();
        sharedModel.changed.connect(handler);
        this._outputDisconnects.push(() =>
          sharedModel.changed.disconnect(handler)
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
    this._refreshToc();
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

  private _scheduleTocRefresh(): void {
    if (!this._tocVisible || !this.isVisible) {
      return;
    }
    // Heavier debounce than output refresh — typing triggers many
    // sharedModel.changed signals and rebuilding the heading list per
    // keystroke is wasteful.
    if (this._pendingTocRefresh !== null) {
      clearTimeout(this._pendingTocRefresh);
    }
    this._pendingTocRefresh = setTimeout(() => {
      this._pendingTocRefresh = null;
      if (!this._tocVisible || !this.isVisible) {
        return;
      }
      this._refreshToc();
    }, 300);
  }

  private _snapHandlerFor(cellId: string, slot: SlotKey): ISnapHandler | null {
    const excludeKey = `${cellId}:${slot}`;
    // When a cell is linked for group drag, or when it's part of a
    // multi-cell selection, every sibling moves with the primary; if we
    // left them in the snap-target set, snap distances would be locked
    // at drag start (siblings move with primary so the distance never
    // changes) and would either fire instantly or never. Exclude the
    // whole cell (link case) or the whole selection (multi-select case).
    const collect = (): IRect[] => {
      const excludedCells = new Set<string>();
      if (this.isCellLinked(cellId)) {
        excludedCells.add(cellId);
      }
      if (this._isInMultiSelection(cellId)) {
        for (const id of this._selection) {
          excludedCells.add(id);
        }
      }
      return this._collectSnapRects(excludeKey, excludedCells);
    };
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
      pageCount: settings.page_count,
      margin: settings.smart_guides ? settings.page_margin : 0
    };
  }

  private _collectSnapRects(
    excludeKey: string,
    excludeCellIds: ReadonlySet<string> = new Set()
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
      if (excludeCellIds.has(cellId)) {
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
    return this._lastTouchedCellId;
  }

  consumeActiveCellId(): string | null {
    const id = this._lastTouchedCellId;
    this._lastTouchedCellId = null;
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
    // Selection state is updated separately by the canvas's capture-phase
    // pointerdown listener; this method just owns z-index ordering.
    if (this._linkedCellId && this._linkedCellId !== cellId) {
      this._linkedCellId = null;
      this._updatePinHighlight();
    }
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
    page_margin: number;
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
      smart_guides: false,
      page_margin: 0
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
    this._renderPageMargins(
      pageCount,
      widthPx,
      pageHeightPx,
      settings.page_margin
    );
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

  /**
   * Draw a faint dashed rectangle inside each page representing the page
   * margin. Cosmetic only — actual snap behaviour lives in alignment-guides
   * via the `margin` field on `IPageBox`. Hidden during PDF export by the
   * `.jp-CellLayout-exporting` CSS rule.
   */
  private _renderPageMargins(
    count: number,
    widthPx: number,
    pageHeightPx: number,
    marginMm: number
  ): void {
    for (const el of Array.from(
      this._page.querySelectorAll('.jp-CellLayout-pageMargin')
    )) {
      el.remove();
    }
    if (!(marginMm > 0)) {
      return;
    }
    const marginPx = mmToPx(marginMm);
    const innerWidth = widthPx - marginPx * 2;
    const innerHeight = pageHeightPx - marginPx * 2;
    if (innerWidth <= 0 || innerHeight <= 0) {
      return;
    }
    for (let i = 0; i < count; i++) {
      const box = document.createElement('div');
      box.className = 'jp-CellLayout-pageMargin';
      box.style.left = `${marginPx}px`;
      box.style.top = `${pageHeightPx * i + marginPx}px`;
      box.style.width = `${innerWidth}px`;
      box.style.height = `${innerHeight}px`;
      this._page.appendChild(box);
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
    if (this._pendingTocRefresh !== null) {
      clearTimeout(this._pendingTocRefresh);
      this._pendingTocRefresh = null;
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
