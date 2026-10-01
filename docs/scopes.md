# Access scopes, and why each one is needed

| Scope | Why |
|---|---|
| `read_orders` | Every order's sales, discounts, refunds, payment method, fulfilment status and attribution (UTMs, landing page) to calculate its profit. |
| `read_all_orders` | **Requested, not yet granted.** Full order history instead of the last 60 days. Added to `shopify.app.toml` only after Shopify approves it. |
| `read_products` | Product titles, tags, vendors, types and collections, so costs can be assigned to products, and to show profit per product. |
| `read_inventory` | Each variant's "Cost per item" (`inventoryItem.unitCost`), the product cost (COGS) of every sale. |
| `read_customers` | Only the customer **id** on each order, stored as a one-way hash, to tell new from returning customers and to calculate CAC and LTV. No names, emails or phones are read. |

## Protected customer data
- **Level 1:** order data (needed for everything above).
- **Level 2 fields — Address:** country, province, city and zip of the shipping address, to detect shipping zones and give each order its real shipping cost. Only these zone fields are stored; street lines are never read.
- **Level 2 fields — Name and Email:** shown to the store owner next to orders so they can recognise them. Read live from Shopify when a page is displayed (`app/lib/customerNames.server.ts`) and **never stored**.
- **Phone:** not requested.

Reasons ticked on the form: **Store management** and **Analytics** (not Marketing: the app never markets to customers).

### Text for the Dev Dashboard request (copy and paste)
> Ultimate Profit Tracker calculates the real profit of every order for the merchant. It reads orders (sales, refunds,
> payment method, fulfilment status) and product costs. From the shipping address it uses only the country, province,
> city and zip, to group orders into shipping zones so the merchant can enter what their courier really charges per zone.
> Customer ids are stored only as a one-way hash, to separate new from returning customers for CAC and lifetime value.
> No names, emails, phone numbers or street addresses are read or stored. Data is deleted on shop/redact and anonymised on
> customers/redact.

### Text for the read_all_orders request
> Merchants use the app to see profit, customer lifetime value and cohorts over their store's whole history, not just the
> last 60 days. Older orders are read once with a bulk query, stored only with the fields needed for profit calculation,
> and deleted when the merchant uninstalls (shop/redact).
