import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneImages, PLACEHOLDER, type MessageLike } from "../src/prune.ts";
import { loadConfig, matchesModel } from "../src/config.ts";
import { registerImageGuard } from "../src/extension.ts";

const image = (id: number) => ({ type: "image", data: String(id), mimeType: "image/png" });
const message = (n: number) => ({ role: "user", content: Array.from({ length: n }, (_, i) => image(i)) });
const ids = (messages: MessageLike[]) => messages.flatMap((m) => Array.isArray(m.content)
  ? m.content.filter((b) => b?.type === "image").map((b) => b.data) : []);
function freeze(value: any): any {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function withFile(fn: (path: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-image-guard-test-"));
  return Promise.resolve().then(() => fn(join(dir, "image-guard.json"))).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("default budget retains exactly the newest ten of 25 images in a single message", () => {
  const result = pruneImages([message(25)]);
  assert.deepEqual(ids(result.messages), Array.from({ length: 10 }, (_, i) => String(i + 15)));
  assert.equal(result.removed, 15);
  assert.equal(result.kept, 10);
  assert.deepEqual(result.messages[0].content[0], { type: "text", text: PLACEHOLDER });
});

test("no images, below cap, and exactly at cap preserve message identity", () => {
  for (const count of [0, 1, 9, 10]) {
    const messages = [message(count)];
    assert.equal(pruneImages(messages).messages, messages);
  }
});

test("mixed user/tool/custom content preserves order, text, tool linkage and frozen originals", () => {
  const messages = Array.from({ length: 25 }, (_, i) => ({
    role: ["user", "toolResult", "custom"][i % 3],
    content: [image(i), { type: "text", text: `note${i}` }],
    toolCallId: `call${i}`, details: { path: "test.png" }, timestamp: i,
  }));
  const snapshot = structuredClone(messages);
  freeze(messages);
  const result = pruneImages(messages);
  assert.deepEqual(messages, snapshot);
  assert.deepEqual(ids(result.messages), Array.from({ length: 10 }, (_, i) => String(i + 15)));
  result.messages.forEach((m, i) => {
    assert.equal(m.toolCallId, `call${i}`);
    assert.equal(m.timestamp, i);
    assert.equal(m.content[1], messages[i].content[1]);
    assert.equal(m.details, messages[i].details);
  });
});

test("fresh sibling tool images are not discarded merely because they are separate messages", () => {
  const messages = [0, 1, 2].map((i) => ({ role: "toolResult", content: [image(i)] }));
  assert.equal(pruneImages(messages).messages, messages);
});

test("summary messages, string content, and unknown/null blocks are safe", () => {
  const messages = [{ role: "compactionSummary", summary: "old" }, { role: "user", content: "hello" },
    { role: "custom", content: [null, undefined, 1, { type: "other" }] }, message(25)];
  assert.equal(pruneImages(messages).kept, 10);
});

test("invalid budgets fall back to ten rather than silently disabling protection", () => {
  for (const keep of [0, -1, 1.5, NaN, Infinity, 1001, "ten", null]) {
    assert.equal(pruneImages([message(25)], keep as number).kept, 10);
  }
});

test("1000 generated conversations retain the newest N blocks; pruning is idempotent", () => {
  let seed = 314159;
  const rand = (n: number) => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 1000; trial++) {
    let id = 0;
    const keep = 1 + rand(20);
    const messages = Array.from({ length: rand(40) }, () => ({ role: "user", content: Array.from({ length: rand(8) }, () => image(id++)) }));
    const result = pruneImages(messages, keep);
    assert.deepEqual(ids(result.messages), ids(messages).slice(-keep));
    assert.equal(result.kept + result.removed, id);
    assert.equal(pruneImages(result.messages, keep).messages, result.messages);
  }
});

test("missing configuration uses ten for every model", () => withFile((path) => {
  const result = loadConfig(path);
  assert.deepEqual(result, { config: { keep: 10, models: [] }, warnings: [] });
  assert.equal(matchesModel(result.config), true);
  assert.equal(matchesModel(result.config, { provider: "anything", id: "any-model" }), true);
}));

test("CLI overrides persistent config; '*' overrides an exact-model filter", () => withFile((path) => {
  writeFileSync(path, JSON.stringify({ keep: 8, models: ["vllm/GLM-5.3-Flash-EXL3"] }));
  assert.equal(loadConfig(path).config.keep, 8);
  assert.deepEqual(loadConfig(path, { keep: "5", models: "*" }).config, { keep: 5, models: [] });
  assert.deepEqual(loadConfig(path, { models: "vllm/glm, local/vendor/glm" }).config.models, ["vllm/glm", "local/vendor/glm"]);
}));

test("malformed JSON, invalid settings, and unknown keys produce warnings and safe defaults", () => withFile((path) => {
  for (const value of ["not json", "null", "[]", '{"keep":"ten","models":"GLM"}']) {
    writeFileSync(path, value);
    const result = loadConfig(path);
    assert.deepEqual(result.config, { keep: 10, models: [] });
    assert.ok(result.warnings.length > 0);
  }
  writeFileSync(path, '{"kepe":20}');
  assert.ok(loadConfig(path).warnings.some((w) => w.includes("kepe")));
  for (const value of ["", "0", "-1", "1.5", "1001", "NaN"]) {
    assert.equal(loadConfig(path, { keep: value }).config.keep, 10);
  }
}));

test("model restriction checks exact live provider/model identifiers, not substrings", () => {
  const config = { keep: 10, models: ["vllm/GLM-5.3-Flash-EXL3"] };
  assert.equal(matchesModel(config, { provider: "vllm", id: "GLM-5.3-Flash-EXL3" }), true);
  assert.equal(matchesModel(config, { provider: "other", id: "GLM-5.3-Flash-EXL3" }), false);
  assert.equal(matchesModel(config, { provider: "vllm", id: "GLM-5.3-Flash-EXL3-other" }), false);
  assert.equal(matchesModel(config), false);
});

function harness(path: string, flags: Record<string, string> = {}) {
  const hooks: Record<string, Function> = {}, commands: Record<string, any> = {}, registered: Record<string, any> = {};
  const notices: string[] = [], statuses: unknown[] = [];
  registerImageGuard({
    on: (name: string, fn: Function) => { hooks[name] = fn; },
    registerCommand: (name: string, cmd: unknown) => { commands[name] = cmd; },
    registerFlag: (name: string, options: unknown) => { registered[name] = options; },
    getFlag: (name: string) => flags[name],
  } as any, path);
  const ctx = { hasUI: true, cwd: join(path, ".."), model: { provider: "vllm", id: "glm" },
    isProjectTrusted: () => false,
    ui: { notify: (s: string) => notices.push(s), setStatus: (...s: unknown[]) => { statuses.push(s); } } };
  return { hooks, commands, registered, notices, statuses, ctx };
}

test("hooks run automatically for all models; rereads become newest; config reloads", () => withFile(async (path) => {
  const h = harness(path);
  h.hooks.session_start({}, h.ctx);
  const messages = [message(25)];
  assert.equal(ids(h.hooks.context({ messages }, h.ctx).messages).length, 10);
  h.ctx.model = { provider: "another", id: "unrelated" };
  messages.push({ role: "toolResult", content: [image(99)] });
  assert.equal(ids(h.hooks.context({ messages }, h.ctx).messages).at(-1), "99");
  assert.equal(ids(messages).length, 26);
  await h.commands["image-guard"].handler("", h.ctx);
  assert.ok(h.notices.at(-1)?.includes("26 images → 10 kept, 16 omitted"));
  writeFileSync(path, '{"keep":7}');
  h.hooks.session_start({ reason: "reload" }, h.ctx);
  assert.equal(ids(h.hooks.context({ messages }, h.ctx).messages).length, 7);
}));

test("restricted scope follows live model switches", () => withFile((path) => {
  const h = harness(path, { "image-guard-models": "vllm/glm", "image-guard-keep": "5" });
  h.hooks.session_start({}, h.ctx);
  const event = { messages: [message(25)] };
  assert.equal(ids(h.hooks.context(event, h.ctx).messages).length, 5);
  h.ctx.model = { provider: "vllm", id: "gemma" };
  h.hooks.model_select({}, h.ctx);
  assert.equal(h.hooks.context(event, h.ctx), undefined);
  h.ctx.model.id = "glm";
  assert.equal(ids(h.hooks.context(event, h.ctx).messages).length, 5);
}));

test("project configuration cannot disable or alter filtering", () => withFile((path) => {
  const h = harness(path);
  mkdirSync(join(h.ctx.cwd, ".pi"));
  for (const name of ["settings.json", "image-guard.json"]) {
    writeFileSync(join(h.ctx.cwd, ".pi", name), '{"keep":1000,"models":["other/model"],"enabled":false,"placeholder":"BAD"}');
  }
  h.hooks.session_start({}, h.ctx);
  assert.equal(ids(h.hooks.context({ messages: [message(25)] }, h.ctx).messages).length, 10);
}));

test("status rendering failure cannot prevent pruning; headless context works", () => withFile((path) => {
  const h = harness(path);
  h.hooks.session_start({}, h.ctx);
  h.ctx.ui.setStatus = () => { throw new Error("UI failure"); };
  assert.equal(ids(h.hooks.context({ messages: [message(25)] }, h.ctx).messages).length, 10);
  h.ctx.hasUI = false;
  assert.equal(ids(h.hooks.context({ messages: [message(25)] }, h.ctx).messages).length, 10);
}));
