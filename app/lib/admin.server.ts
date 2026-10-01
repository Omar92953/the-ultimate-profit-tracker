/* eslint-disable @typescript-eslint/no-explicit-any -- raw Admin API JSON; operations are schema-checked by `npm run graphql-codegen` */
/**
 * Thin wrapper around the Admin GraphQL client that throws readable errors.
 * Both top-level `errors` and mutation `userErrors` are surfaced — swallowing them only
 * produces "cannot read properties of null" crashes later.
 */
export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export class AdminError extends Error {}

export async function gql<T = any>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json: any = await response.json();
  if (json.errors?.length) {
    throw new AdminError(json.errors.map((e: any) => e.message).join("; "));
  }
  const data = json.data ?? {};
  for (const value of Object.values<any>(data)) {
    const userErrors = value?.userErrors;
    if (Array.isArray(userErrors) && userErrors.length) {
      throw new AdminError(
        userErrors
          .map((e: any) => (e.field ? `${[].concat(e.field).join(".")}: ` : "") + e.message)
          .join("; "),
      );
    }
  }
  return data as T;
}

export function numericId(gid: string): string {
  return String(gid).split("/").pop() || "";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
