import type { LoaderFunctionArgs } from "react-router";
import { verify } from "../lib/crypto.server";
import { exchangeCode, saveMetaAccounts } from "../lib/ads/meta.server";
import { enqueue, QUEUES } from "../lib/jobs.server";

const page = (title: string, text: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="font:15px system-ui;padding:32px;max-width:520px;margin:auto;color:#303030">
<h2>${ok ? "✅" : "⚠️"} ${title}</h2><p>${text}</p><p>You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage({type:"meta-connected",ok:${ok}},"*")}catch(e){} ${ok ? "setTimeout(function(){window.close()},1500)" : ""}</script></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

/** Facebook sends the merchant back here after they approve. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = verify<{ shop: string; p: string }>(url.searchParams.get("state"));
  if (!state || state.p !== "meta") return page("Link expired", "Please start again from the app's Ads page.", false);
  if (url.searchParams.get("error")) return page("Not connected", url.searchParams.get("error_description") ?? "Facebook didn't grant access.", false);
  const code = url.searchParams.get("code");
  if (!code) return page("Not connected", "Facebook didn't send an approval code.", false);
  try {
    const { token, expiresAt } = await exchangeCode(code);
    const count = await saveMetaAccounts(state.shop, token, expiresAt);
    await enqueue(QUEUES.adsSync, { shop: state.shop });
    return page("Meta connected", `${count} ad account(s) found. Your ad numbers are being imported now.`, true);
  } catch (e) {
    return page("Not connected", e instanceof Error ? e.message : String(e), false);
  }
};
