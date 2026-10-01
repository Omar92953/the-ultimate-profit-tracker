import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop, saveSettings, startImport } from "../lib/shop.server";
import { enqueueRecompute } from "../lib/jobs.server";
import { todayIn } from "../lib/dates";
import { errorMessage } from "../lib/admin.server";
import type { ShopSettings } from "../lib/settings";
import { Button, Checkbox, NumberField, Select, TextField } from "../components/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const row = await getShop(session.shop);
  const [orders, lastRecompute] = await Promise.all([
    db.order.count({ where: { shop: session.shop } }),
    db.syncLog.findFirst({ where: { shop: session.shop, kind: "recompute" }, orderBy: { startedAt: "desc" } }),
  ]);
  return {
    settings: row.settingsParsed,
    status: {
      importStatus: row.importStatus,
      importKind: row.importKind,
      importError: row.importError,
      importedAt: row.importedAt?.toISOString() ?? null,
      historyFrom: row.historyFrom?.toISOString().slice(0, 10) ?? null,
      orders,
      recompute: lastRecompute ? { status: lastRecompute.status, at: (lastRecompute.finishedAt ?? lastRecompute.startedAt).toISOString(), message: lastRecompute.message } : null,
    },
    timezone: row.timezone,
    currency: row.currency,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  try {
    if (form.get("intent") === "reimport") {
      await startImport(shop);
      return { ok: true, message: "Re-importing from Shopify." };
    }
    const patch = JSON.parse(String(form.get("settings"))) as Partial<ShopSettings>;
    await saveSettings(shop, patch);
    const row = await getShop(shop);
    const today = todayIn(row.timezone);
    await enqueueRecompute(shop, row.historyFrom?.toISOString().slice(0, 10) ?? today, today);
    return { ok: true, message: "Settings saved. Profit is being recalculated." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [s, setS] = useState<ShopSettings>(data.settings);
  const set = <K extends keyof ShopSettings>(k: K, v: ShopSettings[K]) => setS({ ...s, [k]: v });
  const list = (v: string[]) => v.join(", ");
  const parse = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  const st = data.status;
  return (
    <s-page heading="Settings">
      <Button slot="primary-action" variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ settings: JSON.stringify(s) }, { method: "post" })}>
        Save
      </Button>

      <s-section heading="Data from Shopify">
        <s-stack gap="small-200">
          <s-text>
            {st.orders} orders imported{st.historyFrom ? `, from ${st.historyFrom}` : ""}. Status: {st.importStatus}
            {st.importKind ? ` (${st.importKind})` : ""}.
          </s-text>
          {st.importError ? <s-banner tone="critical">{st.importError}</s-banner> : null}
          {st.recompute ? (
            <s-text color="subdued">
              Last profit calculation: {st.recompute.status}, {new Date(st.recompute.at).toLocaleString()}
              {st.recompute.message ? ` — ${st.recompute.message}` : ""}
            </s-text>
          ) : null}
          <s-text color="subdued">
            Shopify gives apps the last 60 days of orders until it approves full-history access; the import picks up older
            orders automatically once it does.
          </s-text>
          <s-stack direction="inline">
            <Button disabled={st.importStatus === "running"} onClick={() => fetcher.submit({ intent: "reimport" }, { method: "post" })}>
              Re-import everything
            </Button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="What counts as sales">
        <s-stack gap="small-200">
          <Checkbox label="Count shipping the customer paid as sales" checked={s.includeShippingRevenue} onValue={(v) => set("includeShippingRevenue", v)} />
          <Checkbox label="Count taxes as sales" details="Usually off: taxes go to the government." checked={s.includeTaxes} onValue={(v) => set("includeTaxes", v)} />
          <Checkbox label="Ignore test orders" checked={s.excludeTestOrders} onValue={(v) => set("excludeTestOrders", v)} />
          <Checkbox label="Returned items go back to stock (their cost isn't a loss)" checked={s.refundedItemsRestocked} onValue={(v) => set("refundedItemsRestocked", v)} />
        </s-stack>
      </s-section>

      <s-section heading="Cash on delivery and returns">
        <s-stack gap="base">
          <TextField label="Payment methods that mean cash on delivery" details="Comma separated; matched against the payment name on the order." value={list(s.codGateways)} onValue={(v) => set("codGateways", parse(v))} />
          <TextField label="Order tags that mean refused / returned" details="For stores that tag refused COD orders instead of refunding them." value={list(s.returnedTags)} onValue={(v) => set("returnedTags", parse(v))} />
          <Checkbox label="A refused COD order earns nothing (revenue = 0)" checked={s.returnedCodZeroRevenue} onValue={(v) => set("returnedCodZeroRevenue", v)} />
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <NumberField label="Default COD fee %" value={s.codFeePct} min={0} max={20} step={0.1} onValue={(v) => set("codFeePct", v)} />
            <NumberField label="Default COD fee (fixed)" suffix={data.currency} value={s.codFeeCents / 100} min={0} step={0.5} onValue={(v) => set("codFeeCents", Math.round(v * 100))} />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="Ad cost per order">
        <s-stack gap="base">
          <Select
            label="How ad spend reaches orders"
            value={s.adCostModel}
            onValue={(v) => set("adCostModel", v as ShopSettings["adCostModel"])}
            options={[
              { value: "attributed_spread", label: "Matched to its ad, the rest shared (recommended)" },
              { value: "attributed_only", label: "Only orders matched to an ad" },
              { value: "blended", label: "All spend shared equally across the day's orders" },
            ]}
            details="Orders matched by UTM or click id carry their own ad's spend. Spend no order could be matched to is shared across that day's other orders, so all spend is counted."
          />
          <NumberField label="Attribution window (days)" value={s.attributionWindowDays} min={1} max={30} step={1} onValue={(v) => set("attributionWindowDays", v)} />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Store">
        <s-stack gap="small-200">
          <s-text>Currency: {data.currency}</s-text>
          <s-text>Timezone: {data.timezone}</s-text>
          <s-text color="subdued">Taken from your Shopify settings. Days are counted in this timezone.</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
