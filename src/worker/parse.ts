// Hand-rolled CSV parser tuned for numeric telemetry logs. Parses directly into
// columnar Float64 arrays (one pass, pre-sized) so the heavy work stays off the
// main thread and avoids the per-cell object churn of general CSV libraries.
//
// Scope: comma-separated, numeric values, optional header row, LF or CRLF line
// endings. Quoted fields are not expected in these logs; a value that fails to
// parse becomes NaN rather than throwing.

const COMMA = 44; // ','
const LF = 10; // '\n'
const CR = 13; // '\r'

export interface RawColumns {
  names: string[];
  /** One Float64Array per column, length === rowCount. */
  columns: Float64Array[];
  rowCount: number;
}

/** Does a string look like a numeric value (vs. a header label)? */
function looksNumeric(s: string): boolean {
  if (s.length === 0) return false;
  const n = Number(s);
  return !Number.isNaN(n);
}

/**
 * Parse CSV text into columnar Float64 arrays.
 *
 * Two passes: first count rows and detect the header, then fill pre-sized
 * arrays. Counting first avoids array growth/reallocation on large files.
 */
export function parseCsv(text: string): RawColumns {
  const len = text.length;
  if (len === 0) throw new Error("Empty file");

  // --- Locate the end of the first (header candidate) line ---
  let firstLineEnd = text.indexOf("\n");
  if (firstLineEnd === -1) firstLineEnd = len;
  const firstLine = stripCr(text.slice(0, firstLineEnd));
  const firstCells = firstLine.split(",");
  const ncols = firstCells.length;
  if (ncols === 0) throw new Error("No columns found");

  // A header row is assumed when any cell in the first line is non-numeric.
  const hasHeader = firstCells.some((c) => !looksNumeric(c.trim()));
  const names = hasHeader
    ? firstCells.map((c, i) => c.trim() || `col${i}`)
    : firstCells.map((_, i) => `col${i}`);

  const dataStart = hasHeader ? firstLineEnd + 1 : 0;

  // --- Pass 1: count data rows (non-empty lines) ---
  let rowCount = 0;
  {
    let i = dataStart;
    let lineHasContent = false;
    for (; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === LF) {
        if (lineHasContent) rowCount++;
        lineHasContent = false;
      } else if (c !== CR) {
        lineHasContent = true;
      }
    }
    if (lineHasContent) rowCount++; // last line without trailing newline
  }

  const columns: Float64Array[] = new Array(ncols);
  for (let c = 0; c < ncols; c++) columns[c] = new Float64Array(rowCount);

  // --- Pass 2: fill columns ---
  let row = 0;
  let col = 0;
  let cellStart = dataStart;
  let lineHasContent = false;

  const commit = (end: number) => {
    // Write the value at [cellStart, end) into the current column/row.
    if (col < ncols) {
      const v = parseCell(text, cellStart, end);
      columns[col][row] = v;
    }
  };

  for (let i = dataStart; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (ch === COMMA) {
      commit(i);
      col++;
      cellStart = i + 1;
      lineHasContent = true;
    } else if (ch === LF) {
      let end = i;
      if (end > cellStart && text.charCodeAt(end - 1) === CR) end--;
      if (lineHasContent || end > cellStart) {
        commit(end);
        // Any missing trailing columns stay 0; fill with NaN instead.
        for (let c = col + 1; c < ncols; c++) columns[c][row] = NaN;
        row++;
      }
      col = 0;
      cellStart = i + 1;
      lineHasContent = false;
    } else if (ch !== CR) {
      lineHasContent = true;
    }
  }
  // Final line without trailing newline.
  if ((lineHasContent || cellStart < len) && row < rowCount) {
    commit(len);
    for (let c = col + 1; c < ncols; c++) columns[c][row] = NaN;
    row++;
  }

  return { names, columns, rowCount };
}

function stripCr(s: string): string {
  return s.charCodeAt(s.length - 1) === CR ? s.slice(0, -1) : s;
}

/** Parse the substring [start, end) as a number; blank/garbage -> NaN. */
function parseCell(text: string, start: number, end: number): number {
  // Trim surrounding spaces cheaply.
  while (start < end && text.charCodeAt(start) === 32) start++;
  while (end > start && text.charCodeAt(end - 1) === 32) end--;
  if (start >= end) return NaN;
  const s = text.slice(start, end);
  const n = Number(s);
  return n; // Number("abc") === NaN, which is what we want.
}
