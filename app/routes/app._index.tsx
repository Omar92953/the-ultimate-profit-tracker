import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadRange } from "../lib/range.server";
import { products, series, totals, zonesBreakdown } from "../lib/analytics.server";
import { pctChange } from "../lib/metrics";
import { rangeLabel } from "../lib/dates";
import { DateRangePicker } from "../components/DateRangePicker";
import { Donut, formatValue, TrendChart } from "../components/charts";
import { Kpi, KpiGrid } from "../components/Kpi";
import { Button, Select } from "../components/fields";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const ctx = await loadRange(request, shop);
  const ex = ctx.settings.excludeTestOrders;
  const [now, before, points, comparePoints, topProducts, zones, unpricedZones, missingCostVariants, adAccounts] = await Promise.all([
    totals(shop, ctx.range.from, ctx.range.to, ex),
    ctx.compare ? totals(shop, ctx.compare.from, ctx.compare.to, ex) : Promise.resolve(null),
    series(shop, ctx.range.from, ctx.range.to, ex),
    ctx.compare ? series(shop, ctx.compare.from, ctx.compare.to, ex) : Promise.resolve(null),
    products(shop, ctx.range.from, ctx.range.to, 6, ex),
    zonesBreakdown(shop, ctx.range.from, ctx.range.to, ex),
    db.shippingZone.count({ where: { shop, configured: false, orderCount: { gt: 0 } } }),
    db.variant.count({ where: { shop, shopifyCostCents: null } }),
    db.adAccount.count({ where: { shop, status: "active" } }),
  ]);
  return {
    range: ctx.range,
    compare: ctx.compare,
    today: ctx.today,
    earliest: ctx.earliest,
    currency: ctx.currency,
    shop: { name: ctx.shopRow.name, importStatus: ctx.shopRow.importStatus, importKind: ctx.shopRow.importKind, importError: ctx.shopRow.importError },
    now,
    before,
    points,
    comparePoints,
    topProducts,
    zones: zones.slice(0, 6),
    setup: { unpricedZones, missingCostVariants, adAccounts },
  };
};

