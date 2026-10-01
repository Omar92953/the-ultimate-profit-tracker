import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadRange } from "../lib/range.server";
import { cohorts, customerSummary } from "../lib/customers.server";
import { COHORT_WINDOWS, pctChange } from "../lib/metrics";
import { DateRangePicker } from "../components/DateRangePicker";
import { BarsChart, formatValue } from "../components/charts";
import { Kpi, KpiGrid } from "../components/Kpi";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const ctx = await loadRange(request, shop);
  const [now, before, rows] = await Promise.all([
    customerSummary(shop, ctx.range.from, ctx.range.to),
    ctx.compare ? customerSummary(shop, ctx.compare.from, ctx.compare.to) : Promise.resolve(null),
    cohorts(shop, ctx.today),
  ]);
  return { range: ctx.range, today: ctx.today, earliest: ctx.earliest, currency: ctx.currency, now, before, cohorts: rows };
};

export default function Customers() {
  const { now, before, cohorts: rows, currency, range, today, earliest } = useLoaderData<typeof loader>();
  const ch = (k: keyof typeof now) => (before ? pctChange(now[k], before[k]) : null);
  const fm = (v: number | null) => (v === null ? "–" : formatValue(v, "money", currency));
  return (
    <s-page heading="Customers" inlineSize="large">
      <s-stack gap="base">
        <DateRangePicker range={range} today={today} earliest={earliest} />
        <KpiGrid>
          <Kpi label="CAC" value={now.cac} change={ch("cac")} kind="money" currency={currency} goodWhenDown help="Ad spend ÷ customers who ordered for the first time in this period." />
          <Kpi label="LTV (profit)" value={now.ltvProfit} change={ch("ltvProfit")} kind="money" currency={currency} help="Net profit per customer so far, for customers acquired in this period." />
          <Kpi label="LTV (sales)" value={now.ltvRevenue} change={ch("ltvRevenue")} kind="money" currency={currency} />
          <Kpi label="LTV : CAC" value={now.ltvToCac} change={ch("ltvToCac")} kind="number" currency={currency} help="Above 1 means a customer pays back what it cost to get them." />
          <Kpi label="New customers" value={now.newCustomers} change={ch("newCustomers")} kind="number" currency={currency} />
          <Kpi label="Returning customers" value={now.returningCustomers} change={ch("returningCustomers")} kind="number" currency={currency} />
          <Kpi label="Repeat rate" value={now.repeatRate} change={before ? (now.repeatRate ?? 0) - (before.repeatRate ?? 0) : null} kind="percent" currency={currency} help="Share of new customers who ordered again." />
          <Kpi label="Orders per customer" value={now.ordersPerCustomer} change={ch("ordersPerCustomer")} kind="number" currency={currency} />
        </KpiGrid>

        {rows.length ? (
          <s-section heading="Profit per customer by first-order month">
            <BarsChart
              kind="money"
              currency={currency}
              series={[
                { name: "Profit in 90 days", points: [...rows].reverse().map((c) => ({ key: c.month, value: c.profit[90] === null ? null : Math.round(c.profit[90]!) })) },
                { name: "CAC", points: [...rows].reverse().map((c) => ({ key: c.month, value: c.cac === null ? null : Math.round(c.cac) })) },
              ]}
            />
          </s-section>
        ) : null}

        <s-section heading="Cohorts" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">First order</s-table-header>
              <s-table-header format="numeric">Customers</s-table-header>
              <s-table-header format="numeric">CAC</s-table-header>
              {COHORT_WINDOWS.map((w) => (
                <s-table-header key={w} format="numeric">
                  Profit {w}d
                </s-table-header>
              ))}
              <s-table-header format="numeric">Repeat</s-table-header>
              <s-table-header>Pays back</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((c) => (
                <s-table-row key={c.month}>
                  <s-table-cell>{c.month}</s-table-cell>
                  <s-table-cell>{c.customers}</s-table-cell>
                  <s-table-cell>{fm(c.cac)}</s-table-cell>
                  {COHORT_WINDOWS.map((w) => (
                    <s-table-cell key={w}>{fm(c.profit[w])}</s-table-cell>
                  ))}
                  <s-table-cell>{`${c.repeatRate.toFixed(0)}%`}</s-table-cell>
                  <s-table-cell>{c.cac === null ? "–" : c.paybackDays ? `within ${c.paybackDays} days` : "not yet"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
        <s-text color="subdued">Customers are matched by a one-way code, not by name or email. Windows fill in as cohorts get older.</s-text>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
