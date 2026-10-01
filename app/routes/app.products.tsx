import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadRange } from "../lib/range.server";
import { products } from "../lib/analytics.server";
import { DateRangePicker } from "../components/DateRangePicker";
import { BarsChart, formatValue } from "../components/charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ctx = await loadRange(request, session.shop);
  return {
    range: ctx.range,
    today: ctx.today,
    earliest: ctx.earliest,
    currency: ctx.currency,
    rows: await products(session.shop, ctx.range.from, ctx.range.to, 200, ctx.settings.excludeTestOrders),
  };
};

export default function Products() {
  const { rows, currency, range, today, earliest } = useLoaderData<typeof loader>();
  const fm = (v: number) => formatValue(v, "money", currency);
  const top = [...rows].sort((a, b) => b.netProfit - a.netProfit).slice(0, 10);
  return (
    <s-page heading="Products" inlineSize="large">
      <s-stack gap="base">
        <DateRangePicker range={range} today={today} earliest={earliest} />
        {top.length ? (
          <s-section heading="Net profit by product (top 10)">
            <BarsChart horizontal kind="money" currency={currency} height={Math.max(160, top.length * 34)} series={[{ name: "Net profit", points: top.map((p) => ({ key: p.title, value: Math.round(p.netProfit) })) }]} />
          </s-section>
        ) : null}
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="numeric">Units</s-table-header>
              <s-table-header format="numeric">Net sales</s-table-header>
              <s-table-header format="numeric">Product cost</s-table-header>
              <s-table-header format="numeric">Gross profit</s-table-header>
              <s-table-header format="numeric">Shipping, fees & ads</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">Net profit</s-table-header>
              <s-table-header format="numeric">Margin</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((p) => (
                <s-table-row key={p.productId}>
                  <s-table-cell>
                    {p.title}
                    {p.missingCost ? <s-badge tone="warning">No cost</s-badge> : null}
                  </s-table-cell>
                  <s-table-cell>{p.units}</s-table-cell>
                  <s-table-cell>{fm(p.revenue)}</s-table-cell>
                  <s-table-cell>{fm(p.cogs)}</s-table-cell>
                  <s-table-cell>{fm(p.grossProfit)}</s-table-cell>
                  <s-table-cell>{fm(p.orderCosts)}</s-table-cell>
                  <s-table-cell>
                    <s-text tone={p.netProfit < 0 ? "critical" : "success"} type="strong">
                      {fm(p.netProfit)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>{p.margin === null ? "–" : `${p.margin.toFixed(0)}%`}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
