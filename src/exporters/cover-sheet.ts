/**
 * Cover sheet + ToC pages for the bitmap PDF exporter. Pure jsPDF — no
 * html2canvas involvement. Renders directly as PDF text so the cover and
 * ToC are sharp and selectable regardless of the bitmap quality.
 */

import type { jsPDF } from 'jspdf';

import type { ITocHeading } from '../managers/toc';

export interface ICoverSheetData {
  title: string;
  author: string;
  date: string; // already formatted for display, e.g. "30 April 2026"
  includeToc: boolean;
}

export interface IRenderResult {
  /**
   * Number of PDF pages produced before the first content page (i.e. cover
   * + any ToC overflow pages). Caller uses this to compute the offset for
   * content-page numbering.
   */
  pagesBeforeContent: number;
}

const PAGE_MARGIN_MM = 20;
const TITLE_FONT_SIZE = 28;
const SUBTITLE_FONT_SIZE = 14;
const META_FONT_SIZE = 12;
const TOC_HEADER_FONT_SIZE = 18;
const TOC_ENTRY_FONT_SIZE = 11;
const TOC_LINE_HEIGHT_MM = 7;
const TOC_INDENT_PER_LEVEL_MM = 6;
const DOT_LEADER_GAP_MM = 4;

/**
 * Render the cover page (title / author / date) plus optional ToC pages
 * onto the supplied jsPDF instance. Assumes jsPDF was just constructed —
 * we render into the current (first) page and `addPage()` for ToC
 * overflow.
 *
 * Returns the number of pages produced so the caller can offset content
 * pagination. Heading entries get clickable internal-link annotations
 * pointing at the eventual content PDF page (heading.pageNumber +
 * pagesBeforeContent).
 */
export function renderCoverAndToc(
  pdf: jsPDF,
  cover: ICoverSheetData,
  headings: readonly ITocHeading[],
  pageWidthMm: number,
  pageHeightMm: number
): IRenderResult {
  renderCoverPage(pdf, cover, pageWidthMm, pageHeightMm);
  let pagesBeforeContent = 1;
  if (cover.includeToc && headings.length > 0) {
    pagesBeforeContent += renderTocPages(
      pdf,
      headings,
      pageWidthMm,
      pageHeightMm,
      // Pass the current cover-page offset so internal-link page numbers
      // resolve correctly. Each heading's `pageNumber` is 1-based within
      // the layout; PDF page = pageNumber + pagesBeforeContent (final
      // value, computed *after* ToC pagination).
      0 // placeholder; we'll fix up offsets after we know how many ToC pages
    );
    // The link annotations were placed with offset 0 because we didn't
    // know the final ToC page count yet. Re-render annotations with the
    // correct offset now that we know.
    rewriteTocLinkAnnotations(
      pdf,
      headings,
      pagesBeforeContent,
      pageWidthMm,
      pageHeightMm
    );
  }
  return { pagesBeforeContent };
}

function renderCoverPage(
  pdf: jsPDF,
  cover: ICoverSheetData,
  pageWidthMm: number,
  pageHeightMm: number
): void {
  const centreX = pageWidthMm / 2;
  // Anchor the title block at ~38% down the page — visually balanced for
  // A4 portrait without looking top-heavy.
  const titleY = pageHeightMm * 0.38;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(TITLE_FONT_SIZE);
  pdf.setTextColor(20, 20, 20);
  drawCenteredWrapped(
    pdf,
    cover.title,
    centreX,
    titleY,
    pageWidthMm - 2 * PAGE_MARGIN_MM,
    TITLE_FONT_SIZE
  );

  // Underline rule
  const ruleY = titleY + TITLE_FONT_SIZE * 0.5;
  pdf.setDrawColor(120, 120, 120);
  pdf.setLineWidth(0.3);
  pdf.line(
    pageWidthMm * 0.25,
    ruleY,
    pageWidthMm * 0.75,
    ruleY
  );

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(SUBTITLE_FONT_SIZE);
  pdf.setTextColor(60, 60, 60);
  if (cover.author) {
    pdf.text(cover.author, centreX, ruleY + 14, { align: 'center' });
  }
  pdf.setFontSize(META_FONT_SIZE);
  pdf.setTextColor(100, 100, 100);
  if (cover.date) {
    pdf.text(cover.date, centreX, ruleY + 24, { align: 'center' });
  }
}

/**
 * Render ToC entries across as many pages as needed. Each entry is one
 * line with: indent by level + heading text + dotted leader + page number.
 * Page numbers reference the heading's content page; an internal-link
 * annotation overlays each row pointing at that page.
 *
 * `pageNumberOffset` is added to each heading's pageNumber (1-based
 * within the layout) when computing the link target. Caller may pass 0
 * during the first pass and call `rewriteTocLinkAnnotations` afterwards
 * with the real offset; the visible "page N" text on each row uses the
 * final offset directly via that second call.
 *
 * Returns the number of *additional* pages added on top of the page that
 * was already current when this function was called. (Caller has already
 * counted the cover page.)
 */
