import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getShop, saveSettings } from "../lib/shop.server";
import { enqueueRecompute } from "../lib/jobs.server";
import { todayIn } from "../lib/dates";
import { formatMoney, toCents } from "../lib/money";
import { isCodGateway, type GatewayFee } from "../lib/settings";
import { RULE_TEMPLATES } from "../lib/profit/rules";
import { describeFilters } from "../lib/profit/describe";
import { errorMessage } from "../lib/admin.server";
import { Button, Checkbox, NumberField, Select, TextArea, TextField } from "../components/fields";
import { downloadFile } from "../components/download";
import { Card, CardGrid, CardText, COST_HELP, COST_TABS, Explainer, GroupTitle, Pill, Tabs } from "../components/ui";

const PAGE = 40;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const missing = url.searchParams.get("missing") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const tab = (["fees", "extra"] as const).find((t) => t === url.searchParams.get("tab")) ?? "products";
  const row = await getShop(shop);

  // Variants whose current cost is unknown = no VariantCost rows at all.
  const withCost = await db.variantCost.findMany({ where: { shop }, distinct: ["variantId"], select: { variantId: true } });
  const costed = withCost.map((c) => c.variantId);
  const productMatches = q ? await db.product.findMany({ where: { shop, title: { contains: q, mode: "insensitive" } }, select: { id: true } }) : [];
  const where: Prisma.VariantWhereInput = {
    shop,
    ...(missing ? { id: { notIn: costed } } : {}),
    ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { productId: { in: productMatches.map((p) => p.id) } }] } : {}),
  };
  const [variants, total, missingCount] = await Promise.all([
    db.variant.findMany({ where, orderBy: [{ productId: "asc" }, { id: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
    db.variant.count({ where }),
    db.variant.count({ where: { shop, id: { notIn: costed } } }),
  ]);
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const [products, latest] = await Promise.all([
    db.product.findMany({ where: { shop, id: { in: productIds } } }),
    db.variantCost.findMany({ where: { shop, variantId: { in: variants.map((v) => v.id) } }, orderBy: { effectiveFrom: "desc" } }),
  ]);
  const titles = new Map(products.map((p) => [String(p.id), p.title]));
  const current = new Map<string, { cents: number; source: string; history: number }>();
  for (const c of latest) {
    const k = String(c.variantId);
    const e = current.get(k);
    if (!e) current.set(k, { cents: c.costCents, source: c.source, history: 1 });
    else e.history++;
  }

  // Gateways seen on orders, for fee rules.
  const gatewayRows = await db.$queryRaw<{ g: string; n: bigint }[]>`
    SELECT g, COUNT(*) AS n FROM "Order", unnest(gateways) AS g WHERE shop = ${shop} GROUP BY g ORDER BY n DESC LIMIT 20`;
  const settings = row.settingsParsed;

  const rules = await db.costRule.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });

  return {
    tab,
    currency: row.currency,
    q,
    missing,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    total,
    missingCount,
    variants: variants.map((v) => {
      const c = current.get(String(v.id));
      return { id: String(v.id), product: titles.get(String(v.productId)) ?? "", title: v.title, sku: v.sku, shopifyCost: v.shopifyCostCents, cost: c?.cents ?? null, source: c?.source ?? null, history: c?.history ?? 0 };
    }),
    gateways: gatewayRows.map((g) => ({ name: g.g, orders: Number(g.n), cod: isCodGateway(settings, [g.g]), fee: settings.gatewayFees.find((f) => f.gateway.toLowerCase() === g.g.toLowerCase()) ?? null })),
    cod: { pct: settings.codFeePct, flatCents: settings.codFeeCents },
    rules: rules.map((r) => ({ id: r.id, name: r.name, active: r.active, kind: r.kind, amount: Number(r.amount), period: r.period, filters: r.filters as Record<string, unknown> })),
    templates: RULE_TEMPLATES,
  };
};

async function recomputeAll(shop: string) {
  const row = await getShop(shop);
  const from = row.historyFrom ? row.historyFrom.toISOString().slice(0, 10) : todayIn(row.timezone);
  await enqueueRecompute(shop, from, todayIn(row.timezone));
}

/** Set a cost: "all" rewrites history (every past order uses it), "today" applies from now on. */
async function setCost(shop: string, variantId: bigint, cents: number, from: "all" | "today", source = "manual") {
  if (from === "all") await db.variantCost.deleteMany({ where: { shop, variantId } });
  await db.variantCost.create({ data: { shop, variantId, costCents: cents, source, effectiveFrom: from === "all" ? new Date(0) : new Date() } });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "cost") {
      await setCost(shop, BigInt(String(form.get("id"))), toCents(String(form.get("cost"))), form.get("from") === "today" ? "today" : "all");
      await recomputeAll(shop);
      return { ok: true, message: "Cost saved. Profit is being recalculated." };
    }
    if (intent === "costs_bulk") {
      const changes = JSON.parse(String(form.get("changes") ?? "[]")) as { id: string; cost: number }[];
      const from = form.get("from") === "today" ? "today" : "all";
      for (const c of changes) await setCost(shop, BigInt(c.id), Math.round(c.cost * 100), from);
      if (changes.length) await recomputeAll(shop);
      return { ok: true, message: `${changes.length} cost(s) saved. Profit is being recalculated.` };
    }
    if (intent === "csv") {
      const text = String(form.get("csv") ?? "");
      const from = form.get("from") === "today" ? "today" : "all";
      const result = await importCsv(shop, text, from);
      if (result.saved) await recomputeAll(shop);
      return { ok: result.saved > 0, message: `${result.saved} cost(s) saved${result.unknown.length ? `; not found: ${result.unknown.slice(0, 5).join(", ")}${result.unknown.length > 5 ? "…" : ""}` : ""}.` };
    }
    if (intent === "fees") {
      const fees = JSON.parse(String(form.get("fees"))) as GatewayFee[];
      await saveSettings(shop, {
        gatewayFees: fees.filter((f) => f.pct > 0 || f.flatCents > 0),
        codFeePct: Number(form.get("codPct") ?? 0),
        codFeeCents: toCents(String(form.get("codFlat") ?? 0)),
      });
      await recomputeAll(shop);
      return { ok: true, message: "Fees saved. Profit is being recalculated." };
    }
    if (intent === "toggle_rule") {
      await db.costRule.updateMany({ where: { id: String(form.get("id")), shop }, data: { active: form.get("active") === "true" } });
      await recomputeAll(shop);
      return { ok: true, message: "Saved." };
    }
    return { ok: false, message: "Unknown action." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

/** CSV: a header row with `sku` or `variant_id`, and `cost`. Comma or semicolon separated. */
async function importCsv(shop: string, text: string, from: "all" | "today") {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { saved: 0, unknown: [] as string[] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const head = lines[0].toLowerCase().split(sep).map((h) => h.trim().replace(/"/g, ""));
  const iSku = head.indexOf("sku");
  const iId = head.findIndex((h) => h === "variant_id" || h === "variant id" || h === "id");
  const iCost = head.findIndex((h) => h === "cost" || h === "unit_cost" || h === "cost per item");
  if (iCost < 0 || (iSku < 0 && iId < 0)) throw new Error("The CSV needs a `cost` column and a `sku` or `variant_id` column.");
  let saved = 0;
  const unknown: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const cost = Number(cells[iCost]?.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(cost)) continue;
    const key = iId >= 0 && cells[iId] ? cells[iId] : cells[iSku];
    const variant = iId >= 0 && /^\d+$/.test(cells[iId] ?? "")
      ? await db.variant.findUnique({ where: { shop_id: { shop, id: BigInt(cells[iId]) } } })
      : await db.variant.findFirst({ where: { shop, sku: cells[iSku] } });
    if (!variant) {
      unknown.push(key);
      continue;
    }
    await setCost(shop, variant.id, Math.round(cost * 100), from, "csv");
    saved++;
  }
  return { saved, unknown };
}

const KIND_LABEL: Record<string, string> = {
  per_order: "per order",
  per_item: "per item",
  pct_revenue: "% of sales",
  pct_gross_profit: "% of gross profit",
  period_amount: "spread over orders",
};

export default function Costs() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fm = (c: number | null) => (c === null ? "–" : formatMoney(c, data.currency));

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null ? q.delete(k) : q.set(k, v));
    navigate(`?${q}`);
  };

  return (
    <s-page heading="Costs" inlineSize="large">
      <s-stack gap="base">
        <Tabs items={COST_TABS} />
        <Explainer {...COST_HELP[data.tab as "products" | "fees" | "extra"]} />
        {data.tab === "products" ? <ProductCosts data={data} fetcher={fetcher} go={go} fm={fm} onExport={() => downloadFile("/app/export/costs.csv", "product-costs.csv").catch(() => shopify.toast.show("Export failed", { isError: true }))} /> : null}
        {data.tab === "fees" ? <Fees data={data} fetcher={fetcher} /> : null}
        {data.tab === "extra" ? <ExtraCosts data={data} fetcher={fetcher} fm={fm} /> : null}
      </s-stack>
    </s-page>
  );
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Fetcher = ReturnType<typeof useFetcher<typeof action>>;

function ProductCosts({ data, fetcher, go, fm, onExport }: { data: Data; fetcher: Fetcher; go: (p: Record<string, string | null>) => void; fm: (c: number | null) => string; onExport: () => void }) {
  const [search, setSearch] = useState(data.q);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [from, setFrom] = useState<"all" | "today">("all");
  const [csv, setCsv] = useState("");
  const [csvFrom, setCsvFrom] = useState("all");
  const changes = Object.entries(edits).filter(([id, v]) => {
    const row = data.variants.find((x) => x.id === id);
    return row && (row.cost === null || Math.round(v * 100) !== row.cost);
  });
  return (
    <>
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
            <s-paragraph>
              The cost you pay per item. Taken from Shopify&apos;s “Cost per item”; change it here any time.{" "}
              {data.missingCount ? <Pill tone="warn">{`${data.missingCount} missing`}</Pill> : <Pill tone="ok">All set</Pill>}
            </s-paragraph>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="end">
            <TextField label="Search products or SKU" value={search} onValue={setSearch} />
            <Button onClick={() => go({ q: search || null, page: null })}>Search</Button>
            <Checkbox label="Only missing costs" checked={data.missing} onValue={(v) => go({ missing: v ? "1" : null, page: null })} />
          </s-stack>
        </s-stack>
      </s-section>

      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header>SKU</s-table-header>
            <s-table-header format="numeric">In Shopify</s-table-header>
            <s-table-header>Cost per item</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.variants.map((v) => (
              <s-table-row key={v.id}>
                <s-table-cell>
                  {v.product}
                  {v.title && v.title !== "Default Title" ? <s-text color="subdued"> · {v.title}</s-text> : null}
                </s-table-cell>
                <s-table-cell>{v.sku ?? "–"}</s-table-cell>
                <s-table-cell>{fm(v.shopifyCost)}</s-table-cell>
                <s-table-cell>
                  <s-box inlineSize="140px">
                    <NumberField
                      label={`Cost for ${v.product}`}
                      labelAccessibilityVisibility="exclusive"
                      placeholder="Missing"
                      value={edits[v.id] ?? (v.cost === null ? 0 : v.cost / 100)}
                      min={0}
                      step={0.01}
                      onValue={(n) => setEdits((e) => ({ ...e, [v.id]: n }))}
                    />
                  </s-box>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-stack direction="inline" gap="base" alignItems="end" justifyContent="space-between">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <Button disabled={data.page <= 1} onClick={() => go({ page: String(data.page - 1) })}>
            Previous
          </Button>
          <s-text color="subdued">
            Page {data.page} of {data.pages}
          </s-text>
          <Button disabled={data.page >= data.pages} onClick={() => go({ page: String(data.page + 1) })}>
            Next
          </Button>
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="end">
          <Select label="Apply changes to" value={from} onValue={(x) => setFrom(x as "all" | "today")} options={[{ value: "all", label: "All past and future orders" }, { value: "today", label: "Orders from today on" }]} />
          <Button
            variant="primary"
            disabled={!changes.length}
            loading={fetcher.state !== "idle"}
            onClick={() => {
              fetcher.submit({ intent: "costs_bulk", from, changes: JSON.stringify(changes.map(([id, cost]) => ({ id, cost }))) }, { method: "post" });
              setEdits({});
            }}
          >
            {changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "Save"}
          </Button>
        </s-stack>
      </s-stack>

      <s-section heading="Import or export (CSV)">
        <s-stack gap="base">
          <s-paragraph>Export the list, fill in the cost column in Excel or Google Sheets, then paste it back here.</s-paragraph>
          <s-stack direction="inline">
            <Button icon="export" onClick={onExport}>
              Export product costs
            </Button>
          </s-stack>
          <TextArea label="Paste CSV" details="Columns: sku (or variant_id) and cost." value={csv} onValue={setCsv} rows={4} />
          <s-stack direction="inline" gap="base" alignItems="end">
            <Select label="Apply to" value={csvFrom} onValue={setCsvFrom} options={[{ value: "all", label: "All past and future orders" }, { value: "today", label: "Orders from today on" }]} />
            <Button disabled={!csv.trim()} onClick={() => fetcher.submit({ intent: "csv", csv, from: csvFrom }, { method: "post" })}>
              Import costs
            </Button>
          </s-stack>
        </s-stack>
      </s-section>
    </>
  );
}

function Fees({ data, fetcher }: { data: Data; fetcher: Fetcher }) {
  const [fees, setFees] = useState(() => data.gateways.filter((g) => !g.cod).map((g) => ({ gateway: g.name, pct: g.fee?.pct ?? 0, flatCents: g.fee?.flatCents ?? 0 })));
  const [cod, setCod] = useState({ pct: data.cod.pct, flat: data.cod.flatCents / 100 });
  return (
    <s-section heading="Payment fees">
      <s-stack gap="base">
        <s-paragraph>What your payment providers keep from each order. Shopify Payments fees are read automatically when Shopify reports them.</s-paragraph>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Payment method</s-table-header>
            <s-table-header>Fee %</s-table-header>
            <s-table-header>Fixed per order</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {fees.map((f, i) => (
              <s-table-row key={f.gateway}>
                <s-table-cell>{f.gateway}</s-table-cell>
                <s-table-cell>
                  <s-box inlineSize="120px">
                    <NumberField label={`${f.gateway} fee %`} labelAccessibilityVisibility="exclusive" value={f.pct} min={0} max={20} step={0.01} suffix="%" onValue={(v) => setFees(fees.map((x, j) => (j === i ? { ...x, pct: v } : x)))} />
                  </s-box>
                </s-table-cell>
                <s-table-cell>
                  <s-box inlineSize="120px">
                    <NumberField label={`${f.gateway} fixed fee`} labelAccessibilityVisibility="exclusive" value={f.flatCents / 100} min={0} step={0.01} onValue={(v) => setFees(fees.map((x, j) => (j === i ? { ...x, flatCents: Math.round(v * 100) } : x)))} />
                  </s-box>
                </s-table-cell>
              </s-table-row>
            ))}
            <s-table-row>
              <s-table-cell>Cash on delivery (default; zones can override)</s-table-cell>
              <s-table-cell>
                <s-box inlineSize="120px">
                  <NumberField label="COD fee %" labelAccessibilityVisibility="exclusive" value={cod.pct} min={0} max={20} step={0.1} suffix="%" onValue={(v) => setCod({ ...cod, pct: v })} />
                </s-box>
              </s-table-cell>
              <s-table-cell>
                <s-box inlineSize="120px">
                  <NumberField label="COD fixed fee" labelAccessibilityVisibility="exclusive" value={cod.flat} min={0} step={0.5} onValue={(v) => setCod({ ...cod, flat: v })} />
                </s-box>
              </s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
        <s-stack direction="inline" justifyContent="end">
          <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "fees", fees: JSON.stringify(fees), codPct: String(cod.pct), codFlat: String(cod.flat) }, { method: "post" })}>
            Save fees
          </Button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function ExtraCosts({ data, fetcher, fm }: { data: Data; fetcher: Fetcher; fm: (c: number | null) => string }) {
  return (
    <>
      <s-section>
        <s-stack gap="base">
          <s-paragraph>
            Anything else that costs you money: fulfilment, packaging, salaries, apps, influencers. Choose which orders each
            cost belongs to and the app adds it to exactly those orders.
          </s-paragraph>
          <s-stack direction="inline" gap="small-200">
            <Button variant="primary" href="/app/costs/rules/new">
              Add a cost
            </Button>
          </s-stack>
        </s-stack>
      </s-section>
      <GroupTitle>Start from a template</GroupTitle>
      <CardGrid cols={3}>
        {data.templates.map((t) => (
          <Card key={t.id} title={t.name} actions={<Button href={`/app/costs/rules/new?template=${t.id}`}>Use</Button>}>
            <CardText>{t.hint}</CardText>
          </Card>
        ))}
      </CardGrid>
      {data.rules.length ? (
        <s-section heading="Your costs" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Cost</s-table-header>
              <s-table-header>How it&apos;s charged</s-table-header>
              <s-table-header>Applies to</s-table-header>
              <s-table-header>Active</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rules.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`/app/costs/rules/${r.id}`}>{r.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {r.kind.startsWith("pct") ? `${r.amount}%` : fm(r.amount)} {KIND_LABEL[r.kind]}
                    {r.period ? ` (${r.period})` : ""}
                  </s-table-cell>
                  <s-table-cell>{describeFilters(r.filters)}</s-table-cell>
                  <s-table-cell>
                    <Checkbox label={r.active ? "On" : "Off"} checked={r.active} onValue={(v) => fetcher.submit({ intent: "toggle_rule", id: r.id, active: String(v) }, { method: "post" })} />
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
