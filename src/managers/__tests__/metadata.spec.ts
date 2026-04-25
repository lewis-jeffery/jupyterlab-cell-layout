import {
  DEFAULT_GRID_SNAP_MM,
  DEFAULT_SUMMARY_LINES,
  LAYOUT_SCHEMA_VERSION,
  PAGE_SIZES_MM,
  defaultCellLayout,
  defaultNotebookLayout,
  defaultOutputLayout,
  normalizeCell,
  normalizeLayout,
  normalizeSettings
} from '../metadata';

describe('normalizeLayout', () => {
  it('returns defaults for undefined input', () => {
    const layout = normalizeLayout(undefined);
    expect(layout).toEqual(defaultNotebookLayout());
    expect(layout.version).toBe(LAYOUT_SCHEMA_VERSION);
    expect(layout.enabled).toBe(false);
    expect(layout.settings.page_size).toBe('A4');
    expect(layout.settings.grid_snap).toBe(DEFAULT_GRID_SNAP_MM);
    expect(layout.cells).toEqual({});
  });

  it('returns defaults for null input', () => {
    expect(normalizeLayout(null)).toEqual(defaultNotebookLayout());
  });

  it('returns defaults for malformed input (string)', () => {
    expect(normalizeLayout('garbage')).toEqual(defaultNotebookLayout());
  });

  it('preserves version string when present', () => {
    expect(normalizeLayout({ version: '2.1' }).version).toBe('2.1');
  });

  it('falls back to default version when not a string', () => {
    expect(normalizeLayout({ version: 42 }).version).toBe(
      LAYOUT_SCHEMA_VERSION
    );
  });

  it('fills in missing settings block', () => {
    const layout = normalizeLayout({ enabled: true });
    expect(layout.enabled).toBe(true);
    expect(layout.settings.page_size).toBe('A4');
    expect(layout.settings.notebook_mode).toBe('edit');
  });

  it('is idempotent (normalize(normalize(x)) === normalize(x))', () => {
    const raw = {
      version: '1.0',
      enabled: true,
      settings: {
        page_size: 'A3',
        grid_snap: 10,
        default_summary_lines: 5,
        notebook_mode: 'summary'
      },
      cells: {
        'cell-1': {
          type: 'code',
          mode: 'summary',
          input: {
            position: { x: 10, y: 20 },
            size: { width: 100, height: 50 },
            visible_lines: 3,
            z_index: 1
          },
          outputs: []
        }
      }
    };
    const once = normalizeLayout(raw);
    const twice = normalizeLayout(once);
    expect(twice).toEqual(once);
  });
});

describe('normalizeSettings', () => {
  it('accepts A3 page_size', () => {
    expect(normalizeSettings({ page_size: 'A3' }).page_size).toBe('A3');
  });

  it('falls back to A4 for unknown page_size', () => {
    expect(normalizeSettings({ page_size: 'Letter' }).page_size).toBe('A4');
  });

  it('defaults orientation to portrait', () => {
    expect(normalizeSettings({}).orientation).toBe('portrait');
  });

  it('accepts orientation landscape', () => {
    expect(normalizeSettings({ orientation: 'landscape' }).orientation).toBe(
      'landscape'
    );
  });

  it('falls back to portrait for unknown orientation', () => {
    expect(normalizeSettings({ orientation: 'diagonal' }).orientation).toBe(
      'portrait'
    );
  });

  it('accepts notebook_mode summary', () => {
    expect(normalizeSettings({ notebook_mode: 'summary' }).notebook_mode).toBe(
      'summary'
    );
  });

  it('defaults notebook_mode to edit', () => {
    expect(normalizeSettings({}).notebook_mode).toBe('edit');
  });

  it('rejects negative grid_snap', () => {
    expect(normalizeSettings({ grid_snap: -1 }).grid_snap).toBe(
      DEFAULT_GRID_SNAP_MM
    );
  });

  it('rejects non-numeric grid_snap', () => {
    expect(normalizeSettings({ grid_snap: 'five' }).grid_snap).toBe(
      DEFAULT_GRID_SNAP_MM
    );
  });

  it('accepts zero grid_snap', () => {
    expect(normalizeSettings({ grid_snap: 0 }).grid_snap).toBe(0);
  });

  it('rejects non-positive default_summary_lines', () => {
    expect(normalizeSettings({ default_summary_lines: 0 }).default_summary_lines).toBe(
      DEFAULT_SUMMARY_LINES
    );
  });
});

