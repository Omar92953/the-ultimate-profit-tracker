import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueue, QUEUES } from "../lib/jobs.server";

/** bulk_operations/finish: an import export is ready to download. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const id = (payload as { admin_graphql_api_id: string }).admin_graphql_api_id;
  await enqueue(QUEUES.bulkFinished, { shop, id }, { singletonKey: `finish:${id}` });
  return new Response();
};
