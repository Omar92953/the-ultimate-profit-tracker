import type { AdminClient } from "./admin.server";
import { ORDER_CUSTOMERS } from "./shopify/queries";

export type CustomerName = { name: string | null; email: string | null; customerId: string | null };

/**
 * Names and emails for the orders on screen, read live from Shopify (never stored).
 * Returns an empty map if Shopify hasn't granted the Name/Email fields, so pages still work.
 */
export async function customerNames(admin: AdminClient, orderIds: string[]): Promise<Map<string, CustomerName>> {
  const out = new Map<string, CustomerName>();
  if (!orderIds.length) return out;
  try {
    for (let i = 0; i < orderIds.length; i += 100) {
      const ids = orderIds.slice(i, i + 100).map((id) => `gid://shopify/Order/${id}`);
      const res = await admin.graphql(ORDER_CUSTOMERS, { variables: { ids } });
      const json = (await res.json()) as { data?: { nodes?: ({ id: string; customer?: { id: string; displayName?: string | null; email?: string | null } | null } | null)[] } };
      for (const node of json.data?.nodes ?? []) {
        if (!node) continue;
        out.set(node.id.split("/").pop()!, {
          name: node.customer?.displayName ?? null,
          email: node.customer?.email ?? null,
          customerId: node.customer?.id.split("/").pop() ?? null,
        });
      }
    }
  } catch (e) {
    console.warn("[customerNames] not available:", e instanceof Error ? e.message : e);
  }
  return out;
}
