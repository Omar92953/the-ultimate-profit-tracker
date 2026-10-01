import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadRange } from "../lib/range.server";
import { adsReport } from "../lib/reports.server";
import { sign } from "../lib/crypto.server";
import { metaConfigured, metaRedirectUri, metaStartUrl } from "../lib/ads/meta.server";
import { connectMetaKey, uploadAdReport } from "../lib/ads/actions.server";
import { googleAdsScript } from "../lib/ads/google";
import { enqueue, QUEUES } from "../lib/jobs.server";
import { errorMessage } from "../lib/admin.server";
import { DateRangePicker } from "../components/DateRangePicker";
import { formatValue } from "../components/charts";
import { Button, Checkbox, Select, TextField } from "../components/fields";
import { copyText } from "../components/copy";
import { Card, CardGrid, CardText, GroupTitle, Pill, Toolbar } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const ctx = await loadRange(request, shop);
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const [accounts, rows, matched, total] = await Promise.all([
    db.adAccount.findMany({ where: { shop }, orderBy: [{ platform: "asc" }, { name: "asc" }] }),
    adsReport(shop, ctx.range.from, ctx.range.to),
    db.order.groupBy({ by: ["adPlatform"], where: { shop, day: { gte: d(ctx.range.from), lte: d(ctx.range.to) }, outcome: { not: "cancelled" } }, _count: { _all: true } }),
    db.order.count({ where: { shop, day: { gte: d(ctx.range.from), lte: d(ctx.range.to) }, outcome: { not: "cancelled" } } }),
  ]);
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return {
    range: ctx.range,
    today: ctx.today,
    earliest: ctx.earliest,
    currency: ctx.currency,
    accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.name ?? a.externalId, currency: a.currency, status: a.status, viaKey: !!a.accessToken, lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null, lastError: a.lastError })),
    rows,
    matched: matched.filter((m) => m.adPlatform).reduce((s, m) => s + m._count._all, 0),
    total,
    meta: { oauth: metaConfigured(), redirectUri: metaRedirectUri() },
    googleScript: googleAdsScript(`${appUrl}/ingest/google?key=${encodeURIComponent(sign({ shop, p: "google" }, 60 * 60 * 24 * 365 * 5))}`),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  try {
    if (intent === "meta_oauth") return { ok: true, url: metaStartUrl(shop) };
    if (intent === "meta_token") return await connectMetaKey(shop, String(form.get("token") ?? ""));
    if (intent === "toggle") {
      await db.adAccount.updateMany({ where: { id: String(form.get("id")), shop }, data: { status: form.get("on") === "true" ? "active" : "paused" } });
      return { ok: true, message: "Saved." };
    }
    if (intent === "sync") {
      await enqueue(QUEUES.adsSync, { shop });
      return { ok: true, message: "Syncing. New numbers appear in a minute or two." };
    }
    if (intent === "disconnect") {
      await db.adAccount.updateMany({ where: { id: String(form.get("id")), shop }, data: { accessToken: null, status: "disconnected" } });
      return { ok: true, message: "Disconnected. Past numbers are kept." };
    }
    if (intent === "upload") return await uploadAdReport(shop, String(form.get("csv") ?? ""), String(form.get("fileName") ?? ""), String(form.get("platform") ?? "auto"));
    return { ok: false, message: "Unknown action." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

const PLATFORM_NAME: Record<string, string> = { meta: "Meta", google: "Google Ads", tiktok: "TikTok" };

type Account = ReturnType<typeof useLoaderData<typeof loader>>["accounts"][number];

export default function Ads() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const { revalidate } = useRevalidator();
  const [token, setToken] = useState("");
  const [platform, setPlatform] = useState("auto");
  const fm = (v: number | null) => (v === null ? "–" : formatValue(v, "money", data.currency));

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data as { ok: boolean; message?: string; url?: string };
    if (d.url) window.open(d.url, "meta-connect", "width=640,height=760");
    if (d.message) shopify.toast.show(d.message, { isError: !d.ok, duration: 6000 });
  }, [fetcher.state, fetcher.data, shopify]);

  // The Facebook popup tells us when it's done.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "meta-connected") revalidate();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [revalidate]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      shopify.toast.show("Please export the report as CSV.", { isError: true });
      return;
    }
    fetcher.submit({ intent: "upload", csv: await file.text(), fileName: file.name, platform }, { method: "post" });
  };
  const toggle = (id: string, on: boolean) => fetcher.submit({ intent: "toggle", id, on: String(on) }, { method: "post" });
  const disconnect = (id: string) => fetcher.submit({ intent: "disconnect", id }, { method: "post" });
  const byPlatform = (p: string) => data.accounts.filter((a) => a.platform === p);

  return (
    <s-page heading="Ads" inlineSize="large">
      <s-stack gap="base">
        <Toolbar>
          <DateRangePicker range={data.range} today={data.today} earliest={data.earliest} />
        </Toolbar>

        <GroupTitle>Ad accounts</GroupTitle>
        <CardGrid cols={3}>
          <PlatformCard
            title="Meta (Facebook & Instagram)"
            accounts={byPlatform("meta")}
            text="Automatic: paste a read-only access key from your own Meta Business account. Or upload reports."
            primary={<Button variant="primary" href="/app/ads/connect/meta">{byPlatform("meta").length ? "Manage" : "Connect"}</Button>}
            secondary={<Button variant="tertiary" commandFor="meta-key">I have a key</Button>}
            onToggle={toggle}
            onDisconnect={disconnect}
          />
          <PlatformCard
            title="Google Ads"
            accounts={byPlatform("google")}
            text="Automatic: a small script in your Google Ads account sends your numbers every day."
            primary={<Button variant="primary" href="/app/ads/connect/google">{byPlatform("google").length ? "Manage" : "Connect"}</Button>}
            onToggle={toggle}
            onDisconnect={disconnect}
          />
          <PlatformCard
            title="TikTok"
            accounts={byPlatform("tiktok")}
            text="Export your TikTok Ads report and upload it. The guide opens the right pages for you."
            primary={<Button variant="primary" href="/app/ads/connect/tiktok">{byPlatform("tiktok").length ? "Manage" : "Connect"}</Button>}
            onToggle={toggle}
            onDisconnect={disconnect}
          />
        </CardGrid>

        <CardGrid cols={2}>
          <Card
            title="Upload an ad report"
            badge={<Pill>Any platform</Pill>}
            actions={
              <>
                <Select label="Platform" labelAccessibilityVisibility="exclusive" value={platform} onValue={setPlatform} options={[{ value: "auto", label: "Detect platform" }, { value: "meta", label: "Meta" }, { value: "tiktok", label: "TikTok" }, { value: "google", label: "Google Ads" }]} />
                <input aria-label="Ad report CSV file" type="file" accept=".csv,text/csv" onChange={(e) => upload(e.currentTarget.files?.[0])} />
              </>
            }
          >
            <CardText>Export the report by Day as CSV and choose it here. Uploading the same days again replaces them, never doubles them.</CardText>
          </Card>
          <Card
            title="Orders matched to their ad"
            badge={<Pill tone={data.total && data.matched / data.total > 0.5 ? "ok" : "warn"}>{`${data.matched} of ${data.total}`}</Pill>}
            actions={
              <>
                {data.accounts.some((a) => a.viaKey) ? (
                  <Button onClick={() => fetcher.submit({ intent: "sync" }, { method: "post" })} icon="refresh">
                    Sync now
                  </Button>
                ) : null}
                <Button variant="tertiary" href="/app/ads/connect/meta">
                  Set up URL parameters
                </Button>
              </>
            }
          >
            <CardText>Orders that came from an ad carry that ad&apos;s own cost. Add the URL parameters (last step of each guide) so new orders are matched to their exact ad.</CardText>
          </Card>
        </CardGrid>

        {data.rows.length ? (
          <s-section heading="Ads" padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Ad</s-table-header>
                <s-table-header>Campaign</s-table-header>
                <s-table-header>Platform</s-table-header>
                <s-table-header format="numeric">Spend</s-table-header>
                <s-table-header format="numeric">Platform purchases</s-table-header>
                <s-table-header format="numeric">Shopify orders</s-table-header>
                <s-table-header format="numeric">Real CPA</s-table-header>
                <s-table-header format="numeric">Real ROAS</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">Net profit</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((r) => (
                  <s-table-row key={`${r.platform}${r.adId}`}>
                    <s-table-cell>{r.adName}</s-table-cell>
                    <s-table-cell>{r.campaignName}</s-table-cell>
                    <s-table-cell>{PLATFORM_NAME[r.platform] ?? r.platform}</s-table-cell>
                    <s-table-cell>{fm(r.spend)}</s-table-cell>
                    <s-table-cell>{Math.round(r.purchases * 10) / 10}</s-table-cell>
                    <s-table-cell>{r.orders}</s-table-cell>
                    <s-table-cell>{r.orders ? fm(r.spend / r.orders) : "–"}</s-table-cell>
                    <s-table-cell>{r.spend ? (r.revenue / r.spend).toFixed(2) : "–"}</s-table-cell>
                    <s-table-cell>{fm(r.profit)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        ) : null}
      </s-stack>

      <s-modal id="meta-key" heading="Connect Meta with an access key">
        <s-stack gap="base">
          <s-paragraph>About 5 minutes, once. You create a read-only key in your own Meta Business account; the app never sees your password.</s-paragraph>
          <s-ordered-list>
            <s-list-item>developers.facebook.com → My Apps → Create app → use case “Measure ad performance data with Marketing API” → Create.</s-list-item>
            <s-list-item>business.facebook.com → Settings → Users → System users → Add → name “Profit Tracker”, role Employee.</s-list-item>
            <s-list-item>Assign assets → Ad accounts → choose your ad account(s) → “View performance” → Save.</s-list-item>
            <s-list-item>Settings → Accounts → Apps: add the app you created. Then on the system user: Generate token → that app → expiry “Never” → tick ads_read → Generate.</s-list-item>
            <s-list-item>Copy the token and paste it here.</s-list-item>
          </s-ordered-list>
          <TextField label="Access token" placeholder="EAAG…" value={token} onValue={setToken} />
          <s-stack direction="inline" gap="small-200" justifyContent="end">
            <Button commandFor="meta-key" command="--hide">
              Cancel
            </Button>
            <Button
              variant="primary"
              commandFor="meta-key"
              command="--hide"
              disabled={token.trim().length < 40}
              onClick={() => {
                fetcher.submit({ intent: "meta_token", token }, { method: "post" });
                setToken("");
              }}
            >
              Connect
            </Button>
          </s-stack>
        </s-stack>
      </s-modal>

      <s-modal id="google-script" heading="Google Ads daily sync">
        <s-stack gap="base">
          <s-ordered-list>
            <s-list-item>Google Ads → Tools → Bulk actions → Scripts → the blue + button.</s-list-item>
            <s-list-item>Replace what&apos;s there with the script below, click Authorize, then Run once.</s-list-item>
            <s-list-item>Set Frequency to Daily and save. Your numbers arrive here every day.</s-list-item>
          </s-ordered-list>
          <s-stack direction="inline">
            <Button
              icon="clipboard"
              onClick={async () => {
                if (await copyText(data.googleScript)) shopify.toast.show("Script copied");
                else shopify.toast.show("Copy failed: select the text and copy it", { isError: true });
              }}
            >
              Copy script
            </Button>
          </s-stack>
          <pre style={{ maxHeight: 260, overflow: "auto", fontSize: 11, background: "#f7f7f7", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>{data.googleScript}</pre>
          <s-text color="subdued">The script contains a private key for your store, so don&apos;t share it.</s-text>
        </s-stack>
      </s-modal>
    </s-page>
  );
}

function PlatformCard(props: {
  title: string;
  text: string;
  accounts: Account[];
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  onToggle: (id: string, on: boolean) => void;
  onDisconnect: (id: string) => void;
}) {
  const connected = props.accounts.some((a) => a.status === "active");
  const failed = props.accounts.some((a) => a.lastError);
  return (
    <Card
      title={props.title}
      badge={<Pill tone={failed ? "warn" : connected ? "ok" : "muted"}>{failed ? "Needs attention" : connected ? "Connected" : "Not connected"}</Pill>}
      actions={
        <>
          {props.primary}
          {props.secondary}
        </>
      }
    >
      <CardText>{props.text}</CardText>
      {props.accounts.length ? <AccountList accounts={props.accounts} onToggle={props.onToggle} onDisconnect={props.onDisconnect} /> : null}
    </Card>
  );
}

function AccountList(props: { accounts: Account[]; onToggle: (id: string, on: boolean) => void; onDisconnect: (id: string) => void }) {
  return (
    <s-stack gap="small-300">
      {props.accounts.map((a) => (
        <s-stack key={a.id} gap="small-300">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <Checkbox label={a.name} checked={a.status === "active"} onValue={(on) => props.onToggle(a.id, on)} />
            {a.viaKey ? (
              <Button variant="tertiary" tone="critical" onClick={() => props.onDisconnect(a.id)}>
                Disconnect
              </Button>
            ) : null}
          </s-stack>
          {a.lastError ? (
            <s-text tone="critical">{a.lastError}</s-text>
          ) : (
            <s-text color="subdued">{a.lastSyncedAt ? `Updated ${new Date(a.lastSyncedAt).toLocaleString()}` : "Waiting for first sync"}</s-text>
          )}
        </s-stack>
      ))}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
