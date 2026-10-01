/** Minimal RFC 4180 CSV writer (Excel-friendly: BOM + CRLF, so Arabic text opens correctly). */
const BOM = String.fromCharCode(0xfeff);
const CRLF = "\r\n";

export type Column<T> = { header: string; value: (row: T) => string | number | null | undefined };

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(","), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(","))];
  return BOM + lines.join(CRLF) + CRLF;
}
