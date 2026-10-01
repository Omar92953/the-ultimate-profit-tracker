/* eslint-disable @typescript-eslint/no-explicit-any -- App Bridge resource picker payloads are untyped */
import { useAppBridge } from "@shopify/app-bridge-react";
import type { Ref } from "../lib/types";
import { Button } from "./fields";

/**
 * Shows picked products/collections and opens Shopify's resource picker to change them.
 */
export function ResourceList(props: {
  type: "product" | "collection";
  label: string;
  value: Ref[];
  onChange: (value: Ref[]) => void;
  multiple?: boolean;
  details?: string;
  error?: string;
}) {
  const shopify = useAppBridge();
  const multiple = props.multiple ?? true;

  async function pick() {
    const selected: any = await shopify.resourcePicker({
      type: props.type,
      multiple,
      action: "select",
      filter: { variants: false, draft: false, archived: false },
      selectionIds: props.value.map((v) => ({ id: v.id })),
    } as any);
    if (!selected) return;
    props.onChange(
      Array.from(selected as any[]).map((r: any) => ({
        id: r.id,
        title: r.title,
        image: r.images?.[0]?.originalSrc ?? r.image?.originalSrc ?? null,
      })),
    );
  }

  const noun = props.type === "product" ? (multiple ? "products" : "product") : multiple ? "collections" : "collection";

  return (
    <s-stack gap="small-200">
      <s-text type="strong">{props.label}</s-text>
      {props.details ? <s-text color="subdued">{props.details}</s-text> : null}
      {props.value.length ? (
        <s-stack gap="small-200">
          {props.value.map((r) => (
            <s-box key={r.id} padding="small-200" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-thumbnail src={r.image ?? undefined} alt={r.title} size="small-200" />
                  <s-text>{r.title}</s-text>
                </s-stack>
                <Button
                  variant="tertiary"
                  icon="x"
                  accessibilityLabel={`Remove ${r.title}`}
                  onClick={() => props.onChange(props.value.filter((v) => v.id !== r.id))}
                >
                  Remove
                </Button>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      ) : (
        <s-text color="subdued">No {noun} chosen yet.</s-text>
      )}
      {props.error ? <s-text tone="critical">{props.error}</s-text> : null}
      <s-stack direction="inline">
        <Button onClick={pick} icon={props.type === "product" ? "product" : "collection"}>
          {props.value.length ? `Change ${noun}` : `Choose ${noun}`}
        </Button>
      </s-stack>
    </s-stack>
  );
}
