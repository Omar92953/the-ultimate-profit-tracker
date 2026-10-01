import type { LoaderFunctionArgs } from "react-router";
import { verify } from "../lib/crypto.server";
import { metaConfigured, metaDialogUrl } from "../lib/ads/meta.server";

/** Opened in a popup from the Ads page: checks the signed shop note, then sends the merchant to Facebook. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const state = new URL(request.url).searchParams.get("state");
  if (!metaConfigured() || !verify<{ shop: string; p: string }>(state)) return new Response("This link has expired. Close this window and try again.", { status: 400 });
  return Response.redirect(metaDialogUrl(state!), 302);
};
