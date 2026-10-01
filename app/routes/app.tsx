import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { ChartProvider } from "../components/charts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

/** Keep the chosen dates when moving between pages. */
function useRangeQuery() {
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ["preset", "from", "to", "compare"]) if (q.get(k)) keep.set(k, q.get(k)!);
  const s = keep.toString();
  return s ? `?${s}` : "";
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const qs = useRangeQuery();
  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={`/app${qs}`}>Dashboard</s-link>
        <s-link href={`/app/orders${qs}`}>Orders</s-link>
        <s-link href={`/app/products${qs}`}>Products</s-link>
        <s-link href={`/app/customers${qs}`}>Customers</s-link>
        <s-link href={`/app/ads${qs}`}>Ads</s-link>
        <s-link href="/app/costs">Costs</s-link>
        <s-link href={`/app/reports${qs}`}>Reports</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <ChartProvider>
        <Outlet />
      </ChartProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
