/**
 * Validates every Admin GraphQL document in app/lib/shopify/queries.ts against the real
 * Admin API schema (2025-10). Run: npm run validate:graphql
 */
import { readFileSync } from "node:fs";
import { buildClientSchema, parse, validate, type IntrospectionQuery } from "graphql";
import * as docs from "../app/lib/shopify/queries";

const raw = JSON.parse(readFileSync(new URL("./admin-2025-10.schema.json", import.meta.url), "utf8"));
const schema = buildClientSchema((raw.data ?? raw) as IntrospectionQuery);

let failed = 0;
for (const [name, value] of Object.entries(docs)) {
  if (typeof value !== "string" || !value.includes("#graphql")) continue;
  const errors = validate(schema, parse(value.replace("#graphql", "")));
  if (errors.length) {
    failed++;
    console.error(`✗ ${name}`);
    for (const e of errors) console.error(`   ${e.message}`);
  } else console.log(`✓ ${name}`);
}
process.exit(failed ? 1 : 0);