describe('normalizeCell', () => {
  it('returns null for non-object input', () => {
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(42)).toBeNull();
    expect(normalizeCell([])).toBeNull();
  });

  it('defaults to code type when type is unknown', () => {
    expect(normalizeCell({})?.type).toBe('code');
    expect(normalizeCell({ type: 'banana' })?.type).toBe('code');
  });

  it('accepts markdown and raw types', () => {
    expect(normalizeCell({ type: 'markdown' })?.type).toBe('markdown');
    expect(normalizeCell({ type: 'raw' })?.type).toBe('raw');
  });

  it('defaults mode to edit', () => {
    expect(normalizeCell({})?.mode).toBe('edit');
  });

  it('accepts mode summary', () => {
    expect(normalizeCell({ mode: 'summary' })?.mode).toBe('summary');
  });

  it('caps outputs array at 2 entries', () => {
    const cell = normalizeCell({
      outputs: [
        { output_id: 'output_a', type: 'text' },
        { output_id: 'output_b', type: 'graphics' },
        { output_id: 'output_a', type: 'text' }
      ]
    });
    expect(cell?.outputs).toHaveLength(2);
  });

  it('assigns fallback slot id when missing', () => {
    const cell = normalizeCell({
      outputs: [{ type: 'text' }, { type: 'graphics' }]
    });
    expect(cell?.outputs[0].output_id).toBe('output_a');
    expect(cell?.outputs[1].output_id).toBe('output_b');
  });

  it('uses null visible_lines for graphics by default', () => {
    const cell = normalizeCell({
      outputs: [{ output_id: 'output_b', type: 'graphics' }]
    });
    expect(cell?.outputs[0].visible_lines).toBeNull();
  });

  it('preserves explicit null visible_lines', () => {
    const cell = normalizeCell({
      outputs: [{ output_id: 'output_a', type: 'text', visible_lines: null }]
    });
    expect(cell?.outputs[0].visible_lines).toBeNull();
  });

  it('defaults enabled to true when missing', () => {
    const cell = normalizeCell({
      outputs: [{ output_id: 'output_a', type: 'text' }]
    });
    expect(cell?.outputs[0].enabled).toBe(true);
  });

  it('preserves enabled false', () => {
    const cell = normalizeCell({
      outputs: [{ output_id: 'output_a', type: 'text', enabled: false }]
    });
    expect(cell?.outputs[0].enabled).toBe(false);
  });

  it('preserves a complete excel link', () => {
    const cell = normalizeCell({
      excel: { workbook: '/x/data.xlsx', sheet: 'Sheet1', range: 'design' }
    });
    expect(cell?.excel).toEqual({
      workbook: '/x/data.xlsx',
      sheet: 'Sheet1',
      range: 'design'
    });
  });

  it('drops an excel link missing required fields', () => {
    const cell = normalizeCell({
      excel: { workbook: 'data.xlsx', sheet: 'Sheet1' }
    });
    expect(cell?.excel).toBeUndefined();
  });

  it('trims whitespace in excel link fields', () => {
    const cell = normalizeCell({
      excel: { workbook: ' a.xlsx ', sheet: ' s ', range: ' r ' }
    });
    expect(cell?.excel).toEqual({ workbook: 'a.xlsx', sheet: 's', range: 'r' });
  });

  it('rejects non-string excel field values', () => {
    const cell = normalizeCell({
      excel: { workbook: 1, sheet: 2, range: 3 }
    });
    expect(cell?.excel).toBeUndefined();
  });

  it('omits the excel field entirely when not set', () => {
    const cell = normalizeCell({});
    expect(cell).not.toBeNull();
    expect('excel' in (cell as object)).toBe(false);
  });
});

describe('defaults', () => {
  it('defaultCellLayout produces a markdown cell with zero outputs', () => {
    const cell = defaultCellLayout('markdown');
    expect(cell.type).toBe('markdown');
    expect(cell.outputs).toEqual([]);
  });

  it('defaultOutputLayout graphics slot has null visible_lines', () => {
    expect(defaultOutputLayout('output_b', 'graphics').visible_lines).toBeNull();
  });

  it('page sizes in mm match A4 and A3 dimensions', () => {
    expect(PAGE_SIZES_MM.A4).toEqual({ width: 210, height: 297 });
    expect(PAGE_SIZES_MM.A3).toEqual({ width: 297, height: 420 });
  });
});
