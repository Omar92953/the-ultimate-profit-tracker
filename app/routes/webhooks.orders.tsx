import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueue, enqueueRecompute, QUEUES } from "../lib/jobs.server";
import { deleteOrder } from "../lib/import.server";
import db from "../db.server";

/**
 * orders/create, orders/updated, orders/cancelled, orders/delete, refunds/create.
 * The payload is only used for the order id: the job re-reads the order from Shopify, so the
 * stored data always comes from one place (ORDER_QUERY) and duplicate webhooks collapse.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as { id?: number; admin_graphql_api_id?: string; order_id?: number };

  if (topic === "ORDERS_DELETE") {
    const gid = `gid://shopify/Order/${body.id}`;
    const row = await db.order.findFirst({ where: { shop, id: BigInt(body.id ?? 0) }, select: { day: true } });
    await deleteOrder(shop, gid);
    if (row) {
      const day = row.day.toISOString().slice(0, 10);
      await enqueueRecompute(shop, day, day);
    }
    return new Response();
  }

  const orderGid =
    topic === "REFUNDS_CREATE" ? `gid://shopify/Order/${body.order_id}` : (body.admin_graphql_api_id ?? `gid://shopify/Order/${body.id}`);
  await enqueue(QUEUES.syncOrder, { shop, orderId: orderGid }, { singletonKey: `order:${shop}:${orderGid}`, startAfter: 5 });
  return new Response();
};
