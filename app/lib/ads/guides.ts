/**
 * Step-by-step "connect your ads" guides with deep links into the merchant's own, already
 * logged-in ad platforms. The merchant pastes one link from their Ads Manager once; we read
 * their business / ad account ids from it so every button opens *their* account on the right page.
 * Pure (no server imports): used by the page and unit-tested.
 */
export type AdIds = {
  metaBusinessId?: string;
  metaAdAccountId?: string; // digits only, without "act_"
  googleOcid?: string; // Google Ads' internal account id used in its URLs
  googleAuthUser?: string; // which signed-in Google account (0, 1, …)
  googleCustomerId?: string; // 123-456-7890
  tiktokAdvertiserId?: string;
};

export type GuidePlatform = "meta" | "google" | "tiktok";

export type GuideStep = {
  id: string;
  title: string;
  body: string;
  /** Opens in a new tab, already on the merchant's account when we know their ids. */
  link?: { label: string; url: string };
  /** Text the merchant copies (UTM parameters, a name, the Google script…). */
  copy?: { label: string; value: string; multiline?: boolean };
  /** If the page looks different: where to click instead. */
  fallback?: string;
  /** The step finishes inside the app (paste a key, upload a file, check the connection). */
  action?: "meta_token" | "upload" | "google_check";
};

const digits = (v: string | null | undefined) => (v && /^\d{5,}$/.test(v) ? v : undefined);

/** Read account ids from any link copied from Meta, Google Ads or TikTok Ads Manager. */
export function idsFromUrl(raw: string): Partial<AdIds> {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  } catch {
    // A bare number: ad account / advertiser ids are all digits; the page decides which.
    return {};
  }
  const q = url.searchParams;
  const host = url.hostname;
  const out: Partial<AdIds> = {};
  if (host.endsWith("facebook.com") || host.endsWith("meta.com")) {
    out.metaBusinessId = digits(q.get("business_id")) ?? digits(q.get("global_scope_id"));
    const act = q.get("act") ?? q.get("selected_ad_account_id") ?? q.get("ad_account_id");
    out.metaAdAccountId = digits(act?.replace(/^act_/, ""));
  } else if (host.endsWith("ads.google.com")) {
    out.googleOcid = digits(q.get("ocid"));
    out.googleAuthUser = q.get("authuser") && /^\d+$/.test(q.get("authuser")!) ? q.get("authuser")! : undefined;
    const c = q.get("__c") ?? q.get("__e");
    out.googleCustomerId = c && /^\d{10}$/.test(c) ? `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}` : undefined;
  } else if (host.includes("tiktok.com")) {
    out.tiktokAdvertiserId = digits(q.get("aadvid") ?? q.get("advertiser_id"));
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export function hasIds(platform: GuidePlatform, ids: AdIds): boolean {
  if (platform === "meta") return !!ids.metaBusinessId || !!ids.metaAdAccountId;
  if (platform === "google") return !!ids.googleOcid;
  return !!ids.tiktokAdvertiserId;
}

/** Where the merchant copies the "personal link" from. */
export const PERSONALISE: Record<GuidePlatform, { open: string; label: string; hint: string }> = {
  meta: { open: "https://adsmanager.facebook.com/adsmanager/manage/campaigns", label: "Open Meta Ads Manager", hint: "Copy the whole address from the top of the browser (it contains business_id and act=…) and paste it here." },
  google: { open: "https://ads.google.com/aw/overview", label: "Open Google Ads", hint: "Pick your account, then copy the whole address from the top of the browser (it contains ocid=…) and paste it here." },
  tiktok: { open: "https://ads.tiktok.com/i18n/dashboard", label: "Open TikTok Ads Manager", hint: "Copy the whole address from the top of the browser (it contains aadvid=…) and paste it here." },
};

function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const links = {
  meta: {
    createApp: () => "https://developers.facebook.com/apps/creation/",
    systemUsers: (ids: AdIds) => `https://business.facebook.com/latest/settings/system_users${query({ business_id: ids.metaBusinessId })}`,
    apps: (ids: AdIds) => `https://business.facebook.com/latest/settings/apps${query({ business_id: ids.metaBusinessId })}`,
    adAccounts: (ids: AdIds) => `https://business.facebook.com/latest/settings/ad_accounts${query({ business_id: ids.metaBusinessId })}`,
    ads: (ids: AdIds) => `https://adsmanager.facebook.com/adsmanager/manage/ads${query({ act: ids.metaAdAccountId, business_id: ids.metaBusinessId })}`,
  },
  google: {
    scripts: (ids: AdIds) => `https://ads.google.com/aw/bulk/scripts${query({ ocid: ids.googleOcid, authuser: ids.googleAuthUser })}`,
    accountSettings: (ids: AdIds) => `https://ads.google.com/aw/settings/account${query({ ocid: ids.googleOcid, authuser: ids.googleAuthUser })}`,
    ads: (ids: AdIds) => `https://ads.google.com/aw/ads${query({ ocid: ids.googleOcid, authuser: ids.googleAuthUser })}`,
  },
  tiktok: {
    reporting: (ids: AdIds) => `https://ads.tiktok.com/i18n/reporting${query({ aadvid: ids.tiktokAdvertiserId })}`,
    ads: (ids: AdIds) => `https://ads.tiktok.com/i18n/perf/creative${query({ aadvid: ids.tiktokAdvertiserId })}`,
  },
};

export const UTM = {
  meta: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}",
  tiktok: "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_ID__&utm_term=__AID__&utm_content=__CID__",
  google: "{lpurl}?utm_source=google&utm_medium=paid&utm_campaign={campaignid}&utm_term={adgroupid}&utm_content={creative}",
};

