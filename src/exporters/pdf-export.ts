/**
 * PDF export for the summary-mode layout canvas.
 *
 * Approach: rasterise the rendered DOM (one .jp-CellLayout-page element that
 * contains all N pages stacked vertically) using html2canvas, then split the
 * resulting bitmap into per-page slices and embed each as one PDF page using
 * jsPDF.
 *
 * Trade-off: PDF text is rasterised — not searchable. Faithful to the
 * on-screen layout in exchange for that loss. Vector PDF generation would
 * require recreating the markdown / image rendering pipeline.
 */

import type { NotebookPanel } from '@jupyterlab/notebook';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

import {
  type INotebookLayout,
  type MetadataManager,
  PAGE_SIZES_MM
} from '../managers/metadata';
import type { ITocHeading } from '../managers/toc';
import { mmToPx, pxToMm } from '../widgets/units';

import { type ICoverSheetData, renderCoverAndToc } from './cover-sheet';

export class PdfExportError extends Error {}

const CAPTURE_SCALE = 2;
const EXPORTING_CLASS = 'jp-CellLayout-exporting';

// JPEG quality for the per-page bitmap. 0.85 is the standard
// photographic sweet spot — barely-perceptible compression loss on
// charts and plots, and roughly 10–20× smaller than lossless PNG for
// plot-heavy notebooks. Sharp text edges can show very mild ringing
// at this quality but the invisible-text overlay is what users
// actually search/select, so it doesn't hurt readability.
const JPEG_QUALITY = 0.85;

export interface IExportOptions {
  /** Override the output file name (without extension). */
  filename?: string;
  /** When set, prepend a cover page (and optional ToC) before content. */
  cover?: ICoverSheetData;
  /**
   * Heading list for the cover-sheet ToC. Required when
   * `cover.includeToc` is true; ignored otherwise. Caller builds this
   * via `buildTocHeadings` from `managers/toc.ts` with the same source
   * data the canvas uses for its sidebar.
   */
  tocHeadings?: readonly ITocHeading[];
}

export async function exportToPdf(
  panel: NotebookPanel,
  manager: MetadataManager,
  pageEl: HTMLElement,
  options: IExportOptions = {}
): Promise<string> {
  const settings = manager.read().settings;
  if (settings.notebook_mode !== 'summary') {
    throw new PdfExportError(
      'Switch to summary mode before exporting (Ctrl+Shift+T).'
    );
  }

  const pageDims = PAGE_SIZES_MM[settings.page_size];
  const isLandscape = settings.orientation === 'landscape';
  const pageWidthMm = isLandscape ? pageDims.height : pageDims.width;
  const pageHeightMm = isLandscape ? pageDims.width : pageDims.height;
  const pageCount = Math.max(1, Math.floor(settings.page_count));

  const layout = manager.read();
  const restoreStraddles = applyPageStraddleAdjustments(
    pageEl,
    layout,
    pageHeightMm,
    pageCount
  );

  const tocHeadings: readonly ITocHeading[] =
    options.cover?.includeToc && options.tocHeadings
      ? options.tocHeadings
      : [];

  pageEl.classList.add(EXPORTING_CLASS);
  let fullCanvas: HTMLCanvasElement;
  let linkRects: ILinkRect[];
  let textRuns: ITextRun[];
  try {
    fullCanvas = await html2canvas(pageEl, {
      scale: CAPTURE_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    // Collect link positions and text runs while straddle adjustments are
    // still applied, so the rect Y offsets match the bitmap.
    linkRects = collectLinkRects(pageEl);
    textRuns = collectTextRuns(pageEl);
  } finally {
    pageEl.classList.remove(EXPORTING_CLASS);
    restoreStraddles();
  }

  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: settings.page_size.toLowerCase() // 'a4' or 'a3'
  });

  // Render the cover (and optional ToC) into the PDF's existing first
  // page. Returns the number of pages we've used before content begins,
  // which we use to offset every subsequent page reference.
  const pagesBeforeContent = options.cover
    ? renderCoverAndToc(
        pdf,
        options.cover,
        tocHeadings,
        pageWidthMm,
        pageHeightMm
      ).pagesBeforeContent
    : 0;

  const sliceHeightPx = fullCanvas.height / pageCount;
  for (let i = 0; i < pageCount; i++) {
    const dataUrl = sliceToDataUrl(
      fullCanvas,
      0,
      Math.floor(sliceHeightPx * i),
      fullCanvas.width,
      Math.floor(sliceHeightPx)
    );
    // First content page: if no cover was rendered, the pdf already has
    // an empty page 1 we draw onto. If a cover was rendered, we addPage
    // to start content. Subsequent content pages always addPage.
    if (i === 0) {
      if (pagesBeforeContent > 0) {
        pdf.addPage();
      }
    } else {
      pdf.addPage();
    }
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
  }

  // Add invisible text overlay to make the PDF searchable / selectable.
  // PDF rendering mode 3 emits text into the content stream without painting
  // any glyphs — search and selection still see it.
  for (const run of textRuns) {
    const pageIndex = Math.floor(run.topMm / pageHeightMm);
    if (pageIndex < 0 || pageIndex >= pageCount) {
      continue;
    }
    pdf.setPage(pagesBeforeContent + pageIndex + 1);
    pdf.setFontSize(run.fontSizePt);
    const localTopMm = run.topMm - pageIndex * pageHeightMm;
    // jsPDF text y is the baseline; offset by font size so the invisible
    // text sits roughly where the visible text is on the bitmap.
    const baselineYMm = localTopMm + (run.fontSizePt * 25.4) / 72;
    try {
      pdf.text(run.text, run.leftMm, baselineYMm, {
        renderingMode: 'invisible'
      });
    } catch {
      // Some characters can't be encoded in the default Helvetica font
      // (non-WinAnsi). Skip silently — most text will index correctly.
    }
  }

  // Add link annotations on top of each PDF page so URLs are clickable.
  for (const link of linkRects) {
    const pageIndex = Math.floor(link.topMm / pageHeightMm);
    if (pageIndex < 0 || pageIndex >= pageCount) {
      continue;
    }
    pdf.setPage(pagesBeforeContent + pageIndex + 1);
    const localTopMm = link.topMm - pageIndex * pageHeightMm;
    pdf.link(link.leftMm, localTopMm, link.widthMm, link.heightMm, {
      url: link.href
    });
  }

  const filename = (options.filename ?? deriveFilename(panel)) + '.pdf';
  pdf.save(filename);
  return filename;
}


