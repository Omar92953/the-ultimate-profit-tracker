import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { citiesIn, linkOrdersToZones, refreshZones, zoneLabel } from "../lib/zones.server";
import { enqueueRecompute } from "../lib/jobs.server";
import { getShop } from "../lib/shop.server";
import { todayIn } from "../lib/dates";
import { formatMoney, toCents } from "../lib/money";
import { errorMessage } from "../lib/admin.server";
import { Button, Checkbox, NumberField, TextArea } from "../components/fields";
import { COST_HELP, COST_TABS, Explainer, Tabs } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [row, zones, returned] = await Promise.all([
    getShop(shop),
    db.shippingZone.findMany({ where: { shop }, orderBy: [{ configured: "asc" }, { orderCount: "desc" }] }),
    db.order.groupBy({ by: ["zoneId"], where: { shop, outcome: "returned" }, _count: { _all: true } }),
  ]);
  const returnedBy = new Map(returned.map((r) => [r.zoneId, r._count._all]));
  return {
    currency: row.currency,
    zones: zones.map((z) => ({
      id: z.id,
      label: z.label,
      countryCode: z.countryCode,
      province: z.province,
      city: z.city,
      orders: z.orderCount,
      returned: returnedBy.get(z.id) ?? 0,
      configured: z.configured,
      delivery: z.deliveryCents,
      perItem: z.perItemCents,
      perKg: z.perKgCents,
      returnCost: z.returnCents,
      codPct: z.codFeePct === null ? null : Number(z.codFeePct),
      codFlat: z.codFeeCents,
    })),
  };
};

async function recomputeAll(shop: string) {
  const row = await getShop(shop);
  const from = row.historyFrom ? row.historyFrom.toISOString().slice(0, 10) : todayIn(row.timezone);
  await enqueueRecompute(shop, from, todayIn(row.timezone));
}

const cents = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : toCents(String(v)));

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "save") {
      const id = String(form.get("id"));
      const delivery = cents(form.get("delivery"));
      await db.shippingZone.updateMany({
        where: { id, shop },
        data: {
          deliveryCents: delivery,
          returnCents: cents(form.get("returnCost")),
          perItemCents: cents(form.get("perItem")),
          perKgCents: cents(form.get("perKg")),
          codFeePct: form.get("codPct") === "" || form.get("codPct") === null ? null : Number(form.get("codPct")),
          codFeeCents: cents(form.get("codFlat")),
          configured: delivery !== null,
        },
      });
      await recomputeAll(shop);
      return { ok: true, message: "Zone saved. Profit is being recalculated." };
    }
    if (intent === "bulk") {
      const ids = String(form.get("ids")).split(",").filter(Boolean);
      const delivery = cents(form.get("delivery"));
      if (!ids.length || delivery === null) return { ok: false, message: "Choose zones and enter a delivery cost." };
      await db.shippingZone.updateMany({ where: { shop, id: { in: ids } }, data: { deliveryCents: delivery, returnCents: cents(form.get("returnCost")), configured: true } });
      await recomputeAll(shop);
      return { ok: true, message: `${ids.length} zones saved. Profit is being recalculated.` };
    }
    if (intent === "cities") {
      const zone = await db.shippingZone.findFirst({ where: { id: String(form.get("id")), shop } });
      if (!zone) return { ok: false, message: "Zone not found." };
      return { ok: true, message: null, cities: await citiesIn(shop, zone.countryCode, zone.province), zoneId: zone.id };
    }
    if (intent === "split") {
      const zone = await db.shippingZone.findFirst({ where: { id: String(form.get("id")), shop } });
      if (!zone) return { ok: false, message: "Zone not found." };
      const cities = String(form.get("cities")).split("\n").map((c) => c.trim()).filter(Boolean);
      for (const city of cities) {
        const key = `${zone.countryCode}|${zone.province ?? ""}|${city.toLowerCase()}`;
        await db.shippingZone.upsert({
          where: { shop_key: { shop, key } },
          // City zones start with the province's prices so nothing becomes unpriced.
          create: {
            shop, key, countryCode: zone.countryCode, province: zone.province, city: city.toLowerCase(), label: zoneLabel(zone.countryCode, zone.province, city),
            deliveryCents: zone.deliveryCents, returnCents: zone.returnCents, perItemCents: zone.perItemCents, perKgCents: zone.perKgCents, codFeePct: zone.codFeePct, codFeeCents: zone.codFeeCents, configured: zone.configured,
          },
          update: {},
        });
      }
      await linkOrdersToZones(shop);
      await refreshZones(shop);
      await recomputeAll(shop);
      return { ok: true, message: `${cities.length} city zone(s) added.` };
    }
    if (intent === "refresh") {
      const { created } = await refreshZones(shop);
      return { ok: true, message: created ? `${created} new zone(s) found.` : "No new zones." };
    }
    return { ok: false, message: "Unknown action." };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
};

