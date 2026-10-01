import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueue, QUEUES } from "../lib/jobs.server";
import { toGrams } from "../lib/import.server";
import db from "../db.server";

type RestVariant = { id: number; title?: string; sku?: string | null; inventory_item_id?: number; grams?: number; weight?: number; weight_unit?: string };
type RestProduct = { id: number; title: string; vendor?: string; product_type?: string; tags?: string; variants?: RestVariant[] };

const UNIT: Record<string, string> = { g: "GRAMS", kg: "KILOGRAMS", oz: "OUNCES", lb: "POUNDS" };

/** products/create, products/update (titles, tags, variants) and inventory_items/update (unit cost). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  if (topic === "INVENTORY_ITEMS_UPDATE") {
    const item = payload as { id: number; cost?: string | null };
    await enqueue(QUEUES.syncCost, { shop, inventoryItemId: String(item.id), cost: item.cost ?? null }, { singletonKey: `cost:${shop}:${item.id}` });
    return new Response();
  }

  const p = payload as RestProduct;
  const id = BigInt(p.id);
  const tags = (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  await db.product.upsert({
    where: { shop_id: { shop, id } },
    create: { shop, id, title: p.title, vendor: p.vendor ?? null, productType: p.product_type ?? null, tags, collections: [] },
    update: { title: p.title, vendor: p.vendor ?? null, productType: p.product_type ?? null, tags },
  });
  for (const v of p.variants ?? []) {
    const data = {
      productId: id,
      title: v.title ?? null,
      sku: v.sku ?? null,
      inventoryItemId: v.inventory_item_id ? BigInt(v.inventory_item_id) : null,
      weightGrams: v.grams ?? toGrams(v.weight ?? null, UNIT[v.weight_unit ?? "g"]),
    };
    await db.variant.upsert({ where: { shop_id: { shop, id: BigInt(v.id) } }, create: { shop, id: BigInt(v.id), ...data }, update: data });
  }
  return new Response();
};
