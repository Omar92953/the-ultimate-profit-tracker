/** Money is stored as whole cents (amount × 100) in the shop's currency. */
export function toCents(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === "") return 0;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function formatMoney(cents: number, currency: string, locale = "en"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Split `total` cents across weights so the parts always add up exactly to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const safe = sum > 0 ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1);
  const safeSum = sum > 0 ? sum : weights.length;
  const raw = safe.map((w) => (total * w) / safeSum);
  const parts = raw.map((r) => Math.floor(r));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  // Hand out the leftover cents to the largest remainders first.
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) parts[order[k][1]] += 1;
  return parts;
}

export function gidToNumber(gid: string | null | undefined): bigint | null {
  if (!gid) return null;
  const m = /(\d+)(?:\?.*)?$/.exec(gid);
  return m ? BigInt(m[1]) : null;
}
