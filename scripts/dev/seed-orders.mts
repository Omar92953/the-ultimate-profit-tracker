/**
 * DEV ONLY: creates realistic test orders on the development store, through the local GraphiQL
 * proxy that `shopify app dev` prints. Needs the temporary `write_orders` scope.
 *
 *   npx tsx scripts/dev/seed-orders.mts "http://localhost:PORT/graphiql/graphql.json?key=KEY&api_version=2025-10"
 *
 * Mix: card and cash-on-delivery, delivered / on the way / refused / cancelled / partly refunded,
 * four Egyptian governorates, and one returning customer. Dates spread over the last 3 weeks.
 */
export const ORDER_CREATE = `#graphql
  mutation SeedOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name transactions { id gateway kind amountSet { shopMoney { amount } } } lineItems(first: 5) { nodes { id quantity } } }
      userErrors { field message }
    }
  }
`;

export const ORDER_CANCEL = `#graphql
  mutation SeedOrderCancel($orderId: ID!) {
    orderCancel(orderId: $orderId, reason: CUSTOMER, restock: true, notifyCustomer: false) {
      orderCancelUserErrors { field message }
    }
  }
`;

export const REFUND_CREATE = `#graphql
  mutation SeedRefund($input: RefundInput!) {
    refundCreate(input: $input) {
      refund { id }
      userErrors { field message }
    }
  }
`;

type Line = { variantId: string; quantity: number };
type Seed = {
  key: string;
  daysAgo: number;
  customer: { first: string; last: string; email: string };
  province: string;
  city: string;
  lines: Line[];
  shipping: number;
  payment: "card" | "cod";
  state: "delivered" | "on_the_way" | "refused" | "cancelled" | "partial_refund";
};

const V = {
  hydrogen: "gid://shopify/ProductVariant/50521056608473",
  wax: "gid://shopify/ProductVariant/50521056805081",
  completeIce: "gid://shopify/ProductVariant/50521057001689",
  minimal: "gid://shopify/ProductVariant/50521057231065",
  oxygen: "gid://shopify/ProductVariant/50521057558745",
  liquid: "gid://shopify/ProductVariant/50521057689817",
};

const SEEDS: Seed[] = [
  { key: "1", daysAgo: 20, customer: { first: "Ahmed", last: "Hassan", email: "ahmed.test@example.com" }, province: "C", city: "Nasr City", lines: [{ variantId: V.hydrogen, quantity: 1 }], shipping: 5, payment: "card", state: "delivered" },
  { key: "2", daysAgo: 18, customer: { first: "Mona", last: "Adel", email: "mona.test@example.com" }, province: "C", city: "Maadi", lines: [{ variantId: V.wax, quantity: 3 }], shipping: 5, payment: "cod", state: "delivered" },
  { key: "3", daysAgo: 15, customer: { first: "Youssef", last: "Kamal", email: "youssef.test@example.com" }, province: "GZ", city: "6th of October", lines: [{ variantId: V.minimal, quantity: 1 }], shipping: 7, payment: "cod", state: "refused" },
  { key: "4", daysAgo: 13, customer: { first: "Sara", last: "Nabil", email: "sara.test@example.com" }, province: "GZ", city: "Dokki", lines: [{ variantId: V.completeIce, quantity: 1 }, { variantId: V.wax, quantity: 1 }], shipping: 7, payment: "card", state: "delivered" },
  { key: "5", daysAgo: 11, customer: { first: "Omar", last: "Farouk", email: "omar.f.test@example.com" }, province: "ALX", city: "Smouha", lines: [{ variantId: V.minimal, quantity: 1 }], shipping: 9, payment: "cod", state: "delivered" },
  { key: "6", daysAgo: 2, customer: { first: "Laila", last: "Samir", email: "laila.test@example.com" }, province: "ALX", city: "Sidi Gaber", lines: [{ variantId: V.liquid, quantity: 1 }], shipping: 9, payment: "cod", state: "on_the_way" },
  { key: "7", daysAgo: 9, customer: { first: "Karim", last: "Mostafa", email: "karim.test@example.com" }, province: "DK", city: "Mansoura", lines: [{ variantId: V.wax, quantity: 2 }, { variantId: V.hydrogen, quantity: 1 }], shipping: 10, payment: "card", state: "partial_refund" },
  { key: "8", daysAgo: 6, customer: { first: "Nour", last: "Ibrahim", email: "nour.test@example.com" }, province: "DK", city: "Mansoura", lines: [{ variantId: V.oxygen, quantity: 1 }], shipping: 10, payment: "cod", state: "cancelled" },
  { key: "9", daysAgo: 4, customer: { first: "Ahmed", last: "Hassan", email: "ahmed.test@example.com" }, province: "C", city: "Nasr City", lines: [{ variantId: V.wax, quantity: 2 }], shipping: 5, payment: "card", state: "delivered" },
  { key: "10", daysAgo: 1, customer: { first: "Hana", last: "Tarek", email: "hana.test@example.com" }, province: "GZ", city: "Sheikh Zayed", lines: [{ variantId: V.oxygen, quantity: 1 }], shipping: 7, payment: "cod", state: "delivered" },
];

