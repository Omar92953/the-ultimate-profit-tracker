import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop } from "../lib/shop.server";
import { enqueueRecompute } from "../lib/jobs.server";
import { addDays, todayIn } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { errorMessage } from "../lib/admin.server";
import { loadCalc, toCalcRule } from "../lib/recompute.server";
import { applyRules, RULE_TEMPLATES, type RuleFilters, type RuleKind } from "../lib/profit/rules";
import { orderCogs, orderRevenue } from "../lib/profit/order";
import type { Ref } from "../lib/types";
import { ResourceList } from "../components/ResourceList";
import { Button, Checkbox, DateField, NumberField, Select, Switch, TextField } from "../components/fields";

type Form = {
  name: string;
  active: boolean;
  kind: RuleKind;
  amount: number; // whole currency units, or percent
  period: "daily" | "weekly" | "monthly";
  distribute: "even" | "revenue" | "items";
  startsOn: string;
  endsOn: string;
  filters: RuleFilters & { productRefs?: Ref[]; collectionRefs?: Ref[] };
};

const isPct = (k: RuleKind) => k === "pct_revenue" || k === "pct_gross_profit";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const row = await getShop(shop);
  const [zones, carriers, campaigns] = await Promise.all([
    db.shippingZone.findMany({ where: { shop }, orderBy: { orderCount: "desc" }, select: { id: true, label: true, countryCode: true } }),
    db.order.groupBy({ by: ["carrier"], where: { shop, carrier: { not: null } }, _count: { _all: true }, orderBy: { _count: { carrier: "desc" } }, take: 20 }),
    db.adInsightDaily.groupBy({ by: ["platform", "campaignId", "campaignName"], where: { shop }, _sum: { spendShopCents: true }, orderBy: { _sum: { spendShopCents: "desc" } }, take: 50 }),
  ]);
  let form: Form;
  let isNew = true;
  if (params.id && params.id !== "new") {
    const r = await db.costRule.findFirst({ where: { id: params.id, shop } });
    if (!r) throw new Response("Not found", { status: 404 });
    isNew = false;
    form = {
      name: r.name,
      active: r.active,
      kind: r.kind as RuleKind,
      amount: isPct(r.kind as RuleKind) ? Number(r.amount) : Number(r.amount) / 100,
      period: (r.period as Form["period"]) ?? "monthly",
      distribute: (r.distribute as Form["distribute"]) ?? "even",
      startsOn: r.startsOn ? r.startsOn.toISOString().slice(0, 10) : "",
      endsOn: r.endsOn ? r.endsOn.toISOString().slice(0, 10) : "",
      filters: r.filters as Form["filters"],
    };
  } else {
    const t = RULE_TEMPLATES.find((x) => x.id === new URL(request.url).searchParams.get("template"));
    form = {
      name: t?.name ?? "",
      active: true,
      kind: t?.kind ?? "per_order",
      amount: t ? (isPct(t.kind) ? t.amount : t.amount / 100) : 0,
      period: t?.period ?? "monthly",
      distribute: t?.distribute ?? "even",
      startsOn: "",
      endsOn: "",
      filters: t?.filters ?? {},
    };
  }
  return {
    id: isNew ? null : params.id!,
    form,
    currency: row.currency,
    zones,
    countries: [...new Set(zones.map((z) => z.countryCode))],
    carriers: carriers.map((c) => c.carrier!),
    campaigns: campaigns.map((c) => ({ id: c.campaignId, name: c.campaignName ?? c.campaignId, platform: c.platform })),
  };
};