function renderTocPages(
  pdf: jsPDF,
  headings: readonly ITocHeading[],
  pageWidthMm: number,
  pageHeightMm: number,
  _pageNumberOffset: number
): number {
  pdf.addPage();
  let extraPages = 1;
  let cursorY = renderTocHeader(pdf, pageWidthMm);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(TOC_ENTRY_FONT_SIZE);
  pdf.setTextColor(40, 40, 40);
  const bottomLimit = pageHeightMm - PAGE_MARGIN_MM;
  const leftMargin = PAGE_MARGIN_MM;
  const rightMargin = pageWidthMm - PAGE_MARGIN_MM;
  for (const h of headings) {
    if (cursorY + TOC_LINE_HEIGHT_MM > bottomLimit) {
      pdf.addPage();
      extraPages++;
      cursorY = renderTocContinuationHeader(pdf, pageWidthMm);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(TOC_ENTRY_FONT_SIZE);
      pdf.setTextColor(40, 40, 40);
    }
    const indent = (h.level - 1) * TOC_INDENT_PER_LEVEL_MM;
    const xText = leftMargin + indent;
    const pageStr = `${h.pageNumber}`;
    const pageWidth = pdf.getTextWidth(pageStr);
    const xPage = rightMargin - pageWidth;
    // Truncate text if it would overlap the page-number column.
    const availableWidth =
      xPage - xText - DOT_LEADER_GAP_MM;
    const fittedText = fitTextToWidth(pdf, h.text, availableWidth);
    pdf.text(fittedText, xText, cursorY);
    pdf.text(pageStr, xPage, cursorY);
    // Dot-leader between text and page number.
    const textWidth = pdf.getTextWidth(fittedText);
    const dotsStart = xText + textWidth + DOT_LEADER_GAP_MM / 2;
    const dotsEnd = xPage - DOT_LEADER_GAP_MM / 2;
    if (dotsEnd > dotsStart) {
      drawDotLeader(pdf, dotsStart, dotsEnd, cursorY - 1);
    }
    cursorY += TOC_LINE_HEIGHT_MM;
  }
  return extraPages;
}

function renderTocHeader(pdf: jsPDF, pageWidthMm: number): number {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(TOC_HEADER_FONT_SIZE);
  pdf.setTextColor(20, 20, 20);
  const headerY = PAGE_MARGIN_MM + 8;
  pdf.text('Contents', PAGE_MARGIN_MM, headerY);
  // Underline rule.
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  pdf.line(
    PAGE_MARGIN_MM,
    headerY + 3,
    pageWidthMm - PAGE_MARGIN_MM,
    headerY + 3
  );
  return headerY + 12;
}

function renderTocContinuationHeader(pdf: jsPDF, pageWidthMm: number): number {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(140, 140, 140);
  const y = PAGE_MARGIN_MM;
  pdf.text(
    'Contents (continued)',
    pageWidthMm - PAGE_MARGIN_MM,
    y,
    { align: 'right' }
  );
  return PAGE_MARGIN_MM + 8;
}

/**
 * Truncate `text` so its rendered width stays under `maxWidth` (mm).
 * Falls back to the original text if it already fits. Adds an ellipsis
 * when truncating.
 */
function fitTextToWidth(pdf: jsPDF, text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  if (pdf.getTextWidth(text) <= maxWidth) {
    return text;
  }
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (pdf.getTextWidth(candidate) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ellipsis;
}

function drawDotLeader(
  pdf: jsPDF,
  startX: number,
  endX: number,
  y: number
): void {
  const dotSpacing = 1.6; // mm — tight enough to read as a leader, sparse enough not to cluster
  pdf.setFillColor(160, 160, 160);
  for (let x = startX; x <= endX; x += dotSpacing) {
    pdf.circle(x, y, 0.18, 'F');
  }
}

/**
 * Place internal-link annotations on each ToC row pointing at the
 * heading's final PDF page. Walks every ToC page (page 2 onward, since
 * page 1 is the cover) and emits one rect per heading row.
 *
 * This is called after `renderTocPages` so we know the total ToC page
 * count and can compute the right `pageNumber` for each link.
 */
function rewriteTocLinkAnnotations(
  pdf: jsPDF,
  headings: readonly ITocHeading[],
  pagesBeforeContent: number,
  pageWidthMm: number,
  pageHeightMm: number
): void {
  // Reproduce the same per-page layout decisions made in renderTocPages.
  // Cover is page 1 → ToC starts on PDF page 2.
  let pdfPage = 2;
  pdf.setPage(pdfPage);
  let cursorY = PAGE_MARGIN_MM + 8 + 12; // header + spacer (matches renderTocHeader)
  const bottomLimit = pageHeightMm - PAGE_MARGIN_MM;
  const leftMargin = PAGE_MARGIN_MM;
  const rightMargin = pageWidthMm - PAGE_MARGIN_MM;
  for (const h of headings) {
    if (cursorY + TOC_LINE_HEIGHT_MM > bottomLimit) {
      pdfPage++;
      pdf.setPage(pdfPage);
      cursorY = PAGE_MARGIN_MM + 8; // continuation header consumes 8 mm
    }
    const indent = (h.level - 1) * TOC_INDENT_PER_LEVEL_MM;
    const xText = leftMargin + indent;
    const rowWidth = rightMargin - xText;
    const targetPdfPage = h.pageNumber + pagesBeforeContent;
    pdf.link(
      xText,
      cursorY - TOC_LINE_HEIGHT_MM + 2,
      rowWidth,
      TOC_LINE_HEIGHT_MM,
      { pageNumber: targetPdfPage }
    );
    cursorY += TOC_LINE_HEIGHT_MM;
  }
}

/**
 * Centre-justify and wrap `text` at `maxWidth` (mm), drawing each line
 * stacked downward from `(centreX, topY)`. Used for the cover title
 * which may be long.
 */
function drawCenteredWrapped(
  pdf: jsPDF,
  text: string,
  centreX: number,
  topY: number,
  maxWidth: number,
  fontSizePt: number
): void {
  const lines = pdf.splitTextToSize(text, maxWidth);
  const lineHeightMm = (fontSizePt * 25.4) / 72 * 1.2;
  const arr = Array.isArray(lines) ? lines : [lines];
  for (let i = 0; i < arr.length; i++) {
    pdf.text(arr[i], centreX, topY + i * lineHeightMm, { align: 'center' });
  }
}

/** Format a Date as "30 April 2026" — readable, locale-stable. */
export function formatCoverDate(date: Date): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
