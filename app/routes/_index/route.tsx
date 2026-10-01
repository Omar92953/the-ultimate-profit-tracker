import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  // No shop-domain login form: App Store apps must be installed from Shopify, and merchants
  // must never be asked to type their myshopify.com address.
  useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Ultimate Profit Tracker</h1>
        <p className={styles.text}>Real profit for every Shopify order: product costs, real shipping per zone, COD and payment fees, ad spend from Meta, TikTok and Google, and any extra cost you assign.</p>
        <p className={styles.text}>Install it from the Shopify App Store, then open it from your Shopify admin.</p>
        <ul className={styles.list}>
          <li>
            <strong>Profit per order</strong>. Every order shows exactly what it cost and why.
          </li>
          <li>
            <strong>Ads that pay</strong>. Real cost per purchase and ROAS from your Shopify orders, not the platform&apos;s estimate.
          </li>
          <li>
            <strong>Customers and reports</strong>. CAC, LTV, cohorts and CSV exports.
          </li>
        </ul>
      </div>
    </div>
  );
}
