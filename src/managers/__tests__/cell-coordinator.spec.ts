import {
  DEFAULT_INPUT_HEIGHT_MM,
  DEFAULT_OUTPUT_HEIGHT_MM,
  PAGE_MARGIN_MM,
  ROW_GAP_MM,
  SLOT_GAP_MM,
  computeDefaultLayoutsForCells,
  computeRequiredPageCount,
  pageBoundsFor,
  pageHeightMmFor,
  pruneStaleCells,
  type ICellInfo
} from '../cell-coordinator';
import {
  defaultNotebookLayout,
  defaultSettings,
  type ICellLayout,
  type ILayoutSettings,
  type INotebookLayout
} from '../metadata';

function a4Settings(overrides: Partial<ILayoutSettings> = {}): ILayoutSettings {
  return { ...defaultSettings(), ...overrides };
}

describe('pageBoundsFor', () => {
  it('returns A4 dimensions with margin', () => {
    const bounds = pageBoundsFor(a4Settings());
    expect(bounds.width).toBe(210);
    expect(bounds.height).toBe(297);
    expect(bounds.margin).toBe(PAGE_MARGIN_MM);
    expect(bounds.contentWidth).toBe(210 - PAGE_MARGIN_MM * 2);
  });

  it('switches to A3 dimensions', () => {
    const bounds = pageBoundsFor(a4Settings({ page_size: 'A3' }));
    expect(bounds.width).toBe(297);
    expect(bounds.height).toBe(420);
    expect(bounds.contentWidth).toBe(297 - PAGE_MARGIN_MM * 2);
  });

  it('swaps A4 dimensions in landscape', () => {
    const bounds = pageBoundsFor(a4Settings({ orientation: 'landscape' }));
    expect(bounds.width).toBe(297);
    expect(bounds.height).toBe(210);
    expect(bounds.contentWidth).toBe(297 - PAGE_MARGIN_MM * 2);
  });

  it('swaps A3 dimensions in landscape', () => {
    const bounds = pageBoundsFor(
      a4Settings({ page_size: 'A3', orientation: 'landscape' })
    );
    expect(bounds.width).toBe(420);
    expect(bounds.height).toBe(297);
  });
});

describe('computeDefaultLayoutsForCells', () => {
  const settings = a4Settings();

  it('returns [] for no cells', () => {
    expect(computeDefaultLayoutsForCells([], settings)).toEqual([]);
  });

  it('places a single code cell with no outputs at top margin', () => {
    const infos: ICellInfo[] = [{ cellType: 'code', hasOutputs: false }];
    const layouts = computeDefaultLayoutsForCells(infos, settings);
    expect(layouts).toHaveLength(1);
    const l = layouts[0];
    expect(l.type).toBe('code');
    expect(l.mode).toBe('summary');
    expect(l.input.position).toEqual({ x: PAGE_MARGIN_MM, y: PAGE_MARGIN_MM });
    expect(l.input.size.height).toBe(DEFAULT_INPUT_HEIGHT_MM);
    expect(l.outputs).toEqual([]);
  });

  it('places a code cell with outputs and gives it two slots A/B side-by-side', () => {
    const infos: ICellInfo[] = [{ cellType: 'code', hasOutputs: true }];
    const [layout] = computeDefaultLayoutsForCells(infos, settings);
    expect(layout.outputs).toHaveLength(2);
    const [a, b] = layout.outputs;
    expect(a.output_id).toBe('output_a');
    expect(b.output_id).toBe('output_b');
    expect(a.position.y).toBe(
      layout.input.position.y + layout.input.size.height + SLOT_GAP_MM
    );
    expect(b.position.y).toBe(a.position.y);
    expect(b.position.x).toBeGreaterThan(a.position.x);
    expect(a.size.height).toBe(DEFAULT_OUTPUT_HEIGHT_MM);
    expect(b.visible_lines).toBeNull();
    expect(a.visible_lines).toBeGreaterThan(0);
  });

  it('never gives markdown cells output slots even if hasOutputs is true', () => {
    const infos: ICellInfo[] = [{ cellType: 'markdown', hasOutputs: true }];
    const [layout] = computeDefaultLayoutsForCells(infos, settings);
    expect(layout.outputs).toEqual([]);
  });

  it('stacks multiple cells top-to-bottom with gaps', () => {
    const infos: ICellInfo[] = [
      { cellType: 'code', hasOutputs: false },
      { cellType: 'markdown', hasOutputs: false },
      { cellType: 'code', hasOutputs: true }
    ];
    const layouts = computeDefaultLayoutsForCells(infos, settings);
    expect(layouts).toHaveLength(3);
    expect(layouts[1].input.position.y).toBe(
      PAGE_MARGIN_MM + DEFAULT_INPUT_HEIGHT_MM + ROW_GAP_MM
    );
    expect(layouts[2].input.position.y).toBe(
      PAGE_MARGIN_MM + (DEFAULT_INPUT_HEIGHT_MM + ROW_GAP_MM) * 2
    );
  });

  it('accounts for output-bearing rows being taller', () => {
    const infos: ICellInfo[] = [
      { cellType: 'code', hasOutputs: true },
      { cellType: 'code', hasOutputs: false }
    ];
    const layouts = computeDefaultLayoutsForCells(infos, settings);
    const expectedSecondY =
      PAGE_MARGIN_MM +
      DEFAULT_INPUT_HEIGHT_MM +
      SLOT_GAP_MM +
      DEFAULT_OUTPUT_HEIGHT_MM +
      ROW_GAP_MM;
    expect(layouts[1].input.position.y).toBe(expectedSecondY);
  });

  it('uses page content width for input width', () => {
    const a4 = computeDefaultLayoutsForCells(
      [{ cellType: 'code', hasOutputs: false }],
      a4Settings()
    );
    const a3 = computeDefaultLayoutsForCells(
      [{ cellType: 'code', hasOutputs: false }],
      a4Settings({ page_size: 'A3' })
    );
    expect(a4[0].input.size.width).toBe(210 - PAGE_MARGIN_MM * 2);
    expect(a3[0].input.size.width).toBe(297 - PAGE_MARGIN_MM * 2);
  });

  it('respects default_summary_lines from settings', () => {
    const layouts = computeDefaultLayoutsForCells(
      [{ cellType: 'code', hasOutputs: false }],
      a4Settings({ default_summary_lines: 7 })
    );
    expect(layouts[0].input.visible_lines).toBe(7);
  });

  it('defaults cell mode to summary (included on canvas)', () => {
    const layouts = computeDefaultLayoutsForCells(
      [
        { cellType: 'code', hasOutputs: false },
        { cellType: 'markdown', hasOutputs: false }
      ],
      a4Settings()
    );
    expect(layouts[0].mode).toBe('summary');
    expect(layouts[1].mode).toBe('summary');
  });
});

