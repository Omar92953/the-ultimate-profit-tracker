import { useId, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { addDays, PRESETS, presetRange, rangeLabel, rangeQuery, type Compare, type Range } from "../lib/dates";
import { Button, Select, useFieldEvents, useProp } from "./fields";

/**
 * Shopify-Analytics-style date control: a button showing the range, opening a popover with
 * presets, a range calendar and "compare to". The choice lives in the URL so every page,
 * link and report export uses the same dates.
 */
export function DateRangePicker(props: { range: Range; today: string; earliest?: string | null }) {
  const id = useId().replace(/:/g, "");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<Range>(props.range);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- web component instance
  const popover = useRef<any>(null);

  const apply = (next: Range) => {
    const q = new URLSearchParams(params);
    for (const k of ["preset", "from", "to", "compare"]) q.delete(k);
    for (const [k, v] of new URLSearchParams(rangeQuery(next))) q.set(k, v);
    q.delete("page");
    popover.current?.hidePopover?.();
    navigate(`?${q.toString()}`);
  };

  return (
    <>
      <Button commandFor={`range-${id}`} icon="calendar">
        {rangeLabel(props.range)}
      </Button>
      <s-popover ref={popover} id={`range-${id}`} inlineSize="560px">
        <s-box padding="base">
          <s-stack gap="base">
            <s-grid gridTemplateColumns="170px 1fr" gap="base">
              <s-stack gap="small-300">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    variant={draft.preset === p.id ? "secondary" : "tertiary"}
                    onClick={() => setDraft({ ...presetRange(p.id, props.today, props.earliest), preset: p.id, compare: draft.compare })}
                  >
                    {p.label}
                  </Button>
                ))}
              </s-stack>
              <RangeCalendar
                value={`${draft.from}--${draft.to}`}
                max={props.today}
                onValue={(v) => {
                  const [from, to] = v.split("--");
                  if (from && to) setDraft({ ...draft, from, to, preset: null });
                }}
              />
            </s-grid>
            <s-stack direction="inline" gap="base" alignItems="end" justifyContent="space-between">
              <Select
                label="Compare to"
                value={draft.compare}
                onValue={(v) => setDraft({ ...draft, compare: v as Compare })}
                options={[
                  { value: "previous_period", label: "Previous period" },
                  { value: "previous_year", label: "Previous year" },
                  { value: "none", label: "No comparison" },
                ]}
              />
              <s-stack direction="inline" gap="small-200">
                <Button commandFor={`range-${id}`} command="--hide">
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => apply(draft)}>
                  Apply
                </Button>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-box>
      </s-popover>
    </>
  );
}

function RangeCalendar(props: { value: string; max: string; onValue: (v: string) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- web component instance
  const ref = useRef<any>(null);
  useProp(ref, "value", props.value);
  useFieldEvents(ref, (el) => props.onValue(el.value), ["change"]);
  return <s-date-picker ref={ref} type="range" defaultValue={props.value} disallow={`${addDays(props.max, 1)}--`} view={props.value.slice(0, 7)} />;
}
