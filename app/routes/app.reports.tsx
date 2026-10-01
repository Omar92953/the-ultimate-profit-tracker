import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadRange } from "../lib/range.server";
import { REPORTS } from "../lib/reports.server";
import { rangeLabel } from "../lib/dates";
import { DateRangePicker } from "../components/DateRangePicker";
import { Button } from "../components/fields";
import { downloadFile } from "../components/download";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ctx = await loadRange(request, session.shop);
  return { range: ctx.range, today: ctx.today, earliest: ctx.earliest, reports: REPORTS };
};

export default function Reports() {
  const { range, today, earliest, reports } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const shopify = useAppBridge();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (id: string) => {
    setBusy(id);
    try {
      const q = new URLSearchParams();
      for (const k of ["preset", "from", "to"]) if (params.get(k)) q.set(k, params.get(k)!);
      await downloadFile(`/app/export/${id}.csv?${q}`, `${id}.csv`);
      shopify.toast.show("Report downloaded");
    } catch (e) {
      shopify.toast.show(e instanceof Error ? e.message : "Export failed", { isError: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <s-page heading="Reports">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <DateRangePicker range={range} today={today} earliest={earliest} />
          <s-text color="subdued">Exports use this date range ({rangeLabel(range)}).</s-text>
        </s-stack>
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Report</s-table-header>
              <s-table-header>What’s inside</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {reports.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-text type="strong">{r.title}</s-text>
                  </s-table-cell>
                  <s-table-cell>{r.description}</s-table-cell>
                  <s-table-cell>
                    <Button icon="export" loading={busy === r.id} onClick={() => download(r.id)}>
                      CSV
                    </Button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
        <s-text color="subdued">CSV files open in Excel, Google Sheets and Numbers. Arabic product names are kept.</s-text>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
