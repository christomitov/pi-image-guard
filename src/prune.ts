export const DEFAULT_KEEP = 10;
export const MAX_KEEP = 1000;
export const PLACEHOLDER = "[Older image omitted from this request by image-guard; original remains in session history. Reattach or reread it if needed.]";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validKeep(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_KEEP;
}

export interface MessageLike {
  role: string;
  content?: unknown;
}

/** Count blocks, not messages: several fresh tool results share one budget.
 * Copy only changed messages/content arrays; never mutate the supplied history.
 */
export function pruneImages<T extends MessageLike>(messages: T[], requestedKeep = DEFAULT_KEEP) {
  const keep = validKeep(requestedKeep) ? requestedKeep : DEFAULT_KEEP;
  let total = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && block.type === "image") total++;
    }
  }

  const removed = Math.max(0, total - keep);
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
