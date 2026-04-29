import { buildTocHeadings, type ITocSourceCell } from '../toc-sidebar';

const PAGE_HEIGHT_MM = 297;

let nextId = 0;
function md(source: string, yMm: number, xMm = 20): ITocSourceCell {
  return { cellId: `c${++nextId}`, type: 'markdown', source, yMm, xMm };
}
function code(source: string, yMm: number, xMm = 20): ITocSourceCell {
  return { cellId: `c${++nextId}`, type: 'code', source, yMm, xMm };
}

describe('buildTocHeadings', () => {
  beforeEach(() => {
    nextId = 0;
  });

  it('returns an empty list when there are no markdown cells', () => {
    const out = buildTocHeadings([code('print(1)', 10)], PAGE_HEIGHT_MM, 1);
    expect(out).toEqual([]);
  });

  it('extracts ATX headings with level = number of #', () => {
    const cells = [md('# H1\n\n## H2\n\n### H3', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out.map(h => `${h.level}:${h.text}`)).toEqual([
      '1:H1',
      '2:H2',
      '3:H3'
    ]);
  });

  it('ignores lines with more than six leading hashes (CommonMark)', () => {
    const cells = [md('####### Way too deep', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out).toEqual([]);
  });

  it('strips trailing closing # on Setext-like ATX', () => {
    const cells = [md('## Calculations ##', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out[0].text).toBe('Calculations');
  });

  it('skips headings inside fenced code blocks', () => {
    const cells = [
      md('# Real heading\n\n```\n# fake code-block heading\n```\n\n## Another real one', 10)
    ];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out.map(h => h.text)).toEqual(['Real heading', 'Another real one']);
  });

  it('orders cells by page bucket then row-major within page', () => {
    const cells = [
      md('# Page2', 320),
      md('# Page1', 10),
      md('# Page1Right', 12, 150),
      md('# Page1Left', 14, 30)
    ];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 2);
    expect(out.map(h => h.text)).toEqual([
      'Page1',         // y=10, x=20  → first row, leftmost
      'Page1Left',     // y=14, x=30  → same row (within tolerance), second leftmost
      'Page1Right',    // y=12, x=150 → same row, far right (sorted after by x)
      'Page2'
    ]);
  });

  it('records the page number on each heading', () => {
    const cells = [md('# A', 10), md('# B', 320), md('# C', 620)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 3);
    expect(out.map(h => `${h.text}:p${h.pageNumber}`)).toEqual([
      'A:p1',
      'B:p2',
      'C:p3'
    ]);
  });

  it('clamps cells beyond pageCount to the last page', () => {
    const cells = [md('# Stragler', 9999)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 2);
    expect(out[0].pageNumber).toBe(2);
  });

  it('emits multiple headings from one cell in source order', () => {
    const cells = [md('# Top\n\nbody\n\n## Sub\n\n### Detail', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out.map(h => h.text)).toEqual(['Top', 'Sub', 'Detail']);
  });

  it('attaches each heading to its source cellId', () => {
    const cells = [md('# A', 10), md('# B', 50)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out[0].cellId).toBe(cells[0].cellId);
    expect(out[1].cellId).toBe(cells[1].cellId);
  });

  it('truncates long headings with an ellipsis', () => {
    const long = 'A'.repeat(120);
    const out = buildTocHeadings([md(`# ${long}`, 10)], PAGE_HEIGHT_MM, 1);
    expect(out[0].text.length).toBeLessThanOrEqual(60);
    expect(out[0].text.endsWith('…')).toBe(true);
  });

  it('ignores lines that look like headings but are not (no space after #)', () => {
    const cells = [md('#nospace\nplain', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out).toEqual([]);
  });

  it('ignores plain markdown text that does not contain headings', () => {
    const cells = [md('Just a paragraph.\n\nAnother one.', 10)];
    const out = buildTocHeadings(cells, PAGE_HEIGHT_MM, 1);
    expect(out).toEqual([]);
  });
});
