import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatMoney } from "../lib/money";
import { getShop } from "../lib/shop.server";
import { readSettings } from "../lib/settings";
import { customerNames } from "../lib/customerNames.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const id = BigInt(params.id ?? "0");
  const [order, row] = await Promise.all([
    db.order.findUnique({ where: { shop_id: { shop, id } }, include: { lines: true, costs: true } }),
    getShop(shop),
  ]);
  if (!order) throw new Response("Order not found", { status: 404 });
  const zone = order.zoneId ? await db.shippingZone.findUnique({ where: { id: order.zoneId } }) : null;
  const settings = readSettings(row.settings);
  const customer = (await customerNames(admin, [String(order.id)])).get(String(order.id)) ?? null;
  return {
    customer,
    currency: row.currency,
    timezone: row.timezone,
    shopDomain: shop,
    includeShipping: settings.includeShippingRevenue,
    includeTaxes: settings.includeTaxes,
    zone: zone ? { label: zone.label, configured: zone.configured } : null,
    order: {
      ...order,
      id: String(order.id),
      processedAt: order.processedAt.toISOString(),
      day: order.day.toISOString().slice(0, 10),
      createdAt: undefined,
      cancelledAt: undefined,
      updatedAt: undefined,
      computedAt: order.computedAt?.toISOString() ?? null,
      lines: order.lines.map((l) => ({ ...l, id: String(l.id), orderId: undefined, productId: undefined, variantId: undefined })),
      costs: order.costs.map((c) => ({ ...c, orderId: undefined })),
    },
  };
};

const GROUPS: { types: string[]; title: string }[] = [
  { types: ["cogs"], title: "Product costs" },
  { types: ["shipping", "return_shipping"], title: "Shipping" },
  { types: ["payment_fee", "cod_fee"], title: "Payment & COD fees" },
  { types: ["ad"], title: "Ad cost (cost per purchase)" },
  { types: ["rule"], title: "Other costs" },
];

const SOURCE: Record<string, string> = {
  variant: "Product cost",
  zone: "Your zone price",
  shopify: "Reported by Shopify",
  gateway: "Your gateway fee rule",
  settings: "Default COD fee (Settings)",
  meta: "Meta ad matched by UTM / click id",
  google: "Google ad matched by UTM / click id",
  tiktok: "TikTok ad matched by UTM / click id",
  spread: "Unmatched ad spend shared across the day's orders",
  blended: "All ad spend shared equally across the day's orders",
  rule: "Your cost rule",
};

