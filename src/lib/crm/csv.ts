import Papa from "papaparse";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/** Parses an uploaded CSV (UTF-8, optional BOM; comma, semicolon or tab separated) */
export function parseCsv(data: Buffer | string): ParsedCsv {
  const raw = typeof data === "string" ? data : data.toString("utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip the BOM Excel adds
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: "" });
  const all = result.data.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const [header = [], ...rows] = all;
  return { header: header.map((h, i) => h || `Column ${i + 1}`), rows };
}

/**
 * One CSV cell. Values that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a
 * leading apostrophe so an exported file can't execute anything when opened (CSV injection).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** Splits a "tags" cell: "VIP, Delhi; Wholesale" -> ["VIP", "Delhi", "Wholesale"] */
export function splitTags(cell: string): string[] {
  return [
    ...new Set(
      cell
        .split(/[,;|]/)
        .map((t) => t.trim().slice(0, 30))
        .filter(Boolean),
    ),
  ];
}
