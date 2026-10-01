# Ultimate Profit Tracker

Shopify app that calculates the real profit of **every order**: product costs (with history), the merchant's real
shipping cost per zone (detected from orders), COD and payment fees, refused/returned COD orders, ad spend per order
(matched by UTM / click id, the rest shared), and any extra cost assigned with rules. Shopify-style dashboard
(Polaris Viz), CAC / LTV / cohorts, CSV reports. Multi-store workspaces are next.

## Run it
```bash
npm install
cp .env.example .env        # then put the Supabase URL in it (docs/hosting.md)
shopify app config link     # once: create "Ultimate Profit Tracker" in the OMC org
shopify app dev --store testing-store-2v65holh.myshopify.com
```

## Checks
```bash
npm test                    # profit engine + order mapping (Vitest)
npm run validate:graphql    # every Admin query against the 2025-10 schema
npm run typecheck && npm run lint && npm run build
```

## Where things are
- `app/lib/profit/` — the calculation (pure functions, unit-tested): `order.ts`, `ads.ts`, `rules.ts`, `compute.ts`.
- `app/lib/shopify/` — Admin queries and the order mapper (attribution, COD outcome, zones).
- `app/lib/import.server.ts` — bulk import (catalog, then orders) and per-order sync from webhooks.
- `app/lib/recompute.server.ts` — recalculates whole months and writes each order's cost lines.
- `app/lib/jobs.server.ts`, `app/worker/` — background jobs on Postgres (pg-boss).
- `app/lib/analytics.server.ts`, `customers.server.ts`, `reports.server.ts` — dashboards and exports.
- `docs/` — scopes (with request texts for Shopify), hosting.