export default function OrderDetail() {
  const { order, currency, timezone, shopDomain, zone, includeShipping, includeTaxes, customer } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  params.delete("page");
  const fm = (c: number) => formatMoney(c, currency);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(order.processedAt));
  const netSales = order.grossSalesCents - order.discountsCents - order.returnsCents;

  return (
    <s-page heading={`Order ${order.name}`} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={`/app/orders?${params}`}>
        Orders
      </s-link>
      <s-button slot="secondary-actions" href={`https://${shopDomain}/admin/orders/${order.id}`} target="_top">
        Open in Shopify
      </s-button>

      <s-section heading="Profit">
        <s-stack gap="small-200">
          <Row label="Gross sales" value={fm(order.grossSalesCents)} />
          <Row label="Discounts" value={`− ${fm(order.discountsCents)}`} />
          {order.returnsCents ? <Row label="Returns" value={`− ${fm(order.returnsCents)}`} /> : null}
          {includeShipping ? <Row label="Shipping charged to the customer" value={fm(order.shippingChargedCents - order.shippingRefundCents)} /> : null}
          {includeTaxes ? <Row label="Taxes" value={fm(order.taxesCents)} /> : null}
          {order.revenueCents === 0 && netSales > 0 && order.outcome !== "cancelled" ? (
            <s-text color="subdued">Refused cash-on-delivery order: the customer never paid, so revenue counts as 0.</s-text>
          ) : null}
          <Row label="Net sales" value={fm(order.revenueCents)} strong />
          <s-divider />
          {GROUPS.map((g) => {
            const lines = order.costs.filter((c) => g.types.includes(c.type));
            if (!lines.length) return null;
            return (
              <s-stack key={g.title} gap="small-300">
                <Row label={g.title} value={`− ${fm(lines.reduce((s, l) => s + l.amountCents, 0))}`} strong />
                {lines.map((l) => (
                  <s-stack key={l.id} direction="inline" justifyContent="space-between" gap="base">
                    <s-text color="subdued">
                      {l.label}
                      {l.note ? ` · ${l.note}` : ""} — {SOURCE[l.source] ?? l.source}
                    </s-text>
                    <s-text color="subdued">{fm(l.amountCents)}</s-text>
                  </s-stack>
                ))}
              </s-stack>
            );
          })}
          <s-divider />
          <Row label="Net profit" value={fm(order.profitCents)} strong tone={order.profitCents < 0 ? "critical" : "success"} />
          {order.missingCost ? <s-banner tone="warning">Some items have no product cost, so profit is overstated. Add costs under Costs.</s-banner> : null}
          {zone && !zone.configured ? <s-banner tone="warning">“{zone.label}” has no real shipping cost yet. Set it under Shipping zones.</s-banner> : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Details">
        <s-stack gap="small-200">
          <s-text>{when}</s-text>
          {customer?.name ? (
            <s-text>
              Customer:{" "}
              {customer.customerId ? (
                <s-link href={`https://${shopDomain}/admin/customers/${customer.customerId}`} target="_top">
                  {customer.name}
                </s-link>
              ) : (
                customer.name
              )}
              {customer.email ? ` · ${customer.email}` : ""}
            </s-text>
          ) : null}
          <s-text>
            Status: {order.outcome}
            {order.isCod ? " · Cash on delivery" : ""}
          </s-text>
          <s-text>Payment: {order.gateways.join(", ") || "–"}</s-text>
          <s-text>Zone: {zone?.label ?? ([order.province, order.countryCode].filter(Boolean).join(", ") || "–")}</s-text>
          {order.carrier ? <s-text>Carrier: {order.carrier}</s-text> : null}
          <s-text>Items: {order.itemCount}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Where it came from">
        <s-stack gap="small-200">
          <s-text>{order.adPlatform ? `Ad: ${order.adPlatform}` : "Not matched to an ad"}</s-text>
          {order.utmSource ? <s-text color="subdued">utm_source: {order.utmSource}</s-text> : null}
          {order.utmCampaign ? <s-text color="subdued">Campaign: {order.utmCampaign}</s-text> : null}
          {order.utmContent ? <s-text color="subdued">Ad: {order.utmContent}</s-text> : null}
          {order.fbclid || order.gclid || order.ttclid ? <s-text color="subdued">Click id present ({[order.fbclid && "Meta", order.gclid && "Google", order.ttclid && "TikTok"].filter(Boolean).join(", ")})</s-text> : null}
        </s-stack>
      </s-section>

      <s-section heading="Items" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Item</s-table-header>
            <s-table-header format="numeric">Qty</s-table-header>
            <s-table-header format="numeric">Price</s-table-header>
            <s-table-header format="numeric">Unit cost</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {order.lines.map((l) => (
              <s-table-row key={l.id}>
                <s-table-cell>
                  {l.title}
                  {l.variantTitle ? ` · ${l.variantTitle}` : ""}
                </s-table-cell>
                <s-table-cell>
                  {l.quantity}
                  {l.refundedQty ? ` (${l.refundedQty} returned)` : ""}
                </s-table-cell>
                <s-table-cell>{fm(l.unitPriceCents)}</s-table-cell>
                <s-table-cell>{l.unitCostCents === null ? <s-badge tone="warning">Missing</s-badge> : fm(l.unitCostCents)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

function Row(props: { label: string; value: string; strong?: boolean; tone?: "critical" | "success" }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text type={props.strong ? "strong" : "generic"}>{props.label}</s-text>
      <s-text type={props.strong ? "strong" : "generic"} tone={props.tone}>
        {props.value}
      </s-text>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
