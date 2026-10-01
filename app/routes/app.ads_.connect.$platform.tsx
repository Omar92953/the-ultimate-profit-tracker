import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop, saveSettings } from "../lib/shop.server";
import { sign } from "../lib/crypto.server";
import { googleAdsScript } from "../lib/ads/google";
import { connectMetaKey, uploadAdReport } from "../lib/ads/actions.server";
import { errorMessage } from "../lib/admin.server";
import { googleSteps, hasIds, idsFromUrl, metaKeySteps, metaUploadSteps, PERSONALISE, tiktokSteps, type AdIds, type GuidePlatform, type GuideStep } from "../lib/ads/guides";
import { Button, Checkbox, TextArea, TextField } from "../components/fields";
import { copyText } from "../components/copy";

const TITLES: Record<GuidePlatform, string> = { meta: "Connect Meta (Facebook & Instagram)", google: "Connect Google Ads", tiktok: "Connect TikTok" };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const platform = params.platform as GuidePlatform;
  if (!["meta", "google", "tiktok"].includes(platform)) throw new Response("Not found", { status: 404 });
  const row = await getShop(session.shop);
  const method = new URL(request.url).searchParams.get("method") === "upload" ? "upload" : "auto";
  const accounts = await db.adAccount.findMany({ where: { shop: session.shop, platform }, select: { name: true, lastSyncedAt: true, lastError: true, accessToken: true } });
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return {
    platform,
    method,
    ids: row.settingsParsed.adIds ?? {},
    done: row.settingsParsed.guideDone ?? [],
    accounts: accounts.map((a) => ({ name: a.name, lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null, lastError: a.lastError, viaKey: !!a.accessToken })),
    googleScript: platform === "google" ? googleAdsScript(`${appUrl}/ingest/google?key=${encodeURIComponent(sign({ shop: session.shop, p: "google" }, 60 * 60 * 24 * 365 * 5))}`) : "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "personalise") {
      const found = idsFromUrl(String(form.get("url") ?? ""));
      if (!Object.keys(found).length) return { ok: false, message: "No account found in that link. Copy the whole address from the top of your Ads Manager." };
      const row = await getShop(shop);
      const adIds: AdIds = { ...(row.settingsParsed.adIds ?? {}), ...found };
      await saveSettings(shop, { adIds });
      return { ok: true, message: "Done: the buttons now open your own account." };
    }
    if (intent === "forget") {
      await saveSettings(shop, { adIds: {} });
      return { ok: true, message: "Account links cleared." };
    }
    if (intent === "done") {
      const row = await getShop(shop);
      const id = String(form.get("id"));
      const set = new Set(row.settingsParsed.guideDone ?? []);
      if (form.get("on") === "true") set.add(id);
      else set.delete(id);
      await saveSettings(shop, { guideDone: [...set] });
      return { ok: true, message: "" };
    }
    if (intent === "meta_token") return await connectMetaKey(shop, String(form.get("token") ?? ""));
    if (intent === "upload") return await uploadAdReport(shop, String(form.get("csv") ?? ""), String(form.get("fileName") ?? ""), String(form.get("platform") ?? "auto"));
    return { ok: false, message: "Unknown action." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

export default function ConnectGuide() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [pasted, setPasted] = useState("");
  const [token, setToken] = useState("");
  const p = data.platform as GuidePlatform;
  const ids = data.ids as AdIds;
  const personalised = hasIds(p, ids);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok, duration: 6000 });
  }, [fetcher.state, fetcher.data, shopify]);

  const steps: GuideStep[] =
    p === "meta" ? (data.method === "upload" ? metaUploadSteps(ids) : metaKeySteps(ids)) : p === "google" ? googleSteps(ids, data.googleScript) : tiktokSteps(ids);
  const doneCount = steps.filter((s) => data.done.includes(s.id)).length;

  const copy = async (value: string) =>
    (await copyText(value)) ? shopify.toast.show("Copied") : shopify.toast.show("Couldn't copy: select the text and copy it", { isError: true });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      shopify.toast.show("Please export the report as CSV.", { isError: true });
      return;
    }
    fetcher.submit({ intent: "upload", csv: await file.text(), fileName: file.name, platform: p }, { method: "post" });
  };

  return (
    <s-page heading={TITLES[p]}>
      <s-link slot="breadcrumb-actions" href="/app/ads">
        Ads
      </s-link>

      <s-section heading={personalised ? "Your account is linked" : "First: link your account (10 seconds)"}>
        <s-stack gap="base">
          {personalised ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text color="subdued">{describeIds(p, ids)}. Every button below opens this account.</s-text>
              <Button variant="tertiary" onClick={() => fetcher.submit({ intent: "forget" }, { method: "post" })}>
                Use another account
              </Button>
            </s-stack>
          ) : (
            <>
              <s-paragraph>So each button opens your own account on the right page:</s-paragraph>
              <s-ordered-list>
                <s-list-item>
                  <s-link href={PERSONALISE[p].open} target="_blank">
                    {PERSONALISE[p].label} ↗
                  </s-link>
                </s-list-item>
                <s-list-item>{PERSONALISE[p].hint}</s-list-item>
              </s-ordered-list>
              <s-stack direction="inline" gap="base" alignItems="end">
                <TextField label="Link from your browser" placeholder="https://…" value={pasted} onValue={setPasted} />
                <Button variant="primary" disabled={!pasted.trim()} onClick={() => fetcher.submit({ intent: "personalise", url: pasted }, { method: "post" })}>
                  Link my account
                </Button>
              </s-stack>
              <s-text color="subdued">Optional: without it the buttons still work and open the account you used last.</s-text>
            </>
          )}
        </s-stack>
      </s-section>

      <s-section heading={`Steps · ${doneCount} of ${steps.length} done`}>
        <s-stack gap="base">
          {p === "meta" ? (
            <s-stack direction="inline" gap="small-200">
              <Button variant={data.method === "auto" ? "secondary" : "tertiary"} href="/app/ads/connect/meta">
                Automatic (access key)
              </Button>
              <Button variant={data.method === "upload" ? "secondary" : "tertiary"} href="/app/ads/connect/meta?method=upload">
                Upload a report instead
              </Button>
            </s-stack>
          ) : null}
          {steps.map((s, i) => {
            const isDone = data.done.includes(s.id);
            return (
              <s-box key={s.id} padding="base" borderWidth="base" borderRadius="base" background={isDone ? "subdued" : "base"}>
                <s-stack gap="small-200">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
                    <s-heading>
                      {i + 1}. {s.title}
                    </s-heading>
                    <Checkbox label="Done" checked={isDone} onValue={(on) => fetcher.submit({ intent: "done", id: s.id, on: String(on) }, { method: "post" })} />
                  </s-stack>
                  <s-paragraph>{s.body}</s-paragraph>
                  {s.link ? (
                    <s-stack direction="inline">
                      <Button href={s.link.url} target="_blank" icon="external">
                        {s.link.label}
                      </Button>
                    </s-stack>
                  ) : null}
                  {s.copy ? (
                    s.copy.multiline ? (
                      <s-stack gap="small-200">
                        <s-stack direction="inline">
                          <Button icon="clipboard" onClick={() => copy(s.copy!.value)}>
                            Copy {s.copy.label.toLowerCase()}
                          </Button>
                        </s-stack>
                        <pre style={{ maxHeight: 200, overflow: "auto", fontSize: 11, background: "#f7f7f7", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", margin: 0 }}>{s.copy.value}</pre>
                      </s-stack>
                    ) : (
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <code style={{ wordBreak: "break-all", fontSize: 12, background: "#f7f7f7", padding: "6px 8px", borderRadius: 6 }}>{s.copy.value}</code>
                        <Button icon="clipboard" variant="tertiary" onClick={() => copy(s.copy!.value)} accessibilityLabel={`Copy ${s.copy.label}`}>
                          Copy
                        </Button>
                      </s-stack>
                    )
                  ) : null}
                  {s.action === "meta_token" ? (
                    <s-stack direction="inline" gap="base" alignItems="end">
                      <TextArea label="Access key" placeholder="EAAG…" value={token} onValue={setToken} rows={2} />
                      <Button
                        variant="primary"
                        disabled={token.trim().length < 40}
                        loading={fetcher.state !== "idle"}
                        onClick={() => {
                          fetcher.submit({ intent: "meta_token", token }, { method: "post" });
                          setToken("");
                        }}
                      >
                        Connect
                      </Button>
                    </s-stack>
                  ) : null}
                  {s.action === "upload" ? <input aria-label="Report CSV file" type="file" accept=".csv,text/csv" onChange={(e) => upload(e.currentTarget.files?.[0])} /> : null}
                  {s.action === "google_check" || s.action === "meta_token" || s.action === "upload" ? <Status accounts={data.accounts} /> : null}
                  {s.fallback ? <s-text color="subdued">Page looks different? {s.fallback}</s-text> : null}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Status({ accounts }: { accounts: { name: string | null; lastSyncedAt: string | null; lastError: string | null }[] }) {
  if (!accounts.length) return <s-badge>Not connected yet</s-badge>;
  return (
    <s-stack gap="small-300">
      {accounts.map((a, i) =>
        a.lastError ? (
          <s-text key={i} tone="critical">
            {a.name}: {a.lastError}
          </s-text>
        ) : (
          <s-badge key={i} tone="success">
            {`${a.name ?? "Connected"}${a.lastSyncedAt ? ` · updated ${new Date(a.lastSyncedAt).toLocaleString()}` : ""}`}
          </s-badge>
        ),
      )}
    </s-stack>
  );
}

function describeIds(p: GuidePlatform, ids: AdIds): string {
  if (p === "meta") return [ids.metaBusinessId && `Business ${ids.metaBusinessId}`, ids.metaAdAccountId && `ad account ${ids.metaAdAccountId}`].filter(Boolean).join(", ");
  if (p === "google") return `Google Ads account ${ids.googleCustomerId ?? ids.googleOcid}`;
  return `TikTok advertiser ${ids.tiktokAdvertiserId}`;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
