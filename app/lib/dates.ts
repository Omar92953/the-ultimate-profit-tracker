/**
 * Date ranges as YYYY-MM-DD strings in the shop's timezone, never JS Dates at local midnight
 * (that shifts days across timezones). Kept in the URL: ?from=…&to=…&compare=previous_period
 */
export type Compare = "none" | "previous_period" | "previous_year";
export type Range = { from: string; to: string; preset: string | null; compare: Compare };

export const PRESETS: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_90", label: "Last 90 days" },
  { id: "this_month", label: "Month to date" },
  { id: "last_month", label: "Last month" },
  { id: "this_year", label: "Year to date" },
  { id: "last_12m", label: "Last 12 months" },
  { id: "all", label: "All time" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return ymd(new Date());
  }
}

export function presetRange(id: string, today: string, earliest?: string | null): { from: string; to: string } {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last_7":
      return { from: addDays(today, -6), to: today };
    case "last_90":
      return { from: addDays(today, -89), to: today };
    case "this_month":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "last_month": {
      const end = addDays(`${y}-${pad(m)}-01`, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: today };
    case "last_12m":
      return { from: addDays(today, -364), to: today };
    case "all":
      return { from: earliest ?? addDays(today, -364), to: today };
    case "last_30":
    default:
      return { from: addDays(today, -29), to: today };
  }
}

const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function readRange(params: URLSearchParams, today: string, earliest?: string | null): Range {
  const compare = (["none", "previous_period", "previous_year"] as const).find((c) => c === params.get("compare")) ?? "previous_period";
  const from = params.get("from");
  const to = params.get("to");
  if (isDay(from) && isDay(to) && from <= to) return { from, to, preset: null, compare };
  const preset = params.get("preset") ?? "last_30";
  return { ...presetRange(preset, today, earliest), preset, compare };
}

export function comparisonRange(r: Range): { from: string; to: string } | null {
  if (r.compare === "none") return null;
  if (r.compare === "previous_year") {
    const back = (s: string) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`.replace(/-02-29$/, "-02-28");
    return { from: back(r.from), to: back(r.to) };
  }
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

export function rangeLabel(r: { from: string; to: string; preset?: string | null }): string {
  const p = r.preset ? PRESETS.find((x) => x.id === r.preset) : null;
  if (p) return p.label;
  const f = (s: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parse(s));
  return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
}

/** Group size for charts: days up to ~3 months, then weeks, then months. */
export function bucketFor(from: string, to: string): "day" | "week" | "month" {
  const n = daysBetween(from, to);
  return n <= 92 ? "day" : n <= 366 ? "week" : "month";
}

export function rangeQuery(r: Range): string {
  const q = new URLSearchParams();
  if (r.preset) q.set("preset", r.preset);
  else {
    q.set("from", r.from);
    q.set("to", r.to);
  }
  if (r.compare !== "previous_period") q.set("compare", r.compare);
  return q.toString();
}
