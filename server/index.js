// Entry point: `npm start`. Serves the web app, the REST API (/api), real-time events (/ws) and media (/media).
import { createApp } from "./app.js";

// SEED_DEMO=false starts with an empty store instead of the demo catalog and accounts
const app = await createApp({ seed: process.env.SEED_DEMO !== "false" });
const addr = await app.listen();
const { cfg } = app.S;
console.log(`[tunibeat] ${cfg.env} server on http://${addr.address}:${addr.port}`);
console.log(`[tunibeat] payments: ${app.S.payments.name}${app.S.payments.testMode ? " (TEST MODE — no real money)" : ""} · payouts: ${app.S.payouts.name} · live: ${cfg.live.transport} · transcoder: ${app.S.transcoder.name}`);
if (cfg.devTools) console.log("[tunibeat] dev tools on: demo sign-in, sandbox checkout, dev outbox");

const stop = async () => { await app.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