function sliceToDataUrl(
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): string {
  const slice = document.createElement('canvas');
  slice.width = sw;
  slice.height = sh;
  const ctx = slice.getContext('2d');
  if (!ctx) {
    throw new PdfExportError('Could not allocate 2D canvas for export slice.');
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return slice.toDataURL('image/jpeg', JPEG_QUALITY);
}

function deriveFilename(panel: NotebookPanel): string {
  const path = panel.context.path;
  const base = path.split('/').pop() ?? 'notebook';
  return base.replace(/\.ipynb$/i, '');
}

interface ILinkRect {
  href: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
}

interface ITextRun {
  text: string;
  leftMm: number;
  topMm: number;
  fontSizePt: number;
}

const SKIP_TEXT_FROM_CLASSES = new Set([
  'jp-CellLayout-pageNumber',
  'jp-CellLayout-label',
  'jp-CellLayout-pageBreak'
]);

/**
 * Walk the rendered DOM and collect each text node with its on-screen
 * position relative to the page element. Used to overlay invisible PDF
 * text on the bitmap so the export is searchable and selectable.
 *
 * Skips elements that are pure visual decoration (page-number badges,
 * cell-label badges) — they're already rasterised in the bitmap and would
 * duplicate in search results.
 */
function collectTextRuns(pageEl: HTMLElement): ITextRun[] {
  const pageRect = pageEl.getBoundingClientRect();
  const runs: ITextRun[] = [];
  const seenParents = new WeakSet<Element>();
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    textNodes.push(n as Text);
  }
  for (const tn of textNodes) {
    const value = tn.nodeValue ?? '';
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }
    const parent = tn.parentElement;
    if (!parent) {
      continue;
    }
    if (seenParents.has(parent)) {
      continue;
    }
    let skip = false;
    for (const cls of SKIP_TEXT_FROM_CLASSES) {
      if (parent.classList.contains(cls) || parent.closest(`.${cls}`)) {
        skip = true;
        break;
      }
    }
    if (skip) {
      continue;
    }
    seenParents.add(parent);
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    const fontSizePx = parseFloat(getComputedStyle(parent).fontSize) || 11;
    const fontSizePt = (fontSizePx * 72) / 96;
    // Use the parent's text content (not just this text node) so a paragraph
    // with inline children gets indexed once as a coherent run.
    const fullText = (parent.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!fullText) {
      continue;
    }
    runs.push({
      text: fullText,
      leftMm: pxToMm(rect.left - pageRect.left),
      topMm: pxToMm(rect.top - pageRect.top),
      fontSizePt
    });
  }
  return runs;
}

