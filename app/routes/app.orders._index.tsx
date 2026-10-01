import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadRange } from "../lib/range.server";
import { customerNames } from "../lib/customerNames.server";
import { formatMoney } from "../lib/money";
import { DateRangePicker } from "../components/DateRangePicker";
import { Button, Select } from "../components/fields";

const PAGE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ctx = await loadRange(request, shop);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const outcome = url.searchParams.get("outcome") ?? "all";
  const profit = url.searchParams.get("profit") ?? "all";
  const source = url.searchParams.get("source") ?? "all";
  const sort = url.searchParams.get("sort") ?? "newest";

  const where: Prisma.OrderWhereInput = {
    shop,
    day: { gte: new Date(`${ctx.range.from}T00:00:00Z`), lte: new Date(`${ctx.range.to}T00:00:00Z`) },
    ...(ctx.settings.excludeTestOrders ? { test: false } : {}),
    ...(outcome !== "all" ? { outcome } : {}),
    ...(profit === "loss" ? { profitCents: { lt: 0 } } : profit === "missing" ? { missingCost: true } : {}),
    ...(source === "none" ? { adPlatform: null } : source !== "all" ? { adPlatform: source } : {}),
  };
  const orderBy: Prisma.OrderOrderByWithRelationInput =
    sort === "profit_asc" ? { profitCents: "asc" } : sort === "profit_desc" ? { profitCents: "desc" } : sort === "oldest" ? { processedAt: "asc" } : { processedAt: "desc" };

  const [rows, count] = await Promise.all([
    db.order.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: { id: true, name: true, processedAt: true, outcome: true, isCod: true, adPlatform: true, countryCode: true, province: true, revenueCents: true, cogsCents: true, shippingCents: true, feesCents: true, adCents: true, otherCents: true, profitCents: true, missingCost: true },
    }),
    db.order.count({ where }),
  ]);
  const names = await customerNames(admin, rows.map((r) => String(r.id)));
  return {
    range: ctx.range,
    today: ctx.today,
    earliest: ctx.earliest,
    currency: ctx.currency,
    timezone: ctx.shopRow.timezone,
    rows: rows.map((r) => ({ ...r, id: String(r.id), processedAt: r.processedAt.toISOString(), customer: names.get(String(r.id))?.name ?? null })),
    count,
    page,
    pages: Math.max(1, Math.ceil(count / PAGE)),
    filters: { outcome, profit, source, sort },
  };
};

const OUTCOME: Record<string, { label: string; tone: "success" | "info" | "warning" | "critical" | "neutral" }> = {
  delivered: { label: "Delivered", tone: "success" },
  open: { label: "On its way", tone: "info" },
  returned: { label: "Returned", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fm = (c: number) => formatMoney(c, data.currency);
  const set = (key: string, value: string) => {
    const q = new URLSearchParams(params);
    if (value === "all" || (key === "sort" && value === "newest")) q.delete(key);
    else q.set(key, value);
    if (key !== "page") q.delete("page");
    navigate(`?${q}`);
  };
  const when = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: data.timezone }).format(new Date(iso));

  return (
    <s-page heading="Orders" inlineSize="large">
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" alignItems="end">
          <DateRangePicker range={data.range} today={data.today} earliest={data.earliest} />
          <Select label="Status" value={data.filters.outcome} onValue={(v) => set("outcome", v)} options={[{ value: "all", label: "All" }, { value: "delivered", label: "Delivered" }, { value: "open", label: "On its way" }, { value: "returned", label: "Returned / refused" }, { value: "cancelled", label: "Cancelled" }]} />
          <Select label="Profit" value={data.filters.profit} onValue={(v) => set("profit", v)} options={[{ value: "all", label: "All" }, { value: "loss", label: "Losing money" }, { value: "missing", label: "Missing product cost" }]} />
          <Select label="Source" value={data.filters.source} onValue={(v) => set("source", v)} options={[{ value: "all", label: "All" }, { value: "meta", label: "Meta ads" }, { value: "tiktok", label: "TikTok ads" }, { value: "google", label: "Google ads" }, { value: "none", label: "Not from ads" }]} />
          <Select label="Sort" value={data.filters.sort} onValue={(v) => set("sort", v)} options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "profit_desc", label: "Most profit" }, { value: "profit_asc", label: "Least profit" }]} />
        </s-stack>

        <s-section padding="none">
          {data.rows.length ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
                <s-table-header>Source</s-table-header>
                <s-table-header format="numeric">Net sales</s-table-header>
                <s-table-header format="numeric">Products</s-table-header>
                <s-table-header format="numeric">Shipping</s-table-header>
                <s-table-header format="numeric">Ads</s-table-header>
                <s-table-header format="numeric">Fees & other</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">Profit</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((o) => {
                  const st = OUTCOME[o.outcome] ?? OUTCOME.open;
                  return (
                    <s-table-row key={o.id}>
                      <s-table-cell>
                        <s-link href={`/app/orders/${o.id}?${params}`}>{o.name}</s-link>
                        {o.missingCost ? <s-badge tone="warning">No cost</s-badge> : null}
                      </s-table-cell>
                      <s-table-cell>{o.customer ?? "–"}</s-table-cell>
                      <s-table-cell>{when(o.processedAt)}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={st.tone}>{st.label}</s-badge>
                        {o.isCod ? <s-text color="subdued"> COD</s-text> : null}
                      </s-table-cell>
                      <s-table-cell>{o.adPlatform ? o.adPlatform[0].toUpperCase() + o.adPlatform.slice(1) : "–"}</s-table-cell>
                      <s-table-cell>{fm(o.revenueCents)}</s-table-cell>
                      <s-table-cell>{fm(o.cogsCents)}</s-table-cell>
                      <s-table-cell>{fm(o.shippingCents)}</s-table-cell>
                      <s-table-cell>{fm(o.adCents)}</s-table-cell>
                      <s-table-cell>{fm(o.feesCents + o.otherCents)}</s-table-cell>
                      <s-table-cell>
                        <s-text tone={o.profitCents < 0 ? "critical" : "success"} type="strong">
                          {fm(o.profitCents)}
                        </s-text>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="large">
              <s-stack alignItems="center" gap="small-200">
                <s-heading>No orders here</s-heading>
                <s-paragraph>Try a longer date range or clear the filters.</s-paragraph>
              </s-stack>
            </s-box>
          )}
        </s-section>

        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">
            {data.count} orders · page {data.page} of {data.pages}
          </s-text>
          <s-stack direction="inline" gap="small-200">
            <Button disabled={data.page <= 1} onClick={() => set("page", String(data.page - 1))} icon="chevron-left" accessibilityLabel="Previous page">
              Previous
            </Button>
            <Button disabled={data.page >= data.pages} onClick={() => set("page", String(data.page + 1))} icon="chevron-right" accessibilityLabel="Next page">
              Next
            </Button>
          </s-stack>
        </s-stack>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
