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
import { mmToPx } from '../widgets/units';

const CAPTURE_SCALE = 2;
const EXPORTING_CLASS = 'jp-CellLayout-exporting';

export interface IExportOptions {
  /** Override the output file name (without extension). */
  filename?: string;
}

export class PdfExportError extends Error {}

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

  pageEl.classList.add(EXPORTING_CLASS);
  let fullCanvas: HTMLCanvasElement;
  try {
    fullCanvas = await html2canvas(pageEl, {
      scale: CAPTURE_SCALE,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
  } finally {
    pageEl.classList.remove(EXPORTING_CLASS);
    restoreStraddles();
  }

  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: settings.page_size.toLowerCase() // 'a4' or 'a3'
  });

  const sliceHeightPx = fullCanvas.height / pageCount;
  for (let i = 0; i < pageCount; i++) {
    const dataUrl = sliceToDataUrl(
      fullCanvas,
      0,
      Math.floor(sliceHeightPx * i),
      fullCanvas.width,
      Math.floor(sliceHeightPx)
    );
    if (i > 0) {
      pdf.addPage();
    }
    pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidthMm, pageHeightMm);
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
  return slice.toDataURL('image/png');
}

function deriveFilename(panel: NotebookPanel): string {
  const path = panel.context.path;
  const base = path.split('/').pop() ?? 'notebook';
  return base.replace(/\.ipynb$/i, '');
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
