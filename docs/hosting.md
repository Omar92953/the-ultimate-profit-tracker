# Hosting

## Development (now)
- Database: Supabase project **ultimate-profit-tracker** (free tier, Frankfurt), created 2026-10-01.
- `shopify app dev` runs the web app **and** the background jobs (inline worker) on your Mac.

### Put the database address in `.env` (you do this, it contains your password)
1. Supabase → project **ultimate-profit-tracker** → **Connect** → **Session pooler** → copy the URI.
2. Supabase → Project Settings → Database → **Reset database password** if you don't know it, and put it in the URI.
3. Create `~/Workspace/the-ultimate-profit-tracker/.env` with:
   ```
   DATABASE_URL="postgresql://postgres.YOUR-PROJECT-REF:YOUR-PASSWORD@aws-1-YOUR-REGION.pooler.supabase.com:5432/postgres"
   DIRECT_URL="postgresql://postgres.YOUR-PROJECT-REF:YOUR-PASSWORD@aws-1-YOUR-REGION.pooler.supabase.com:5432/postgres"
   ```
   (Copy the host exactly from Supabase; the line above shows the shape.)
4. The first `shopify app dev` creates all tables (`prisma migrate deploy`).

The free tier pauses after a week with no activity; un-pause it from the Supabase dashboard.

## Production (later — needs your approval, it costs money)
`render.yaml` defines two services, both Render **Starter** (about $7/month each):
- **web**: the app (admin pages, webhooks).
- **worker**: imports, recalculation and (later) ad syncs, `npm run worker:production`.

Both use the same `DATABASE_URL`. Use the Supabase **Session pooler** URL (port 5432): the worker keeps a
connection open for its job queue (pg-boss), which the transaction pooler (6543) doesn't support.
