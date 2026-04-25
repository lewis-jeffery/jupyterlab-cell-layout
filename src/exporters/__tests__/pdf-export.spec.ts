import {
  defaultNotebookLayout,
  type ICellLayout,
  type INotebookLayout
} from '../../managers/metadata';
import { computePageStraddleOffsets } from '../pdf-export';

function makeCell(
  inputY: number,
  inputH: number,
  outputs: Array<{ y: number; h: number; enabled?: boolean }> = []
): ICellLayout {
  return {
    type: 'code',
    mode: 'summary',
    input: {
      position: { x: 0, y: inputY },
      size: { width: 100, height: inputH },
      visible_lines: 3,
      z_index: 1,
      auto_fit: false
    },
    outputs: outputs.map((o, i) => ({
      output_id: i === 0 ? 'output_a' : 'output_b',
      type: 'text' as const,
      position: { x: 0, y: o.y },
      size: { width: 100, height: o.h },
      visible_lines: 10,
      z_index: 2,
      max_image_width: 90,
      enabled: o.enabled !== false,
      auto_fit: false
    }))
  };
}

function withCells(cells: Record<string, ICellLayout>): INotebookLayout {
  return { ...defaultNotebookLayout(), cells };
}

describe('computePageStraddleOffsets', () => {
  const A4 = 297;

  it('returns empty map for single-page layouts', () => {
    const layout = withCells({ a: makeCell(0, 50) });
    expect(computePageStraddleOffsets(layout, A4, 1).size).toBe(0);
  });

  it('returns empty map when no cell straddles', () => {
    const layout = withCells({
      a: makeCell(0, 100),     // page 1 only
      b: makeCell(300, 50)     // entirely on page 2
    });
    expect(computePageStraddleOffsets(layout, A4, 2).size).toBe(0);
  });

  it('pushes a cell whose input straddles the page boundary', () => {
    // Input at y=270 with h=50 → bottom 320 → straddles 297 boundary
    const layout = withCells({ a: makeCell(270, 50) });
    const offsets = computePageStraddleOffsets(layout, A4, 2);
    expect(offsets.get('a')).toBe(A4 - 270); // pushes top to 297
  });

  it('uses combined input + outputs bounding box', () => {
    // Input at 280, h=10 (ends at 290 — still page 1).
    // Output at 290, h=20 (ends at 310 — straddles).
    const layout = withCells({ a: makeCell(280, 10, [{ y: 290, h: 20 }]) });
    const offsets = computePageStraddleOffsets(layout, A4, 2);
    expect(offsets.get('a')).toBe(A4 - 280); // push everything down by 17
  });

  it('skips disabled output slots when computing bounding box', () => {
    // Input + a disabled tall output that would otherwise straddle.
    const layout = withCells({
      a: makeCell(0, 50, [{ y: 280, h: 50, enabled: false }])
    });
    expect(computePageStraddleOffsets(layout, A4, 2).size).toBe(0);
  });

  it('does not push cells already on the last page', () => {
    // Cell on page 2 of 2, straddling bottom — nowhere to go.
    const layout = withCells({ a: makeCell(580, 30) });
    expect(computePageStraddleOffsets(layout, A4, 2).size).toBe(0);
  });

  it('does not push cells taller than one page', () => {
    // Cell taller than a page — pushing won't help.
    const layout = withCells({ a: makeCell(10, 320) });
    expect(computePageStraddleOffsets(layout, A4, 3).size).toBe(0);
  });

  it('skips cells whose mode is not summary', () => {
    const cell = makeCell(280, 50);
    cell.mode = 'edit';
    expect(computePageStraddleOffsets(withCells({ a: cell }), A4, 2).size).toBe(
      0
    );
  });

  it('treats a cell ending exactly on the boundary as not straddling', () => {
    // y=270, h=27 → bottom = 297 exactly = page 1's boundary
    const layout = withCells({ a: makeCell(270, 27) });
    expect(computePageStraddleOffsets(layout, A4, 2).size).toBe(0);
  });
});
