/* eslint-disable @typescript-eslint/no-explicit-any -- Polaris custom elements are driven through untyped element properties */
/**
 * React 18 wrappers for Polaris web components.
 *
 * React 18 sets custom-element props as attributes: `checked={false}` becomes the attribute
 * "false" (which reads as true), and `onChange` never fires on custom elements. These wrappers
 * set values as element properties and listen to the native `input`/`change` events instead.
 */
import { useEffect, useLayoutEffect as useClientLayoutEffect, useRef, type ReactNode } from "react";

// Layout effects only run in the browser; on the server use a no-op-equivalent to avoid SSR warnings.
const useLayoutEffect = typeof window === "undefined" ? useEffect : useClientLayoutEffect;

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useFieldEvents(ref: React.RefObject<any>, handler: (el: any) => void, events = ["input", "change"]) {
  const latest = useLatest(handler);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = () => latest.current(el);
    events.forEach((e) => el.addEventListener(e, listener));
    return () => events.forEach((e) => el.removeEventListener(e, listener));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Sets a property on a Polaris element. On a fresh page load the element may not be upgraded yet;
 * its class fields overwrite anything set before that, so the value is re-applied once the element
 * is defined and has rendered. Booleans are mirrored as attributes too (attributes survive upgrades).
 */
function applyProp(el: any, name: string, value: unknown) {
  if (typeof value === "boolean" && !name.startsWith("default")) el.toggleAttribute(name, value);
  if (el[name] !== value) el[name] = value;
}

export function useProp(ref: React.RefObject<any>, name: string, value: unknown) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    applyProp(el, name, value);
    let cancelled = false;
    const reapply = () => {
      if (!cancelled) applyProp(el, name, value);
    };
    // After upgrade and after the component's first render (which can reset it from its default).
    customElements.whenDefined(el.localName).then(() => requestAnimationFrame(reapply));
    return () => {
      cancelled = true;
    };
  }, [ref, name, value]);
}

type Common = { label: string; details?: string; error?: string; disabled?: boolean };

export function TextField(props: Common & { value: string; onValue: (v: string) => void; placeholder?: string; maxLength?: number }) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultValue", props.value);
  useProp(ref, "value", props.value);
  useProp(ref, "disabled", !!props.disabled);
  useFieldEvents(ref, (el) => props.onValue(el.value));
  return (
    <s-text-field
      ref={ref}
      label={props.label}
      details={props.details}
      error={props.error}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
    />
  );
}

export function TextArea(props: Common & { value: string; onValue: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultValue", props.value);
  useProp(ref, "value", props.value);
  useFieldEvents(ref, (el) => props.onValue(el.value));
  return <s-text-area ref={ref} label={props.label} details={props.details} error={props.error} rows={props.rows} placeholder={props.placeholder} />;
}

/** Date-only value as YYYY-MM-DD ("" for none). */
export function DateField(props: Common & { value: string; onValue: (v: string) => void }) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultValue", props.value);
  useProp(ref, "value", props.value);
  useFieldEvents(ref, (el) => props.onValue(el.value ?? ""), ["change"]);
  return <s-date-field ref={ref} label={props.label} details={props.details} error={props.error} />;
}

export function NumberField(
  props: Common & { value: number; onValue: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string },
) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultValue", String(props.value));
  useProp(ref, "value", String(props.value));
  useProp(ref, "disabled", !!props.disabled);
  useFieldEvents(ref, (el) => {
    const n = Number(el.value);
    props.onValue(Number.isFinite(n) ? n : 0);
  });
  return (
    <s-number-field
      ref={ref}
      label={props.label}
      details={props.details}
      error={props.error}
      min={props.min}
      max={props.max}
      step={props.step}
      suffix={props.suffix}
    />
  );
}

export function Select(
  props: Common & { value: string; onValue: (v: string) => void; options: { value: string; label: string }[]; labelAccessibilityVisibility?: "visible" | "exclusive" },
) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultValue", props.value);
  useProp(ref, "value", props.value);
  useProp(ref, "disabled", !!props.disabled);
  useFieldEvents(ref, (el) => props.onValue(el.value), ["change"]);
  return (
    <s-select ref={ref} label={props.label} details={props.details} error={props.error} labelAccessibilityVisibility={props.labelAccessibilityVisibility}>
      {props.options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

export function Checkbox(props: Common & { checked: boolean; onValue: (v: boolean) => void }) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultChecked", props.checked);
  useProp(ref, "checked", props.checked);
  useProp(ref, "disabled", !!props.disabled);
  useFieldEvents(ref, (el) => props.onValue(!!el.checked), ["change"]);
  // The attribute makes the server-rendered HTML start in the right state before the component loads.
  return (
    <s-checkbox
      ref={ref}
      label={props.label}
      details={props.details}
      error={props.error}
      {...(props.checked ? { checked: true } : {})}
    />
  );
}

export function Switch(props: Common & { checked: boolean; onValue: (v: boolean) => void }) {
  const ref = useRef<any>(null);
  useProp(ref, "defaultChecked", props.checked);
  useProp(ref, "checked", props.checked);
  useProp(ref, "disabled", !!props.disabled);
  useFieldEvents(ref, (el) => props.onValue(!!el.checked), ["change"]);
  // The attribute makes the server-rendered HTML start in the right state before the component loads.
  return (
    <s-switch
      ref={ref}
      label={props.label}
      details={props.details}
      error={props.error}
      {...(props.checked ? { checked: true } : {})}
    />
  );
}

/** s-button with boolean props that are safe under React 18. */
export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "tertiary" | "auto";
  tone?: "critical" | "auto" | "neutral";
  loading?: boolean;
  disabled?: boolean;
  href?: string;
  target?: "_blank" | "_top" | "_self" | "auto";
  icon?: string;
  slot?: string;
  accessibilityLabel?: string;
  commandFor?: string;
  command?: "--auto" | "--show" | "--hide" | "--toggle";
}) {
  const ref = useRef<any>(null);
  useProp(ref, "loading", !!props.loading);
  useProp(ref, "disabled", !!props.disabled);
  return (
    <s-button
      ref={ref}
      onClick={props.onClick}
      variant={props.variant}
      tone={props.tone}
      href={props.href}
      target={props.target}
      icon={props.icon as any}
      slot={props.slot as any}
      accessibilityLabel={props.accessibilityLabel}
      commandFor={props.commandFor}
      command={props.command}
    >
      {props.children}
    </s-button>
  );
}
