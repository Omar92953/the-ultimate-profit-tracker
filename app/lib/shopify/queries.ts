/**
 * Admin GraphQL documents. They're written as full queries (validated against the Admin schema
 * by `npm run graphql-codegen`) and the bulk versions are passed to bulkOperationRunQuery as text.
 * Only zone fields of the shipping address are read: no names, streets or phone numbers.
 */

const ORDER_FIELDS = `
  id
  name
  createdAt
  processedAt
  cancelledAt
  cancelReason
  test
  tags
  sourceName
  paymentGatewayNames
  displayFinancialStatus
  displayFulfillmentStatus
  returnStatus
  totalWeight
  customer { id }
  shippingAddress { countryCodeV2 province provinceCode city zip }
  totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount currencyCode } }
  totalRefundedSet { shopMoney { amount } }
  totalRefundedShippingSet { shopMoney { amount } }
  fulfillments { status displayStatus trackingInfo { company } }
  transactions { kind status gateway amountSet { shopMoney { amount } } fees { amount { amount } } }
  customerJourneySummary {
    customerOrderIndex
    lastVisit { landingPage referrerUrl utmParameters { source medium campaign content term } }
    firstVisit { landingPage referrerUrl utmParameters { source medium campaign content term } }
  }
`;

const LINE_FIELDS = `
  id
  quantity
  currentQuantity
  title
  variantTitle
  sku
  product { id }
  variant { id }
  originalUnitPriceSet { shopMoney { amount } }
  totalDiscountSet { shopMoney { amount } }
`;

/** One order with its lines, for webhooks. */
export const ORDER_QUERY = `#graphql
  query ProfitOrder($id: ID!) {
    order(id: $id) {
      ${ORDER_FIELDS}
      lineItems(first: 250) { edges { node { ${LINE_FIELDS} } } }
    }
  }
`;

/** Every order (bulk). `query` is filled in at run time, e.g. created_at:>=2024-01-01. */
export const ORDERS_BULK = `#graphql
  query ProfitOrdersBulk {
    orders(sortKey: PROCESSED_AT) {
      edges { node {
        ${ORDER_FIELDS}
        lineItems { edges { node { ${LINE_FIELDS} } } }
      } }
    }
  }
`;

/** Products, variants and their unit cost (bulk). */
export const CATALOG_BULK = `#graphql
  query ProfitCatalogBulk {
    products {
      edges { node {
        id
        title
        vendor
        productType
        tags
        collections { edges { node { id } } }
        variants { edges { node {
          id
          title
          sku
          inventoryItem { id unitCost { amount } measurement { weight { unit value } } }
        } } }
      } }
    }
  }
`;

export const SHOP_QUERY = `#graphql
  query ProfitShop {
    shop { name currencyCode ianaTimezone currencyFormats { moneyFormat } }
  }
`;

export const BULK_RUN = `#graphql
  mutation ProfitBulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

export const BULK_STATUS = `#graphql
  query ProfitBulkStatus($id: ID!) {
    node(id: $id) { ... on BulkOperation { id status errorCode objectCount url partialDataUrl } }
  }
`;

/** Strip the `#graphql` marker and the named wrapper so the text can run as a bulk query. */
export function bulkText(doc: string, ordersSearch?: string): string {
  let text = doc.replace("#graphql", "").replace(/query\s+\w+\s*/, "");
  if (ordersSearch) text = text.replace("orders(sortKey: PROCESSED_AT)", `orders(sortKey: PROCESSED_AT, query: ${JSON.stringify(ordersSearch)})`);
  return text.trim();
}

/**
 * Customer name and email for orders on screen. Read live for display only and never stored
 * (keeps personal data out of the app's database).
 */
export const ORDER_CUSTOMERS = `#graphql
  query ProfitOrderCustomers($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Order { id customer { id displayName email } } }
  }
`;
