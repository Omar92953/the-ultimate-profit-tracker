import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/** Sessions go now; the shop's data stays until shop/redact (48 hours later) in case of a reinstall. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  await db.session.deleteMany({ where: { shop } });
  await db.shop.updateMany({ where: { id: shop }, data: { uninstalledAt: new Date(), importStatus: "idle" } });
  return new Response();
};
