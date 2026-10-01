import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { hashCustomer } from "../lib/shopify/mapOrder";
import db from "../db.server";

/**
 * Mandatory privacy webhooks. authenticate.webhook answers 401 to unsigned requests.
 *
 * What this app stores about customers: per order only the shipping zone fields (country,
 * province, city, zip) and a one-way hash of the customer id, used for new-vs-returning and LTV.
 * No names, emails, phones or street addresses.
 *  - customers/data_request: nothing personal to send beyond the order list Shopify already has.
 *  - customers/redact: remove the hash and the city/zip/province from that customer's orders.
 *    Country and the zone link stay so the store's shipping costs remain correct.
 *  - shop/redact (48h after uninstall): delete everything for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_REDACT": {
      const body = payload as { customer?: { id?: number }; orders_to_redact?: number[] };
      const hash = body.customer?.id ? hashCustomer(shop, `gid://shopify/Customer/${body.customer.id}`) : null;
      const ids = (body.orders_to_redact ?? []).map((id) => BigInt(id));
      const anonymise = { customerHash: null, city: null, zip: null, province: null, provinceCode: null };
      if (hash) await db.order.updateMany({ where: { shop, customerHash: hash }, data: anonymise });
      if (ids.length) await db.order.updateMany({ where: { shop, id: { in: ids } }, data: anonymise });
      break;
    }
    case "SHOP_REDACT":
      await deleteShopData(shop);
      break;
    default:
      break;
  }
  return new Response(null, { status: 200 });
};

async function deleteShopData(shop: string): Promise<void> {
  await db.$transaction([
    db.orderCost.deleteMany({ where: { shop } }),
    db.orderLine.deleteMany({ where: { shop } }),
    db.order.deleteMany({ where: { shop } }),
    db.variantCost.deleteMany({ where: { shop } }),
    db.variant.deleteMany({ where: { shop } }),
    db.product.deleteMany({ where: { shop } }),
    db.shippingZone.deleteMany({ where: { shop } }),
    db.adInsightDaily.deleteMany({ where: { shop } }),
    db.adAccount.deleteMany({ where: { shop } }),
    db.costRule.deleteMany({ where: { shop } }),
    db.syncLog.deleteMany({ where: { shop } }),
    db.linkCode.deleteMany({ where: { shop } }),
    db.workspaceStore.deleteMany({ where: { shop } }),
    db.workspace.deleteMany({ where: { ownerShop: shop } }),
    db.session.deleteMany({ where: { shop } }),
    db.shop.deleteMany({ where: { id: shop } }),
  ]);
}
