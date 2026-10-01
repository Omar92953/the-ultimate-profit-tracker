import { comparisonRange, readRange, todayIn, type Range } from "./dates";
import { getShop } from "./shop.server";

/** The date range from the URL, in the shop's timezone, plus its comparison range. */
export async function loadRange(request: Request, shop: string) {
  const row = await getShop(shop);
  const today = todayIn(row.timezone);
  const earliest = row.historyFrom ? row.historyFrom.toISOString().slice(0, 10) : null;
  const range: Range = readRange(new URL(request.url).searchParams, today, earliest);
  return { shopRow: row, settings: row.settingsParsed, range, compare: comparisonRange(range), today, earliest, currency: row.currency };
}
