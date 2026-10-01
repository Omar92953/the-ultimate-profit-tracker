import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { loadRange } from "../lib/range.server";
import { buildReport, REPORTS, type ReportId } from "../lib/reports.server";

/** GET /app/export/:report?preset=…|from=…&to=… → CSV download (called with App Bridge's authenticated fetch). */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = String(params.report ?? "").replace(/\.csv$/, "") as ReportId;
  if (!REPORTS.some((r) => r.id === id)) throw new Response("Unknown report", { status: 404 });
  const ctx = await loadRange(request, session.shop);
  const { filename, csv } = await buildReport(session.shop, id, ctx.range.from, ctx.range.to, ctx.today);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