function toRow(form: Form) {
  return {
    name: form.name.trim() || "Extra cost",
    active: form.active,
    kind: form.kind,
    amount: isPct(form.kind) ? form.amount : Math.round(form.amount * 100),
    period: form.kind === "period_amount" ? form.period : null,
    distribute: form.kind === "period_amount" ? form.distribute : null,
    startsOn: form.startsOn ? new Date(`${form.startsOn}T00:00:00Z`) : null,
    endsOn: form.endsOn ? new Date(`${form.endsOn}T00:00:00Z`) : null,
    filters: form.filters,
  };
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const data = await request.formData();
  const intent = data.get("intent");
  const row = await getShop(shop);
  const today = todayIn(row.timezone);
  try {
    if (intent === "delete" && params.id && params.id !== "new") {
      await db.costRule.deleteMany({ where: { id: params.id, shop } });
      await enqueueRecompute(shop, row.historyFrom?.toISOString().slice(0, 10) ?? today, today);
      return { ok: true, message: "Cost deleted.", redirect: "/app/costs" };
    }
    const form = JSON.parse(String(data.get("form"))) as Form;
    const values = toRow(form);

    if (intent === "preview") {
      // What this rule would add over the last 30 days, using the real engine.
      const from = addDays(today, -29);
      const ctx = await loadCalc(shop, `${from.slice(0, 7)}-01`, today);
      if (!ctx) return { ok: true, preview: { orders: 0, total: 0 } };
      const revenue = new Map(ctx.calc.map((o) => [o.id, orderRevenue(o, ctx.settings)]));
      const cogs = new Map(ctx.calc.map((o) => [o.id, orderCogs(o, ctx.settings).lines.reduce((s, l) => s + l.amountCents, 0)]));
      const rule = toCalcRule({ id: "preview", ...values });
      const lines = applyRules(ctx.calc, [rule], ctx.facts, { revenue, cogs });
      let orders = 0;
      let total = 0;
      for (const o of ctx.calc) {
        if (o.day < from) continue;
        const add = (lines.get(o.id) ?? []).reduce((s, l) => s + l.amountCents, 0);
        if (add) {
          orders++;
          total += add;
        }
      }
      return { ok: true, preview: { orders, total } };
    }

    if (params.id && params.id !== "new") await db.costRule.updateMany({ where: { id: params.id, shop }, data: values });
    else await db.costRule.create({ data: { shop, ...values } });
    await enqueueRecompute(shop, row.historyFrom?.toISOString().slice(0, 10) ?? today, today);
    return { ok: true, message: "Cost saved. Profit is being recalculated.", redirect: "/app/costs" };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

const numericIds = (refs: Ref[]) => refs.map((r) => r.id.split("/").pop()!);
const csv = (list?: string[]) => (list ?? []).join(", ");
const parseCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function RuleBuilder() {
  const data = useLoaderData<typeof loader>();
  const [form, setForm] = useState<Form>(data.form);
  const fetcher = useFetcher<typeof action>();
  const preview = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const f = form.filters;
  const setF = (patch: Partial<Form["filters"]>) => setForm({ ...form, filters: { ...form.filters, ...patch } });
  const toggle = (key: keyof RuleFilters, value: string, on: boolean) => {
    const list = ((f[key] as string[] | undefined) ?? []).filter((x) => x !== value);
    setF({ [key]: on ? [...list, value] : list } as Partial<Form["filters"]>);
  };

  // Live "this would add …" preview, debounced while editing.
  useEffect(() => {
    const t = setTimeout(() => preview.submit({ intent: "preview", form: JSON.stringify(form) }, { method: "post" }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    if ("redirect" in fetcher.data && fetcher.data.redirect) navigate(fetcher.data.redirect);
  }, [fetcher.state, fetcher.data, shopify, navigate]);

  const p = preview.data && "preview" in preview.data ? preview.data.preview : null;
  const amountLabel = form.kind === "period_amount" ? `Total per ${form.period.replace("ly", "").replace("dai", "day")}` : isPct(form.kind) ? "Percent" : "Amount";

  return (
    <s-page heading={data.id ? form.name || "Extra cost" : "Add a cost"}>
      <s-link slot="breadcrumb-actions" href="/app/costs">
        Costs
      </s-link>
      <Button slot="primary-action" variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "save", form: JSON.stringify(form) }, { method: "post" })}>
        Save
      </Button>
      {data.id ? (
        <Button slot="secondary-actions" tone="critical" onClick={() => window.confirm("Delete this cost?") && fetcher.submit({ intent: "delete", form: "{}" }, { method: "post" })}>
          Delete
        </Button>
      ) : null}

      <s-section heading="1. What does it cost?">
        <s-stack gap="base">
          <TextField label="Name" placeholder="e.g. Packaging" value={form.name} onValue={(v) => setForm({ ...form, name: v })} />
          <Select
            label="Charged"
            value={form.kind}
            onValue={(v) => setForm({ ...form, kind: v as RuleKind })}
            options={[
              { value: "per_order", label: "A fixed amount per order" },
              { value: "per_item", label: "A fixed amount per item" },
              { value: "pct_revenue", label: "A % of net sales" },
              { value: "pct_gross_profit", label: "A % of gross profit" },
              { value: "period_amount", label: "A total for a period, shared across its orders" },
            ]}
          />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <NumberField label={amountLabel} suffix={isPct(form.kind) ? "%" : data.currency} value={form.amount} min={0} step={isPct(form.kind) ? 0.1 : 1} onValue={(v) => setForm({ ...form, amount: v })} />
            {form.kind === "period_amount" ? (
              <>
                <Select label="Every" value={form.period} onValue={(v) => setForm({ ...form, period: v as Form["period"] })} options={[{ value: "monthly", label: "Month" }, { value: "weekly", label: "Week" }, { value: "daily", label: "Day" }]} />
                <Select label="Share it" value={form.distribute} onValue={(v) => setForm({ ...form, distribute: v as Form["distribute"] })} options={[{ value: "even", label: "Equally per order" }, { value: "revenue", label: "By order value" }, { value: "items", label: "By number of items" }]} />
              </>
            ) : null}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading="2. Which orders does it apply to?">
        <s-stack gap="base">
          <s-paragraph>Leave everything empty for all orders. Each choice narrows it down; per-item and % costs only count the chosen products.</s-paragraph>
          <ResourceList type="product" label="Products" value={f.productRefs ?? []} onChange={(refs) => setF({ productRefs: refs, productIds: numericIds(refs) })} />
          <ResourceList type="collection" label="Collections" value={f.collectionRefs ?? []} onChange={(refs) => setF({ collectionRefs: refs, collectionIds: numericIds(refs) })} />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            <TextField label="Product tags" placeholder="winter, bundle" value={csv(f.tags)} onValue={(v) => setF({ tags: parseCsv(v) })} />
            <TextField label="Vendors" value={csv(f.vendors)} onValue={(v) => setF({ vendors: parseCsv(v) })} />
            <Select label="Payment" value={f.payment ?? "any"} onValue={(v) => setF({ payment: v === "any" ? undefined : (v as "cod" | "online") })} options={[{ value: "any", label: "Any" }, { value: "cod", label: "Cash on delivery" }, { value: "online", label: "Paid online" }]} />
            <Select label="Customers" value={f.customer ?? "any"} onValue={(v) => setF({ customer: v === "any" ? undefined : (v as "new" | "returning") })} options={[{ value: "any", label: "Any" }, { value: "new", label: "New customers" }, { value: "returning", label: "Returning customers" }]} />
          </s-grid>

          <s-text type="strong">Order status</s-text>
          <s-stack direction="inline" gap="base">
            {[
              ["delivered", "Delivered"],
              ["open", "On its way"],
              ["returned", "Returned / refused"],
            ].map(([v, l]) => (
              <Checkbox key={v} label={l} checked={(f.outcomes ?? []).includes(v)} onValue={(on) => toggle("outcomes", v, on)} />
            ))}
          </s-stack>

          {data.zones.length ? (
            <>
              <s-text type="strong">Shipping zones</s-text>
              <s-grid gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))" gap="small-200">
                {data.zones.slice(0, 40).map((z) => (
                  <Checkbox key={z.id} label={z.label} checked={(f.zoneIds ?? []).includes(z.id)} onValue={(on) => toggle("zoneIds", z.id, on)} />
                ))}
              </s-grid>
            </>
          ) : null}

          {data.carriers.length ? (
            <>
              <s-text type="strong">Carriers</s-text>
              <s-stack direction="inline" gap="base">
                {data.carriers.map((c) => (
                  <Checkbox key={c} label={c} checked={(f.carriers ?? []).includes(c)} onValue={(on) => toggle("carriers", c, on)} />
                ))}
              </s-stack>
            </>
          ) : null}

          <s-text type="strong">Ads</s-text>
          <s-stack direction="inline" gap="base">
            {[
              ["meta", "Meta"],
              ["tiktok", "TikTok"],
              ["google", "Google"],
            ].map(([v, l]) => (
              <Checkbox key={v} label={`Orders from ${l} ads`} checked={(f.adPlatforms ?? []).includes(v)} onValue={(on) => toggle("adPlatforms", v, on)} />
            ))}
          </s-stack>
          {data.campaigns.length ? (
            <s-grid gridTemplateColumns="repeat(auto-fill, minmax(240px, 1fr))" gap="small-200">
              {data.campaigns.map((c) => (
                <Checkbox key={`${c.platform}${c.id}`} label={`${c.name} (${c.platform})`} checked={(f.adCampaignIds ?? []).includes(c.id)} onValue={(on) => toggle("adCampaignIds", c.id, on)} />
              ))}
            </s-grid>
          ) : (
            <s-text color="subdued">Connect an ad account to assign costs to specific campaigns (e.g. an influencer fee).</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="3. When (optional)">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <DateField label="From" value={form.startsOn} onValue={(v) => setForm({ ...form, startsOn: v })} />
          <DateField label="Until" value={form.endsOn} onValue={(v) => setForm({ ...form, endsOn: v })} />
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Effect">
        <s-stack gap="small-200">
          {p ? (
            <>
              <s-text type="strong">{formatMoney(p.total, data.currency)}</s-text>
              <s-text color="subdued">
                over the last 30 days, on {p.orders} order{p.orders === 1 ? "" : "s"}
                {p.orders ? ` (≈ ${formatMoney(Math.round(p.total / p.orders), data.currency)} each)` : ""}.
              </s-text>
            </>
          ) : (
            <s-spinner accessibilityLabel="Calculating" />
          )}
          <Switch label={form.active ? "Active" : "Paused"} checked={form.active} onValue={(v) => setForm({ ...form, active: v })} />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
