/**
 * In development the web process runs the jobs too, so `shopify app dev` is all you need.
 * Production sets INLINE_WORKER=0 and runs `npm run worker` as its own service.
 */
declare global {
  // eslint-disable-next-line no-var
  var profitInlineWorker: Promise<void> | undefined;
}

export function ensureInlineWorker(): void {
  const enabled = process.env.INLINE_WORKER ? process.env.INLINE_WORKER === "1" : process.env.NODE_ENV !== "production";
  if (!enabled || global.profitInlineWorker) return;
  global.profitInlineWorker = import("./handlers")
    .then((m) => m.startWorkers())
    .then(() => console.log("[worker] inline worker ready"))
    .catch((e) => {
      console.error("[worker] inline worker failed", e);
      global.profitInlineWorker = undefined;
    });
}
