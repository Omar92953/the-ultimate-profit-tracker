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
import { Breakdown } from "../components/Breakdown";
import { Button } from "../components/fields";
import { Card, CardGrid, CardText, Checklist, GroupTitle, Pill, Segmented, Toolbar } from "../components/ui";

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
  const pointsDelta = (k: "margin" | "returnRate") => (before ? (now[k] ?? 0) - (before[k] ?? 0) : null);
  const setMetric = (v: string) => {
    const q = new URLSearchParams(params);
    q.set("metric", v);
    navigate(`?${q}`, { replace: true, preventScrollReset: true });
  };
  const compareLabel = data.compare ? rangeLabel({ ...data.compare, preset: null }) : null;
  const importing = data.shop.importStatus === "running";

  return (
    <s-page heading="Dashboard" inlineSize="large">
      <s-stack gap="large">
        <Toolbar note={compareLabel ? `compared to ${compareLabel}` : undefined}>
          <DateRangePicker range={data.range} today={data.today} earliest={data.earliest} />
        </Toolbar>

        {importing ? (
          <s-banner tone="info" heading="Importing your store's history">
            {data.shop.importKind === "catalog" ? "Reading products and costs…" : "Reading every order Shopify allows…"} Numbers fill in
            automatically; large stores can take a few minutes.
          </s-banner>
        ) : null}
        {data.shop.importStatus === "failed" ? (
          <s-banner tone="critical" heading="The import stopped">
            {data.shop.importError}. Open Settings to try again.
          </s-banner>
        ) : null}
        <Setup setup={data.setup} />

        <div>
          <GroupTitle>Profit</GroupTitle>
          <KpiGrid>
            <Kpi label="Net profit" value={now.profit} change={ch("profit")} kind="money" currency={cur} points={pts("profit")} comparePoints={cmp("profit")} help="Net sales minus every cost: products, shipping, fees, ads and your extra costs." />
            <Kpi label="Net sales" value={now.revenue} change={ch("revenue")} kind="money" currency={cur} points={pts("revenue")} comparePoints={cmp("revenue")} />
            <Kpi label="Profit margin" value={now.margin} change={pointsDelta("margin")} kind="percent" currency={cur} />
            <Kpi label="Profit per order" value={now.profitPerOrder} change={ch("profitPerOrder")} kind="money" currency={cur} />
          </KpiGrid>
        </div>
        <div>
          <GroupTitle>Orders & customers</GroupTitle>
          <KpiGrid>
            <Kpi label="Orders" value={now.orders} change={ch("orders")} kind="number" currency={cur} points={pts("orders")} comparePoints={cmp("orders")} />
            <Kpi label="Average order value" value={now.aov} change={ch("aov")} kind="money" currency={cur} />
            <Kpi label="Returned orders" value={now.returnRate} change={pointsDelta("returnRate")} kind="percent" currency={cur} goodWhenDown help="Refused or returned (incl. COD) as a share of orders." />
            <Kpi label="New customers" value={now.newCustomers} change={ch("newCustomers")} kind="number" currency={cur} />
          </KpiGrid>
        </div>
        <div>
          <GroupTitle>Ads</GroupTitle>
          <KpiGrid>
            <Kpi label="Ad spend" value={now.adSpend} change={ch("adSpend")} kind="money" currency={cur} points={pts("adSpend")} comparePoints={cmp("adSpend")} goodWhenDown />
            <Kpi label="ROAS" value={now.roas} change={ch("roas")} kind="number" currency={cur} help="Net sales ÷ ad spend (blended across platforms)." />
            <Kpi label="Cost per purchase" value={now.cpa} change={ch("cpa")} kind="money" currency={cur} goodWhenDown help="Ad spend ÷ orders, from your real Shopify orders." />
            <Kpi label="CAC" value={now.cac} change={ch("cac")} kind="money" currency={cur} goodWhenDown help="Ad spend ÷ new customers." />
          </KpiGrid>
        </div>

        <CardGrid cols={2}>
          <Card title="Sales, as Shopify reports them" badge={<Pill>Shopify</Pill>}>
            <Breakdown
              currency={cur}
              lines={[
                { label: "Gross sales", sign: "+", value: now.grossSales, previous: before?.grossSales },
                { label: "Discounts", sign: "-", value: now.discounts, previous: before?.discounts },
                { label: "Returns", sign: "-", value: now.returns, previous: before?.returns },
                { label: "Net sales", sign: "=", value: now.shopifyNetSales, previous: before?.shopifyNetSales },
                { label: "Shipping charges", sign: "+", value: now.shippingCharged, previous: before?.shippingCharged, hint: "What customers paid for shipping" },
                { label: "Taxes", sign: "+", value: now.taxes, previous: before?.taxes },
                { label: "Total sales", sign: "=", value: now.totalSales, previous: before?.totalSales, strong: true },
              ]}
            />
          </Card>
          <Card title="Profit, with your real costs" badge={<Pill tone="ok">This app</Pill>}>
            <Breakdown
              currency={cur}
              lines={[
                { label: "Sales counted", sign: "+", value: now.revenue, previous: before?.revenue, hint: "Net sales + shipping charges, minus refused COD orders" },
                { label: "Product costs", sign: "-", value: now.cogs, previous: before?.cogs },
                { label: "Real shipping cost", sign: "-", value: now.shipping, previous: before?.shipping, hint: `Your zone prices. Customers paid ${formatValue(now.shippingCharged, "money", cur)}, so shipping ${now.shippingResult >= 0 ? "earned" : "cost"} you ${formatValue(Math.abs(now.shippingResult), "money", cur)}` },
                { label: "Payment & COD fees", sign: "-", value: now.fees, previous: before?.fees },
                { label: "Ad spend", sign: "-", value: now.adSpend, previous: before?.adSpend },
                { label: "Extra costs", sign: "-", value: now.other, previous: before?.other },
                { label: "Net profit", sign: "=", value: now.profit, previous: before?.profit, strong: true },
              ]}
            />
          </Card>
        </CardGrid>

        <s-section>
          <s-stack gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
              <s-heading>{metric.label} over time</s-heading>
              <Segmented label="Chart metric" value={metric.value} onChange={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} />
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

        <CardGrid cols={2}>
          <Card title="Where the money went">
            <Donut
              kind="money"
              currency={cur}
              height={220}
              slices={[
                { name: "Product costs", value: now.cogs },
                { name: "Shipping", value: now.shipping },
                { name: "Ad spend", value: now.adSpend },
                { name: "Payment & COD fees", value: now.fees },
                { name: "Other costs", value: now.other },
                { name: "Net profit", value: Math.max(0, now.profit) },
              ]}
            />
          </Card>
          <Card title="Top products" actions={<Button variant="tertiary" href="/app/products">View all products</Button>}>
            <MiniTable
              head={["Product", "Units", "Gross profit"]}
              rows={data.topProducts.map((p) => [
                <>
                  {p.title} {p.missingCost ? <Pill tone="warn">No cost</Pill> : null}
                </>,
                p.units,
                formatValue(p.grossProfit, "money", cur),
              ])}
            />
          </Card>
        </CardGrid>

        <Card title="Shipping zones" actions={<Button variant="tertiary" href="/app/zones">Edit shipping costs</Button>}>
          <MiniTable
            head={["Zone", "Orders", "Returned", "Profit"]}
            rows={data.zones.map((z) => [z.label, z.orders, z.orders ? `${Math.round((z.returned / z.orders) * 100)}%` : "–", formatValue(z.profit, "money", cur)])}
          />
        </Card>
      </s-stack>
    </s-page>
  );
}

