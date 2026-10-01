import db from "../db.server";

/**
 * Daily exchange rates for converting ad spend (e.g. a USD ad account) into the shop currency
 * (e.g. EGP). Source: the free, keyless currency API on jsDelivr (covers EGP, which the ECB
 * doesn't). Rates are cached in FxRate so each day is fetched once.
 */
const SOURCE = (date: string, base: string) =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${base.toLowerCase()}.min.json`;
const FALLBACK = (date: string, base: string) => `https://${date}.currency-api.pages.dev/v1/currencies/${base.toLowerCase()}.min.json`;

const d = (s: string) => new Date(`${s}T00:00:00Z`);

export async function rate(base: string, quote: string, day: string): Promise<number> {
  if (base.toUpperCase() === quote.toUpperCase()) return 1;
  const B = base.toUpperCase();
  const Q = quote.toUpperCase();
  const cached = await db.fxRate.findUnique({ where: { date_base_quote: { date: d(day), base: B, quote: Q } } });
  if (cached) return Number(cached.rate);
  const today = new Date().toISOString().slice(0, 10);
  const fetchDay = day > today ? "latest" : day;
  let value: number | null = null;
  for (const url of [SOURCE(fetchDay, B), FALLBACK(fetchDay, B), SOURCE("latest", B)]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, Record<string, number>>;
      const v = json[B.toLowerCase()]?.[Q.toLowerCase()];
      if (typeof v === "number" && v > 0) {
        value = v;
        break;
      }
    } catch {
      // try the next source
    }
  }
  if (value === null) throw new Error(`No exchange rate for ${B}→${Q} on ${day}`);
  await db.fxRate.upsert({
    where: { date_base_quote: { date: d(day), base: B, quote: Q } },
    create: { date: d(day), base: B, quote: Q, rate: value },
    update: { rate: value },
  });
  return value;
}