type Zone = ReturnType<typeof useLoaderData<typeof loader>>["zones"][number];

export default function Zones() {
  const { zones, currency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [editing, setEditing] = useState<Zone | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState({ delivery: 0, returnCost: 0 });
  const fm = (c: number | null) => (c === null ? "–" : formatMoney(c, currency));
  const unpriced = zones.filter((z) => !z.configured && z.orders > 0);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-page heading="Costs" inlineSize="large">
      <Button slot="secondary-actions" onClick={() => fetcher.submit({ intent: "refresh" }, { method: "post" })}>
        Find new zones
      </Button>
      <s-stack gap="base">
        <Tabs items={COST_TABS} />
        <Explainer {...COST_HELP.shipping} />
        {unpriced.length ? (
          <s-section heading={`${unpriced.length} zone(s) need a cost`}>
            <s-stack gap="base">
              <s-paragraph>Tick zones that share a price and set them at once.</s-paragraph>
              <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="small-200">
                {unpriced.map((z) => (
                  <Checkbox key={z.id} label={`${z.label} (${z.orders})`} checked={selected.includes(z.id)} onValue={(on) => setSelected(on ? [...selected, z.id] : selected.filter((x) => x !== z.id))} />
                ))}
              </s-grid>
              <s-stack direction="inline" gap="base" alignItems="end">
                <NumberField label="Delivery cost" value={bulk.delivery} min={0} step={1} onValue={(v) => setBulk({ ...bulk, delivery: v })} />
                <NumberField label="Return cost (refused)" value={bulk.returnCost} min={0} step={1} onValue={(v) => setBulk({ ...bulk, returnCost: v })} />
                <Button variant="primary" disabled={!selected.length} onClick={() => fetcher.submit({ intent: "bulk", ids: selected.join(","), delivery: String(bulk.delivery), returnCost: String(bulk.returnCost) }, { method: "post" })}>
                  Set for {selected.length || ""} zone(s)
                </Button>
                <Button variant="tertiary" onClick={() => setSelected(selected.length === unpriced.length ? [] : unpriced.map((z) => z.id))}>
                  {selected.length === unpriced.length ? "Clear" : "Select all"}
                </Button>
              </s-stack>
            </s-stack>
          </s-section>
        ) : null}

        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Zone</s-table-header>
              <s-table-header format="numeric">Orders</s-table-header>
              <s-table-header format="numeric">Returned</s-table-header>
              <s-table-header format="numeric">Delivery</s-table-header>
              <s-table-header format="numeric">Return</s-table-header>
              <s-table-header>COD fee</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {zones.map((z) => (
                <s-table-row key={z.id}>
                  <s-table-cell>
                    {z.label}
                    {!z.configured ? <s-badge tone="warning">No cost</s-badge> : null}
                  </s-table-cell>
                  <s-table-cell>{z.orders}</s-table-cell>
                  <s-table-cell>{z.orders ? `${Math.round((z.returned / z.orders) * 100)}%` : "–"}</s-table-cell>
                  <s-table-cell>
                    {fm(z.delivery)}
                    {z.perItem ? ` +${fm(z.perItem)}/item` : ""}
                    {z.perKg ? ` +${fm(z.perKg)}/kg` : ""}
                  </s-table-cell>
                  <s-table-cell>{fm(z.returnCost)}</s-table-cell>
                  <s-table-cell>{z.codPct !== null || z.codFlat !== null ? `${z.codPct ?? 0}% + ${fm(z.codFlat ?? 0)}` : "Default"}</s-table-cell>
                  <s-table-cell>
                    <Button variant="tertiary" commandFor="zone-modal" onClick={() => setEditing(z)}>
                      Edit
                    </Button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      </s-stack>

      <s-modal id="zone-modal" heading={editing ? editing.label : "Zone"}>
        {editing ? <ZoneForm key={editing.id} zone={editing} fetcher={fetcher} /> : null}
      </s-modal>
    </s-page>
  );
}

function ZoneForm({ zone, fetcher }: { zone: Zone; fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  const unit = (c: number | null) => (c === null ? "" : String(c / 100));
  const [v, setV] = useState({
    delivery: unit(zone.delivery),
    returnCost: unit(zone.returnCost),
    perItem: unit(zone.perItem),
    perKg: unit(zone.perKg),
    codPct: zone.codPct === null ? "" : String(zone.codPct),
    codFlat: unit(zone.codFlat),
  });
  const [cities, setCities] = useState("");
  const num = (s: string) => (s === "" ? 0 : Number(s));
  const set = (k: keyof typeof v) => (n: number) => setV({ ...v, [k]: String(n) });
  const citiesFetcher = useFetcher<typeof action>();
  const found = citiesFetcher.data && "cities" in citiesFetcher.data ? citiesFetcher.data.cities : null;

  return (
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <NumberField label="Delivery cost per order" value={num(v.delivery)} min={0} step={1} onValue={set("delivery")} />
        <NumberField label="Return cost (refused / returned)" details="Charged on top of delivery." value={num(v.returnCost)} min={0} step={1} onValue={set("returnCost")} />
        <NumberField label="Extra per item after the first" value={num(v.perItem)} min={0} step={1} onValue={set("perItem")} />
        <NumberField label="Extra per kg after the first" value={num(v.perKg)} min={0} step={1} onValue={set("perKg")} />
        <NumberField label="COD collection fee %" details="Leave 0 to use the default in Settings." value={num(v.codPct)} min={0} max={100} step={0.1} onValue={set("codPct")} />
        <NumberField label="COD collection fee (flat)" value={num(v.codFlat)} min={0} step={1} onValue={set("codFlat")} />
      </s-grid>
      {!zone.city ? (
        <s-stack gap="small-200">
          <s-heading>Different prices inside {zone.province ?? "this zone"}?</s-heading>
          <Button variant="tertiary" onClick={() => citiesFetcher.submit({ intent: "cities", id: zone.id }, { method: "post" })}>
            Show cities from orders
          </Button>
          {found ? (
            <s-text color="subdued">
              {found.length ? found.slice(0, 30).map((c) => `${c.city} (${c.orders})`).join(", ") : "No cities on these orders."}
            </s-text>
          ) : null}
          <TextArea label="Cities to split out (one per line)" value={cities} onValue={setCities} rows={3} />
          <Button disabled={!cities.trim()} onClick={() => fetcher.submit({ intent: "split", id: zone.id, cities }, { method: "post" })}>
            Split into city zones
          </Button>
        </s-stack>
      ) : null}
      <div>
        <s-stack direction="inline" gap="small-200" justifyContent="end">
          <Button commandFor="zone-modal" command="--hide">
            Cancel
          </Button>
          <Button
            variant="primary"
            commandFor="zone-modal"
            command="--hide"
            onClick={() => fetcher.submit({ intent: "save", id: zone.id, ...v, delivery: v.delivery }, { method: "post" })}
          >
            Save
          </Button>
        </s-stack>
      </div>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