/**
 * Walk the rendered DOM for `<a href>` tags and capture their position
 * relative to the page element. Used to add link annotations to the PDF
 * after the bitmap is rasterised.
 */
function collectLinkRects(pageEl: HTMLElement): ILinkRect[] {
  const pageRect = pageEl.getBoundingClientRect();
  const rects: ILinkRect[] = [];
  for (const a of Array.from(pageEl.querySelectorAll('a'))) {
    const href = a.getAttribute('href');
    if (!href) {
      continue;
    }
    if (!/^(https?|mailto|ftp):/i.test(href)) {
      continue;
    }
    const r = a.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }
    rects.push({
      href,
      leftMm: pxToMm(r.left - pageRect.left),
      topMm: pxToMm(r.top - pageRect.top),
      widthMm: pxToMm(r.width),
      heightMm: pxToMm(r.height)
    });
  }
  return rects;
}

/**
 * Compute per-cell push offsets so cells whose bounding box would straddle
 * a page break are shifted down to the top of the next page. Implements the
 * design rule from project memory: "Cells that cross a page break get pushed
 * whole to the next page".
 *
 * Returns a map of cellId → offset (mm) to apply.
 */
export function computePageStraddleOffsets(
  layout: INotebookLayout,
  pageHeightMm: number,
  pageCount: number
): Map<string, number> {
  const offsets = new Map<string, number>();
  if (!Number.isFinite(pageHeightMm) || pageHeightMm <= 0 || pageCount < 2) {
    return offsets;
  }
  for (const [cellId, cell] of Object.entries(layout.cells)) {
    if (cell.mode !== 'summary') {
      continue;
    }
    const slots: Array<{ y: number; height: number }> = [
      { y: cell.input.position.y, height: cell.input.size.height }
    ];
    for (const o of cell.outputs) {
      if (!o.enabled) {
        continue;
      }
      slots.push({ y: o.position.y, height: o.size.height });
    }
    if (slots.length === 0) {
      continue;
    }
    let topMm = Infinity;
    let bottomMm = -Infinity;
    for (const s of slots) {
      topMm = Math.min(topMm, s.y);
      bottomMm = Math.max(bottomMm, s.y + s.height);
    }
    // The cell is taller than a single page — pushing won't help. Leave it.
    if (bottomMm - topMm > pageHeightMm) {
      continue;
    }
    const topPage = Math.floor(topMm / pageHeightMm);
    // Use a tiny epsilon so a cell whose bottom lands exactly on the boundary
    // (e.g. y=270, h=27 with 297mm page) doesn't count as straddling.
    const bottomPage = Math.floor((bottomMm - 0.001) / pageHeightMm);
    if (topPage === bottomPage) {
      continue;
    }
    // Already on the last page — nowhere to push to. Will get cut.
    if (topPage >= pageCount - 1) {
      continue;
    }
    const targetTopMm = (topPage + 1) * pageHeightMm;
    offsets.set(cellId, targetTopMm - topMm);
  }
  return offsets;
}

/**
 * Apply straddle offsets to the live DOM by mutating each affected widget's
 * `style.top`. Returns a function that restores the original positions.
 */
function applyPageStraddleAdjustments(
  pageEl: HTMLElement,
  layout: INotebookLayout,
  pageHeightMm: number,
  pageCount: number
): () => void {
  const offsets = computePageStraddleOffsets(layout, pageHeightMm, pageCount);
  if (offsets.size === 0) {
    return () => undefined;
  }
  const restorers: Array<() => void> = [];
  for (const [cellId, offsetMm] of offsets) {
    const elements = pageEl.querySelectorAll<HTMLElement>(
      `[data-cell-id="${CSS.escape(cellId)}"]`
    );
    const offsetPx = mmToPx(offsetMm);
    for (const el of Array.from(elements)) {
      const originalTop = el.style.top;
      const currentTopPx = parseFloat(originalTop) || 0;
      el.style.top = `${currentTopPx + offsetPx}px`;
      restorers.push(() => {
        el.style.top = originalTop;
      });
    }
  }
  return () => {
    for (const r of restorers) {
      r();
    }
  };
}
