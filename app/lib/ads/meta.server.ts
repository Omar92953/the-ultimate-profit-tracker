import db from "../../db.server";
import { decrypt, encrypt, sign } from "../crypto.server";
import { addDays } from "../dates";
import { META_INSIGHT_FIELDS, parseMetaInsight, type AdDay, type MetaInsight } from "./meta";
import { saveAdDays } from "./store.server";

/**
 * Meta (Facebook & Instagram) Marketing API: login, ad accounts and daily ad-level insights.
 * Works in development mode for the app's own admins/testers; other businesses need the app's
 * Advanced Access (business verification + App Review).
 */
const VERSION = () => process.env.META_GRAPH_VERSION || "v25.0";
const GRAPH = () => `https://graph.facebook.com/${VERSION()}`;

export function metaConfigured(): boolean {
  return !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
}

export function metaRedirectUri(): string {
  return `${(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "")}/meta/callback`;
}

/** URL of our own /meta/start page, carrying a signed note of which shop is connecting. */
export function metaStartUrl(shop: string): string {
  return `${(process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "")}/meta/start?state=${encodeURIComponent(sign({ shop, p: "meta" }))}`;
}

export function metaDialogUrl(state: string): string {
  const q = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: metaRedirectUri(), state, response_type: "code" });
  // Facebook Login for Business uses a configuration id; classic login uses scopes.
  if (process.env.META_LOGIN_CONFIG_ID) q.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  else q.set("scope", "ads_read,business_management");
  return `https://www.facebook.com/${VERSION()}/dialog/oauth?${q}`;
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH()}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: { message: string; code?: number } };
  if (!res.ok || json.error) throw new Error(`Meta: ${json.error?.message ?? res.status}`);
  return json;
}

/** Code → long-lived user token (about 60 days). */
export async function exchangeCode(code: string): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: metaRedirectUri(),
    code,
  });
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: short.access_token,
  });
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
}

export async function listAdAccounts(token: string): Promise<{ id: string; name: string; currency: string; status: number }[]> {
  const out: { id: string; name: string; currency: string; status: number }[] = [];
  let next: string | null = null;
  let page = await graph<{ data: { id: string; name: string; currency: string; account_status: number }[]; paging?: { next?: string } }>("me/adaccounts", {
    fields: "id,name,currency,account_status",
    limit: "100",
    access_token: token,
  });
  for (;;) {
    out.push(...page.data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status })));
    next = page.paging?.next ?? null;
    if (!next) break;
    page = await graph(next, {});
  }
  return out;
}

/** Store every ad account the person can see (active = status 1). The merchant can switch any off. */
export async function saveMetaAccounts(shop: string, token: string, expiresAt: Date | null): Promise<number> {
  const accounts = await listAdAccounts(token);
  const sealed = encrypt(token);
  for (const a of accounts) {
    await db.adAccount.upsert({
      where: { shop_platform_externalId: { shop, platform: "meta", externalId: a.id } },
      create: { shop, platform: "meta", externalId: a.id, name: a.name, currency: a.currency, accessToken: sealed, tokenExpiresAt: expiresAt, status: a.status === 1 ? "active" : "paused" },
      update: { name: a.name, currency: a.currency, accessToken: sealed, tokenExpiresAt: expiresAt, lastError: null },
    });
  }
  return accounts.length;
}

/** Pull ad-level daily insights for one account, 30 days per request window. */
export async function syncMetaAccount(accountRowId: string, from: string, to: string): Promise<{ saved: number; from: string | null; to: string | null }> {
  const account = await db.adAccount.findUniqueOrThrow({ where: { id: accountRowId } });
  const shop = await db.shop.findUniqueOrThrow({ where: { id: account.shop } });
  if (!account.accessToken) throw new Error("Not connected");
  const token = decrypt(account.accessToken);
  const rows: AdDay[] = [];
  for (let start = from; start <= to; start = addDays(start, 30)) {
    const end = addDays(start, 29) < to ? addDays(start, 29) : to;
    let page = await graph<{ data: MetaInsight[]; paging?: { next?: string } }>(`${account.externalId}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since: start, until: end }),
      fields: META_INSIGHT_FIELDS,
      limit: "500",
      access_token: token,
    });
    for (;;) {
      rows.push(...page.data.map((r) => parseMetaInsight(r, account.currency ?? "USD")));
      if (!page.paging?.next) break;
      page = await graph(page.paging.next, {});
    }
  }
  const result = await saveAdDays(account.shop, "meta", account.externalId, rows, shop.currency);
  await db.adAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date(), lastError: null } });
  return result;
}

/**
 * "Connect with your own access key": the merchant creates a System User token in THEIR Business
 * Settings (with their own Meta app) and pastes it. No verification on our side; we only ever see
 * what that key allows.
 */
export async function connectMetaWithToken(shop: string, token: string): Promise<number> {
  const clean = token.trim();
  if (!/^[A-Za-z0-9]{40,}$/.test(clean)) throw new Error("That doesn't look like a Meta access token. Copy the whole token from Business Settings.");
  const count = await saveMetaAccounts(shop, clean, null);
  if (!count) throw new Error("The token works but can't see any ad account. In Business Settings, assign the ad account to the system user, then generate the token again.");
  return count;
}