/** Compact table for cards (keeps card heights tidy). */
function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <CardText>Nothing in this period yet.</CardText>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} style={{ textAlign: i ? "right" : "left", color: "#616161", fontWeight: 550, padding: "6px 0", borderBottom: "1px solid #ebebeb" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} style={{ textAlign: j ? "right" : "left", padding: "7px 0", borderBottom: "1px solid #f3f3f3", whiteSpace: j ? "nowrap" : "normal" }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Setup({ setup }: { setup: { unpricedZones: number; missingCostVariants: number; adAccounts: number } }) {
  const items = [
    setup.unpricedZones > 0 && { text: `${setup.unpricedZones} shipping zone(s) have no real cost yet`, action: <Button href="/app/zones" variant="tertiary">Set costs</Button> },
    setup.missingCostVariants > 0 && { text: `${setup.missingCostVariants} variant(s) have no product cost`, action: <Button href="/app/costs?missing=1" variant="tertiary">Add costs</Button> },
    setup.adAccounts === 0 && { text: "No ad account connected, so ad spend is 0", action: <Button href="/app/ads" variant="tertiary">Connect ads</Button> },
  ].filter(Boolean) as { text: string; action: React.ReactNode }[];
  if (!items.length) return null;
  return (
    <Card title="Finish setup for accurate profit" badge={<Pill tone="warn">{`${items.length} to do`}</Pill>}>
      <Checklist items={items} />
    </Card>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