// The dev store's location (read via inventory levels; the app has no read_locations scope).
const LOCATION = "gid://shopify/Location/96457359577";

const PRICES: Record<string, number> = {
  [V.hydrogen]: 600, [V.wax]: 24.95, [V.completeIce]: 699.95, [V.minimal]: 885.95, [V.oxygen]: 1025, [V.liquid]: 749.95,
};

async function call(url: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.replace("#graphql", ""), variables }) });
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data!;
}

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error("Pass the GraphiQL proxy URL (see the file header).");
  const only = process.argv[3]?.split(",");
  for (const s of SEEDS) {
    if (only && !only.includes(s.key)) continue;
    // Dev stores limit order creation; space the calls out.
    await new Promise((r) => setTimeout(r, 20_000));
    const subtotal = s.lines.reduce((t, l) => t + PRICES[l.variantId] * l.quantity, 0);
    const total = Math.round((subtotal + s.shipping) * 100) / 100;
    const gateway = s.payment === "cod" ? "Cash on Delivery (COD)" : "Paymob";
    const paid = s.payment === "card" || s.state === "delivered";
    const shipped = s.state !== "cancelled" && s.state !== "on_the_way";
    const processedAt = new Date(Date.now() - s.daysAgo * 86_400_000).toISOString();
    const order = {
      processedAt,
      email: s.customer.email,
      customer: { toUpsert: { email: s.customer.email, firstName: s.customer.first, lastName: s.customer.last } },
      shippingAddress: { firstName: s.customer.first, lastName: s.customer.last, address1: "1 Test Street", city: s.city, provinceCode: s.province, countryCode: "EG", zip: "11511" },
      lineItems: s.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      shippingLines: [{ title: "Standard", priceSet: { shopMoney: { amount: s.shipping, currencyCode: "USD" } } }],
      financialStatus: paid ? "PAID" : "PENDING",
      transactions: paid ? [{ kind: "SALE", status: "SUCCESS", gateway, amountSet: { shopMoney: { amount: total, currencyCode: "USD" } } }] : [],
      ...(shipped
        ? {
            fulfillmentStatus: "FULFILLED",
            fulfillment: { locationId: LOCATION, trackingCompany: "Bosta", trackingNumber: `TEST${s.key}`, notifyCustomer: false, shipmentStatus: s.state === "refused" ? "FAILURE" : "DELIVERED" },
          }
        : {}),
      tags: ["test-data", ...(s.state === "refused" ? ["refused"] : [])],
      note: `Test order (${s.state}, ${s.payment})`,
    };
    // Unpaid COD orders still need the gateway name on the order, so record a pending sale.
    if (!paid) (order as Record<string, unknown>).transactions = [{ kind: "SALE", status: "PENDING", gateway, amountSet: { shopMoney: { amount: total, currencyCode: "USD" } } }];

    const data = (await call(url, ORDER_CREATE, { order, options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "BYPASS" } })) as {
      orderCreate: { order: { id: string; name: string; transactions: { id: string; gateway: string }[]; lineItems: { nodes: { id: string; quantity: number }[] } } | null; userErrors: { message: string }[] };
    };
    const r = data.orderCreate;
    if (r.userErrors.length || !r.order) {
      console.log(`✗ seed ${s.key}: ${r.userErrors.map((e) => e.message).join("; ")}`);
      continue;
    }
    console.log(`✓ ${r.order.name} ${s.state} ${s.payment} ${s.province}`);

    if (s.state === "cancelled") {
      const c = (await call(url, ORDER_CANCEL, { orderId: r.order.id })) as { orderCancel: { orderCancelUserErrors: { message: string }[] } };
      if (c.orderCancel.orderCancelUserErrors.length) console.log(`  cancel: ${c.orderCancel.orderCancelUserErrors.map((e) => e.message).join("; ")}`);
    }
    if (s.state === "partial_refund") {
      const waxLine = r.order.lineItems.nodes.find((n) => n.quantity === 2)!;
      const parent = r.order.transactions[0];
      const refund = (await call(url, REFUND_CREATE, {
        input: {
          orderId: r.order.id,
          notify: false,
          refundLineItems: [{ lineItemId: waxLine.id, quantity: 1, restockType: "NO_RESTOCK" }],
          transactions: [{ orderId: r.order.id, parentId: parent.id, gateway: parent.gateway, kind: "REFUND", amount: "24.95" }],
        },
      })) as { refundCreate: { userErrors: { message: string }[] } };
      if (refund.refundCreate.userErrors.length) console.log(`  refund: ${refund.refundCreate.userErrors.map((e) => e.message).join("; ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
