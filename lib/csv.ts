export type CsvData = { headers: string[]; rows: Record<string, string>[] };
export type DateFormat = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";

export function parseCsv(text: string): CsvData {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(clean);
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); matrix.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.trim()); matrix.push(row); }
  const nonEmpty = matrix.filter((values) => values.some(Boolean));
  if (!nonEmpty.length) throw new Error("The CSV file is empty.");

  const headerIndex = nonEmpty.findIndex((values) => {
    const names = values.map((value) => value.toLowerCase().replace(/[^a-z]/g, ""));
    return names.some((name) => /^(date|transactiondate|postingdate|valuedate)$/.test(name))
      && names.some((name) => /^(description|details|payee|transactiondescription|narrative)$/.test(name));
  });
  const start = headerIndex >= 0 ? headerIndex : 0;
  const rawHeaders = nonEmpty[start];
  const headers = rawHeaders.map((header, index) => {
    const fallback = `Column ${index + 1}`;
    const base = header || fallback;
    const duplicates = rawHeaders.slice(0, index).filter((item) => (item || fallback) === base).length;
    return duplicates ? `${base} (${duplicates + 1})` : base;
  });
  const rows = nonEmpty.slice(start + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  return { headers, rows };
}

function detectDelimiter(text: string) {
  // Inspect all records: CIBC Caribbean begins with blank lines and single-cell metadata.
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && text[i] in counts) counts[text[i]]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || /-$/.test(trimmed);
  const normalized = trimmed.replace(/[^0-9.-]/g, "").replace(/(?!^)-/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function parseDate(value: string, format: DateFormat): string | null {
  const trimmed = value.trim().split(/[ T]/)[0];
  const parts = trimmed.split(/[-/.]/).map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  let year: number; let month: number; let day: number;
  if (format === "yyyy-mm-dd") [year, month, day] = parts;
  else if (format === "mm/dd/yyyy") [month, day, year] = parts;
  else [day, month, year] = parts;
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const today = new Date(); today.setUTCHours(23, 59, 59, 999);
  if (date > today) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
