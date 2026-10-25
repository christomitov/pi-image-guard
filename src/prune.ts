export const DEFAULT_KEEP = 10;
export const MAX_KEEP = 1000;
/** Eviction batch size, in images. 1 = current behavior: evict the excess one
 * image per turn. 2 or more = evict whole batches at once once the budget is
 * exceeded, so the outgoing context only changes every `batch` new images
 * instead of every image. */
export const DEFAULT_BATCH = 1;
export const MAX_BATCH = MAX_KEEP;
export const PLACEHOLDER = "[Older image omitted from this request by image-guard; original remains in session history. Reattach or reread it if needed.]";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validKeep(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_KEEP;
}

export function validBatch(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_BATCH;
}

export interface MessageLike {
  role: string;
  content?: unknown;
}

/** Count blocks, not messages: several fresh tool results share one budget.
 * Copy only changed messages/content arrays; never mutate the supplied history.
 */
export function pruneImages<T extends MessageLike>(
  messages: T[],
  requestedKeep = DEFAULT_KEEP,
  requestedBatch = DEFAULT_BATCH
) {
  const keep = validKeep(requestedKeep) ? requestedKeep : DEFAULT_KEEP;
  const batch = validBatch(requestedBatch) ? requestedBatch : DEFAULT_BATCH;
  let total = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && block.type === "image") total++;
    }
  }

  // Evict in whole batches of `batch` images (1 = one per turn). Shown images
  // never exceed `keep`, and the outgoing context is unchanged for `batch - 1`
  // turns between evictions, so prefix caches survive in the meantime.
  const over = total - keep;
  const removed = over > 0
    ? Math.min(total, Math.ceil(over / batch) * batch)
    : 0;
  if (removed === 0) return { messages, total, kept: total, removed };

  let remaining = removed;
  const result = messages.map((message) => {
    if (remaining === 0 || !Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((block: unknown) => {
      if (remaining > 0 && isRecord(block) && block.type === "image") {
        remaining--;
        changed = true;
        return { type: "text", text: PLACEHOLDER };
      }
      return block;
    });
    return changed ? { ...message, content } : message;
  });
  return { messages: result, total, kept: total - removed, removed };
}
