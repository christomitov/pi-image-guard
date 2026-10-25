import { readFileSync } from "node:fs";
import {
  DEFAULT_BATCH,
  DEFAULT_KEEP,
  MAX_BATCH,
  MAX_KEEP,
  isRecord,
  validBatch,
  validKeep,
} from "./prune.ts";

export interface GuardConfig {
  keep: number;
  /** Evict in batches of this many images when over budget (1 = per-image). */
  batch: number;
  /** Empty means every model. Otherwise exact provider/model-id matches. */
  models: string[];
}
export interface FlagValues {
  keep?: unknown;
  batch?: unknown;
  models?: unknown;
}

function modelList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === "string" && /^[^/\s,*]+\/[^\s,*]+$/.test(item));
}

/** Only operator-controlled global configuration. Never read project files. */
export function loadConfig(path: string, flags: FlagValues = {}) {
  const warnings: string[] = [];
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) throw new Error("expected a JSON object");
    raw = parsed;
  } catch (error) {
    if (!(isRecord(error) && error.code === "ENOENT")) {
      warnings.push(`Cannot read image-guard config at ${path}; using defaults (CLI flags still apply).`);
    }
  }
  for (const key of Object.keys(raw)) {
    if (key !== "keep" && key !== "batch" && key !== "models") warnings.push(`Unknown image-guard setting: ${key}.`);
  }

  let keep: unknown = raw.keep ?? DEFAULT_KEEP;
  if (flags.keep !== undefined) {
    keep = typeof flags.keep === "string" && /^\d+$/.test(flags.keep)
      ? Number(flags.keep) : flags.keep;
  }
  if (!validKeep(keep)) {
    warnings.push(`image-guard keep must be an integer from 1 to ${MAX_KEEP}; using ${DEFAULT_KEEP}.`);
    keep = DEFAULT_KEEP;
  }

  let batch: unknown = raw.batch ?? DEFAULT_BATCH;
  if (flags.batch !== undefined) {
    batch =
      typeof flags.batch === "string" && /^\d+$/.test(flags.batch)
        ? Number(flags.batch) : flags.batch;
  }
  if (!validBatch(batch)) {
    warnings.push(`image-guard batch must be an integer from 1 to ${MAX_BATCH}; using ${DEFAULT_BATCH}.`);
    batch = DEFAULT_BATCH;
  }

  let models: unknown = raw.models ?? [];
  if (flags.models !== undefined) {
    models = typeof flags.models === "string"
      ? (flags.models.trim() === "*" ? [] : flags.models.split(",").map((s) => s.trim()))
      : flags.models;
  }
  if (!modelList(models)) {
    warnings.push("image-guard models must be exact provider/model-id strings; protecting all models instead.");
    models = [];
  }
  // All fields are runtime-validated above.
  return { config: { keep, batch, models } as GuardConfig, warnings };
}

export function matchesModel(config: GuardConfig, model?: { provider: string; id: string }): boolean {
  return config.models.length === 0 || (model !== undefined && config.models.includes(`${model.provider}/${model.id}`));
}
