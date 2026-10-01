/** Background worker process (production: a Render background worker running `npm run worker`). */
import { startWorkers } from "./handlers";

startWorkers()
  .then(() => console.log("[worker] ready"))
  .catch((e) => {
    console.error("[worker] failed to start", e);
    process.exit(1);
  });
