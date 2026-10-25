import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, matchesModel, type GuardConfig } from "./config.ts";
import { DEFAULT_BATCH, DEFAULT_KEEP, pruneImages } from "./prune.ts";

/** Separate registration from Pi's runtime import to allow offline hook tests. */
export function registerImageGuard(pi: ExtensionAPI, configPath: string) {
  let config: GuardConfig = { keep: DEFAULT_KEEP, batch: DEFAULT_BATCH, models: [] };
  let last: { total: number; kept: number; removed: number } | undefined;

  pi.registerFlag("image-guard-keep", {
    description: "Image guard: keep newest N image blocks (default 10; this launch only)",
    type: "string",
  });
  pi.registerFlag("image-guard-batch", {
    description: "Image guard: evict N oldest images at once when over budget; 1 = one per turn (default; this launch only)",
    type: "string",
  });
  pi.registerFlag("image-guard-models", {
    description: "Image guard: comma-separated exact provider/model-id list, or '*' for all (this launch only)",
    type: "string",
  });

  function showStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const active = matchesModel(config, ctx.model);
    const detail = active && last ? ` · ${last.kept}/${last.total} sent` : "";
    const batchNote = active && config.batch > 1 ? `, batches of ${config.batch}` : "";
    ctx.ui.setStatus("image-guard", active
      ? `Images ≤${config.keep}${batchNote}${detail}`
      : "Image guard: model excluded");
  }

  pi.on("session_start", (_event, ctx) => {
    const loaded = loadConfig(configPath, {
      keep: pi.getFlag("image-guard-keep"),
      batch: pi.getFlag("image-guard-batch"),
      models: pi.getFlag("image-guard-models"),
    });
    config = loaded.config;
    last = undefined;
    for (const warning of loaded.warnings) {
      if (ctx.hasUI) ctx.ui.notify(warning, "warning");
      else console.error(`[image-guard] ${warning}`);
    }
    showStatus(ctx);
  });

  pi.on("context", (event, ctx) => {
    // Live model metadata, not stale PI_MODEL/PI_PROVIDER environment variables.
    if (!matchesModel(config, ctx.model)) return;
    const result = pruneImages(event.messages, config.keep, config.batch);
    last = { total: result.total, kept: result.kept, removed: result.removed };
    // Cosmetic UI must never stop us from returning a successfully pruned context.
    try { showStatus(ctx); } catch { /* No effect on image filtering. */ }
    return result.removed > 0 ? { messages: result.messages } : undefined;
  });

  pi.on("model_select", () => { last = undefined; });
  pi.on("before_agent_start", (_event, ctx) => { showStatus(ctx); });

  pi.registerCommand("image-guard", {
    description: "Show image guard settings and the last request's image counts",
    handler: async (_args, ctx) => {
      const active = matchesModel(config, ctx.model);
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "not selected";
      const lines = [
        `Image guard: ${active ? "active" : "model excluded"}`,
        `Keep newest: ${config.keep} images${config.batch > 1 ? `, evicted in batches of ${config.batch}` : ""}`,
        `Scope: ${config.models.length ? config.models.join(", ") : "all models (default)"}`,
        `Current model: ${model}`,
        `Permanent config: ${configPath}`,
        last ? `Last guarded request: ${last.total} images → ${last.kept} kept, ${last.removed} omitted`
          : "No guarded request since startup/reload/model switch.",
        "CLI flags override the config for this launch only. Saved history is unchanged.",
      ];
      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
      else console.error(lines.join("\n"));
    },
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("image-guard", undefined);
  });
}
