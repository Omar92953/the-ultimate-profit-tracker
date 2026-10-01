/** One-line summary of a cost rule's "applies to" filters, for lists. */
export function describeFilters(f: Record<string, unknown>): string {
  const parts: string[] = [];
  const list = (k: string, label: string) => {
    const v = f[k] as unknown[] | undefined;
    if (v?.length) parts.push(`${label} (${v.length})`);
  };
  list("productIds", "products");
  list("collectionIds", "collections");
  list("tags", "tags");
  list("vendors", "vendors");
  list("zoneIds", "zones");
  list("countryCodes", "countries");
  list("carriers", "carriers");
  list("adPlatforms", "ad platforms");
  list("adCampaignIds", "campaigns");
  list("adIds", "ads");
  list("outcomes", "order status");
  if (f.payment) parts.push(f.payment === "cod" ? "COD orders" : "online payments");
  if (f.customer) parts.push(`${f.customer} customers`);
  return parts.length ? parts.join(", ") : "All orders";
}
