import { handleRequest, withCors } from "./handlers.js";
import { envContext } from "./env.js";
import { runAlerts } from "./alerts/cron.js";
import { runAutopilotPass } from "./coach-autopilot.js";
import { runBackup } from "./backup.js";
import { reclassifyUnconfirmedLegacyBatch } from "./review.js";
import { isLiveSocket, liveNotifyAfter, notifyCron } from "./live.js";

export { DeviceLive, UserLive } from "./live.js";

export default {
  async fetch(request, env, executionCtx) {
    const ctx = await envContext(env);
    const response = await handleRequest(request, ctx);
    // A WebSocket upgrade must go back untouched (a copied Response drops the socket).
    if (isLiveSocket(response)) return response;
    // Tell the live cache what changed. Never blocks or fails the request.
    const notify = liveNotifyAfter(ctx, request, response);
    if (notify) executionCtx?.waitUntil?.(notify);
    return withCors(response, ctx, request);
  },

  /** Cron Trigger: evaluate grow alerts. Overlapping or repeated runs are safe (see alerts/cron.js). */
  async scheduled(event, env, executionCtx) {
    const ctx = await envContext(env);
    const work = (async () => {
      let summary = {};
      try {
        summary = await runAlerts(ctx, { now: Number(event?.scheduledTime) || Date.now() });
      } catch (err) {
        console.log(JSON.stringify({ level: "error", event: "alerts_cron_failed", message: String(err?.message || err).slice(0, 200) }));
      }
      try {
        const reclass = await reclassifyUnconfirmedLegacyBatch(ctx.db);
        console.log(JSON.stringify({ level: "info", event: "alerts_cron", ...summary, reclass }));
      } catch (err) {
        console.log(JSON.stringify({ level: "error", event: "legacy_reclass_failed", message: String(err?.message || err).slice(0, 200) }));
      }
      try {
        const auto = await runAutopilotPass(ctx, { now: Number(event?.scheduledTime) || Date.now() });
        if (auto.skipped !== "kill_switch") {
          console.log(JSON.stringify({ level: "info", event: "coach_autopilot", ran: auto.ran }));
        }
      } catch (err) {
        console.log(JSON.stringify({ level: "error", event: "coach_autopilot_failed", message: String(err?.message || err).slice(0, 200) }));
      }
      try {
        const backup = await runBackup(ctx.db, env.BACKUPS, { now: Number(event?.scheduledTime) || Date.now() });
        if (!backup.skipped) console.log(JSON.stringify({ level: "info", event: "d1_backup", ...backup }));
      } catch (err) {
        console.error(JSON.stringify({ level: "error", event: "d1_backup_failed", message: String(err?.message || err).slice(0, 200) }));
      }
      try {
        // Alerts and Autopilot may have changed device state; refresh the live cache.
        await notifyCron(ctx);
      } catch (err) {
        console.log(JSON.stringify({ level: "error", event: "live_cron_failed", message: String(err?.message || err).slice(0, 200) }));
      }
    })();
    executionCtx.waitUntil(work);
    await work;
  },
};