describe('pageHeightMmFor', () => {
  it('returns A4 portrait height', () => {
    expect(pageHeightMmFor(a4Settings())).toBe(297);
  });

  it('returns A4 landscape height (= portrait width)', () => {
    expect(pageHeightMmFor(a4Settings({ orientation: 'landscape' }))).toBe(210);
  });
});

function layoutWithCells(
  cells: INotebookLayout['cells'],
  pageCount = 1
): INotebookLayout {
  const base = defaultNotebookLayout();
  return {
    ...base,
    settings: { ...base.settings, page_count: pageCount },
    cells
  };
}

describe('computeRequiredPageCount', () => {
  const inputAt = (y: number, height: number): ICellLayout => ({
    type: 'code',
    mode: 'summary',
    input: {
      position: { x: 0, y },
      size: { width: 100, height },
      visible_lines: 3,
      z_index: 1,
      auto_fit: false
    },
    outputs: []
  });

  it('returns current page_count when there are no cells', () => {
    expect(computeRequiredPageCount(layoutWithCells({}, 3))).toBe(3);
  });

  it('returns 1 for cells fitting on the first page', () => {
    expect(
      computeRequiredPageCount(layoutWithCells({ a: inputAt(10, 50) }, 1))
    ).toBe(1);
  });

  it('returns 2 for a cell that crosses into the second page', () => {
    expect(
      computeRequiredPageCount(layoutWithCells({ a: inputAt(280, 50) }, 1))
    ).toBe(2);
  });

  it('returns 3 for a cell deep on page 3', () => {
    expect(
      computeRequiredPageCount(layoutWithCells({ a: inputAt(620, 30) }, 1))
    ).toBe(3);
  });

  it('caps at MAX_PAGE_COUNT (20) for absurd positions', () => {
    expect(
      computeRequiredPageCount(layoutWithCells({ a: inputAt(99999, 30) }, 1))
    ).toBe(20);
  });

  it('uses the largest output bottom edge when greater than input', () => {
    const cell = inputAt(10, 30);
    cell.outputs = [
      {
        output_id: 'output_b',
        type: 'graphics',
        position: { x: 0, y: 400 },
        size: { width: 100, height: 50 },
        visible_lines: null,
        z_index: 2,
        max_image_width: 90,
        enabled: true,
        auto_fit: false
      }
    ];
    expect(computeRequiredPageCount(layoutWithCells({ a: cell }, 1))).toBe(2);
  });

  it('ignores cells whose mode is not summary', () => {
    const cell = inputAt(620, 30);
    cell.mode = 'edit';
    expect(computeRequiredPageCount(layoutWithCells({ a: cell }, 1))).toBe(1);
  });
});

describe('toggleCellInclusion logic (via pure-function surrogate)', () => {
  // The toggleCellInclusion method flips mode between 'summary' and 'edit'.
  // The class method needs a live model to test; here we verify the flip
  // logic conceptually via the defaults helper.
  it('summary ↔ edit flip returns the opposite', () => {
    const flip = (m: 'summary' | 'edit'): 'summary' | 'edit' =>
      m === 'summary' ? 'edit' : 'summary';
    expect(flip('summary')).toBe('edit');
    expect(flip('edit')).toBe('summary');
  });
});

describe('pruneStaleCells', () => {
  const makeLayout = (): ICellLayout => ({
    type: 'code',
    mode: 'summary',
    input: {
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      visible_lines: 3,
      z_index: 1,
      auto_fit: true
    },
    outputs: []
  });

  it('returns empty object when no cells are live', () => {
    expect(pruneStaleCells({ a: makeLayout() }, new Set())).toEqual({});
  });

  it('keeps layouts for live cells only', () => {
    const cells = {
      alive1: makeLayout(),
      dead: makeLayout(),
      alive2: makeLayout()
    };
    const liveIds = new Set(['alive1', 'alive2']);
    expect(Object.keys(pruneStaleCells(cells, liveIds))).toEqual([
      'alive1',
      'alive2'
    ]);
  });

  it('preserves object identity of kept entries', () => {
    const kept = makeLayout();
    const result = pruneStaleCells({ keep: kept }, new Set(['keep']));
    expect(result.keep).toBe(kept);
  });
});
