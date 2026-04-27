/**
 * Quote-aware CSV parser. Handles `,` inside `"..."` quoted fields,
 * `""` as an escaped quote inside a quoted field, and CRLF / LF line
 * endings. No Papa Parse dependency — the data goes through one render
 * pass and gets truncated to a preview window, so a small handwritten
 * splitter is enough.
 *
 * Returns rows as `string[]`. The caller decides whether to treat the
 * first row as a header.
 */
export function parseCsv(input: string, maxRows: number = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      // Skip \r\n pair so we don't emit an empty row.
      if (ch === "\r" && input[i + 1] === "\n") {
        i++;
      }
      // Don't push completely-blank lines that come from trailing newlines.
      if (!(row.length === 1 && row[0] === "")) {
        rows.push(row);
        if (rows.length >= maxRows) {
          return rows;
        }
      }
      row = [];
      continue;
    }
    field += ch;
  }
  // Flush trailing field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Count lines fast without parsing — used to report "and N more rows" in
 * the truncated CSV preview. Counts \n; treats \r\n and \n the same; a
 * trailing newline does not count as an extra row.
 */
export function countCsvLines(input: string): number {
  if (input.length === 0) return 0;
  let count = 0;
  let sawContent = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\n") {
      count++;
      sawContent = false;
    } else if (ch === "\r") {
      // \r\n handled by the \n branch on the next iteration.
      if (input[i + 1] !== "\n") {
        count++;
        sawContent = false;
      }
    } else {
      sawContent = true;
    }
  }
  if (sawContent) count++;
  return count;
}