const METRICS = [
  { value: "profit", label: "Net profit", kind: "money" as const },
  { value: "revenue", label: "Net sales", kind: "money" as const },
  { value: "adSpend", label: "Ad spend", kind: "money" as const },
  { value: "orders", label: "Orders", kind: "number" as const },
];

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const metric = METRICS.find((m) => m.value === params.get("metric")) ?? METRICS[0];
  const cur = data.currency;
  const { now, before } = data;
  const pts = (k: keyof (typeof data.points)[number]) => data.points.map((p) => ({ key: p.key, value: Number(p[k]) }));
  const cmp = (k: keyof (typeof data.points)[number]) => data.comparePoints?.map((p) => ({ key: p.key, value: Number(p[k]) })) ?? null;
  const ch = (k: keyof typeof now) => (before ? pctChange(now[k] as number | null, before[k] as number | null) : null);
  const setMetric = (v: string) => {
    const q = new URLSearchParams(params);
    q.set("metric", v);
    navigate(`?${q}`, { replace: true, preventScrollReset: true });
  };
  const compareLabel = data.compare ? rangeLabel({ ...data.compare, preset: null }) : null;
  const importing = data.shop.importStatus === "running";

  return (
    <s-page heading="Dashboard" inlineSize="large">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <DateRangePicker range={data.range} today={data.today} earliest={data.earliest} />
          {compareLabel ? <s-text color="subdued">compared to {compareLabel}</s-text> : null}
        </s-stack>

        {importing ? (
          <s-banner tone="info" heading="Importing your store's history">
            {data.shop.importKind === "catalog" ? "Reading products and costs…" : "Reading every order Shopify allows…"} Numbers fill in
            automatically; large stores can take a few minutes.
          </s-banner>
        ) : null}
        {data.shop.importStatus === "failed" ? (
          <s-banner tone="critical" heading="The import stopped">
            {data.shop.importError} — open Settings to try again.
          </s-banner>
        ) : null}
        <Checklist setup={data.setup} />

        <KpiGrid>
          <Kpi label="Net profit" value={now.profit} change={ch("profit")} kind="money" currency={cur} points={pts("profit")} comparePoints={cmp("profit")} help="Net sales minus every cost: products, shipping, fees, ads and your extra costs." />
          <Kpi label="Net sales" value={now.revenue} change={ch("revenue")} kind="money" currency={cur} points={pts("revenue")} comparePoints={cmp("revenue")} />
          <Kpi label="Profit margin" value={now.margin} change={before ? (now.margin ?? 0) - (before.margin ?? 0) : null} kind="percent" currency={cur} />
          <Kpi label="Orders" value={now.orders} change={ch("orders")} kind="number" currency={cur} points={pts("orders")} comparePoints={cmp("orders")} />
          <Kpi label="Ad spend" value={now.adSpend} change={ch("adSpend")} kind="money" currency={cur} points={pts("adSpend")} comparePoints={cmp("adSpend")} goodWhenDown />
          <Kpi label="ROAS" value={now.roas} change={ch("roas")} kind="number" currency={cur} help="Net sales ÷ ad spend (blended across platforms)." />
          <Kpi label="Cost per purchase" value={now.cpa} change={ch("cpa")} kind="money" currency={cur} goodWhenDown help="Ad spend ÷ orders, from your real Shopify orders." />
          <Kpi label="CAC" value={now.cac} change={ch("cac")} kind="money" currency={cur} goodWhenDown help="Ad spend ÷ new customers." />
          <Kpi label="Average order value" value={now.aov} change={ch("aov")} kind="money" currency={cur} />
          <Kpi label="Profit per order" value={now.profitPerOrder} change={ch("profitPerOrder")} kind="money" currency={cur} />
          <Kpi label="Returned orders" value={now.returnRate} change={before ? (now.returnRate ?? 0) - (before.returnRate ?? 0) : null} kind="percent" currency={cur} goodWhenDown help="Refused or returned (incl. COD) as a share of orders." />
          <Kpi label="New customers" value={now.newCustomers} change={ch("newCustomers")} kind="number" currency={cur} />
        </KpiGrid>

        <s-section>
          <s-stack gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-heading>{metric.label} over time</s-heading>
              <Select label="Metric" labelAccessibilityVisibility="exclusive" value={metric.value} onValue={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} />
            </s-stack>
            <TrendChart
              name={rangeLabel(data.range)}
              points={pts(metric.value as "profit")}
              compare={data.comparePoints ? { name: compareLabel ?? "Previous", points: cmp(metric.value as "profit")! } : null}
              kind={metric.kind}
              currency={cur}
            />
          </s-stack>
        </s-section>

        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 380px), 1fr))" gap="base">
          <s-section heading="Where the money went">
            <Donut
              kind="money"
              currency={cur}
              slices={[
                { name: "Product costs", value: now.cogs },
                { name: "Shipping", value: now.shipping },
                { name: "Ad spend", value: now.adSpend },
                { name: "Payment & COD fees", value: now.fees },
                { name: "Other costs", value: now.other },
                { name: "Net profit", value: Math.max(0, now.profit) },
              ]}
            />
          </s-section>
          <s-section heading="Top products" padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">Units</s-table-header>
                <s-table-header format="numeric">Gross profit</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.topProducts.map((p) => (
                  <s-table-row key={p.productId}>
                    <s-table-cell>
                      {p.title}
                      {p.missingCost ? <s-badge tone="warning">No cost</s-badge> : null}
                    </s-table-cell>
                    <s-table-cell>{p.units}</s-table-cell>
                    <s-table-cell>{formatValue(p.grossProfit, "money", cur)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
          <s-section heading="Shipping zones" padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Zone</s-table-header>
                <s-table-header format="numeric">Orders</s-table-header>
                <s-table-header format="numeric">Returned</s-table-header>
                <s-table-header format="numeric">Profit</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.zones.map((z) => (
                  <s-table-row key={z.zoneId ?? "none"}>
                    <s-table-cell>{z.label}</s-table-cell>
                    <s-table-cell>{z.orders}</s-table-cell>
                    <s-table-cell>{z.orders ? `${Math.round((z.returned / z.orders) * 100)}%` : "–"}</s-table-cell>
                    <s-table-cell>{formatValue(z.profit, "money", cur)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}

function Checklist({ setup }: { setup: { unpricedZones: number; missingCostVariants: number; adAccounts: number } }) {
  const items = [
    setup.unpricedZones > 0 && { text: `${setup.unpricedZones} shipping zone(s) have no real cost yet`, href: "/app/zones", action: "Set costs" },
    setup.missingCostVariants > 0 && { text: `${setup.missingCostVariants} variant(s) have no product cost`, href: "/app/costs", action: "Add costs" },
    setup.adAccounts === 0 && { text: "No ad account connected, so ad spend is 0", href: "/app/ads", action: "Connect ads" },
  ].filter(Boolean) as { text: string; href: string; action: string }[];
  if (!items.length) return null;
  return (
    <s-banner tone="warning" heading="Finish setup for accurate profit">
      <s-stack gap="small-200">
        {items.map((i) => (
          <s-stack key={i.href} direction="inline" gap="base" alignItems="center">
            <s-text>{i.text}</s-text>
            <Button href={i.href} variant="tertiary">
              {i.action}
            </Button>
          </s-stack>
        ))}
      </s-stack>
    </s-banner>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