/** Meta, automatic: a read-only, never-expiring key from the merchant's own Business Settings. */
export function metaKeySteps(ids: AdIds): GuideStep[] {
  return [
    {
      id: "meta-app",
      title: "Create your free Meta app",
      body: "Click Create app → name it “Profit Tracker” → use case “Measure ad performance data with Marketing API” → choose your business portfolio → Create.",
      link: { label: "Open Meta for Developers", url: links.meta.createApp() },
      copy: { label: "App name", value: "Profit Tracker" },
      fallback: "developers.facebook.com → My Apps → Create app.",
    },
    {
      id: "meta-system-user",
      title: "Add a system user",
      body: "Click Add → name “Profit Tracker” → role Employee → Create system user.",
      link: { label: "Open System users", url: links.meta.systemUsers(ids) },
      copy: { label: "Name", value: "Profit Tracker" },
      fallback: "business.facebook.com → Settings → Users → System users.",
    },
    {
      id: "meta-assign",
      title: "Let it read your ad account",
      body: "On the system user, click Assign assets → Ad accounts → tick your ad account → turn on “View performance” (nothing else) → Save.",
      link: { label: "Open System users", url: links.meta.systemUsers(ids) },
      fallback: "Settings → Users → System users → your system user → Assign assets.",
    },
    {
      id: "meta-app-link",
      title: "Connect the app to your business",
      body: "If “Profit Tracker” isn't listed, click Add → Connect an app ID → paste your app's ID (shown at the top of the app's dashboard).",
      link: { label: "Open Apps", url: links.meta.apps(ids) },
      fallback: "Settings → Accounts → Apps.",
    },
    {
      id: "meta-token",
      title: "Create the access key",
      body: "On the system user, click Generate token → choose “Profit Tracker” → expiry Never → tick ads_read (only) → Generate → copy the key.",
      link: { label: "Open System users", url: links.meta.systemUsers(ids) },
      fallback: "Settings → Users → System users → Generate token.",
    },
    { id: "meta-paste", title: "Paste the key here", body: "The app checks the key and imports your ad numbers.", action: "meta_token" },
    {
      id: "meta-utm",
      title: "Match every order to its ad (recommended)",
      body: "Select all your ads → Edit → Tracking → URL parameters → paste this → Publish. New orders then show exactly which ad sold them.",
      link: { label: "Open your ads", url: links.meta.ads(ids) },
      copy: { label: "URL parameters", value: UTM.meta },
      fallback: "Ads Manager → Ads tab → tick ads → Edit → Tracking.",
    },
  ];
}

/** Meta (or any platform), manual: export a report and upload it. */
export function metaUploadSteps(ids: AdIds): GuideStep[] {
  return [
    {
      id: "meta-export",
      title: "Export your ads report",
      body: "In the Ads tab: Breakdown → By time → Day. Then Reports → Export table data → CSV.",
      link: { label: "Open your ads", url: links.meta.ads(ids) },
      fallback: "Ads Manager → Ads → Breakdown → Day → Export.",
    },
    { id: "meta-upload", title: "Upload the CSV here", body: "Re-upload whenever you want fresher numbers; the same days are replaced, never doubled.", action: "upload" },
  ];
}

export function googleSteps(ids: AdIds, script: string): GuideStep[] {
  return [
    {
      id: "google-copy",
      title: "Copy your personal script",
      body: "It only reads your account and sends the numbers to this app. It contains a private key for your store, so don't share it.",
      copy: { label: "Google Ads script", value: script, multiline: true },
    },
    {
      id: "google-new",
      title: "Create the script in Google Ads",
      body: "Click the blue + → New script → delete what's there → paste → name it “Profit Tracker”.",
      link: { label: "Open Scripts in Google Ads", url: links.google.scripts(ids) },
      fallback: "Google Ads → Tools → Bulk actions → Scripts.",
    },
    { id: "google-run", title: "Authorize and run it once", body: "Click Authorize (allow access), then Run. Your numbers appear here a minute later.", action: "google_check" },
    { id: "google-daily", title: "Set it to run daily", body: "In the scripts list, set Frequency to Daily. Done: it updates every day by itself.", link: { label: "Open Scripts", url: links.google.scripts(ids) } },
    {
      id: "google-utm",
      title: "Match every order to its ad (recommended)",
      body: "In Tracking, set the Tracking template to this and Save.",
      link: { label: "Open account settings", url: links.google.accountSettings(ids) },
      copy: { label: "Tracking template", value: UTM.google },
      fallback: "Google Ads → Admin → Account settings → Tracking.",
    },
  ];
}

export function tiktokSteps(ids: AdIds): GuideStep[] {
  return [
    {
      id: "tiktok-report",
      title: "Create a daily report",
      body: "Create custom report → dimensions: Day, Campaign, Ad group, Ad → metrics: Cost, Impressions, Clicks, Complete payment, Total complete payment value → Save.",
      link: { label: "Open TikTok reporting", url: links.tiktok.reporting(ids) },
      fallback: "TikTok Ads Manager → Analytics → Custom reports.",
    },
    { id: "tiktok-export", title: "Export it as CSV", body: "Pick the dates → Export → CSV. (Tip: schedule it to email you weekly.)", link: { label: "Open TikTok reporting", url: links.tiktok.reporting(ids) } },
    { id: "tiktok-upload", title: "Upload the CSV here", body: "Same days are replaced, never doubled.", action: "upload" },
    {
      id: "tiktok-utm",
      title: "Match every order to its ad (recommended)",
      body: "Edit your ads → Destination → URL parameters → paste this → Publish.",
      link: { label: "Open your ads", url: links.tiktok.ads(ids) },
      copy: { label: "URL parameters", value: UTM.tiktok },
      fallback: "TikTok Ads Manager → Campaign → Ads → Edit.",
    },
  ];
}
