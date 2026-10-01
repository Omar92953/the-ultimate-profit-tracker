@AGENTS.md

# Ultimate Profit Tracker — read this first

Omar's second app (separate from ~/Workspace/the-ultimate-cro-app). Plan: ~/.claude/plans/robust-whistling-hopcroft.md.

## Status (2026-10-01)
- Phase 0–1 code written; phases 2 (rules) and 4 (customers, reports) largely done. Tests 30/30, typecheck, lint,
  build, GraphQL validation all pass. **Not yet run against a store.**
- Supabase project `ultimate-profit-tracker` (id YOUR-PROJECT-REF, eu-central-1, free) created with Omar's OK.
- Linked 2026-10-01: client_id ef45d453a70e32cf5e01e1252fc230b0 (OMC org). `config link` wipes the toml webhooks — restore them after any relink.
- Next: Omar links the app, selects protected customer data (Level 1 + Address) in the Dev Dashboard, fills `.env`,
  runs `shopify app dev`. Then: ads (Meta → TikTok → Google, needs his developer apps), multi-store workspaces.

## Ads (2026-10-02)
- No registered company yet, so merchants connect their OWN accounts: Meta = system-user access key they
  create in their Business Settings (pasted on the Ads page); Google = Google Ads Script posting to
  /ingest/google (signed per-shop key); TikTok/any = CSV report upload (app/lib/ads/report.ts, EN+AR headers).
- Meta app "Ultimate Profit Tracker" id 1785287616132022 (dev mode, no business portfolio). META_APP_ID/SECRET in .env.
  OAuth button (/meta/start, /meta/callback) only works for app testers until a verified portfolio (agency) + App Review.
- FX via the free jsDelivr currency API (has EGP); cached in FxRate. Graph API v25.0 (META_GRAPH_VERSION).
- Dev test data: 10 orders #1001–#1010 (scripts/dev/seed-orders.mts) + sample Meta report import (scripts/dev/import-report.mts).

## Rules
- Ask before `shopify app deploy`, choosing distribution, or anything paid (Render services cost money).
- Omar runs interactive CLI commands and does every login; never type passwords or secrets.
- Money is integer cents (×100) in the shop currency; days are YYYY-MM-DD in the shop timezone.
- Never import `*.server` modules from page components (build fails); shared helpers go in `app/lib/metrics.ts` etc.
- React 18 + Polaris web components: use the wrappers in `app/components/fields.tsx`.
