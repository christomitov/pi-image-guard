# Pi Image Guard

Automatically keep only the **newest 10 images** in each outgoing Pi model request. Older image blocks become text placeholders. **All models are protected by default; no flags or model-level setup required.**

Built to stop long screenshot sessions from hitting vLLM's `At most 20 image(s) may be provided in one prompt` error. That server limit counts historical images too, not just your latest attachment.

## Install once

```bash
pi install git:github.com/christomitov/pi-image-guard@v1.0.0
```

Then type `/reload` in an already-running Pi session, or restart Pi. Run `/image-guard` to verify it loaded. The footer shows `Images ≤10` when active.

That's it. On subsequent Pi launches it loads automatically. You do not need to run a cleanup command, change your model recipe, or restart the inference server. Install it on the machine/user **running Pi**, which may differ from the inference server.

Requires Node 22.6+ and a current Pi supporting the `context` extension hook. Tested locally with Pi 0.85.1 / Node 22.23.2. This is a Pi package, not an npm-published package.

## What happens automatically?

Before each normal agent model call (including calls following tool results), the extension:

1. Counts image blocks across user attachments, tool results and custom messages.
2. Keeps the newest 10 **images**, not just the newest message. Several screenshot tools share one budget.
3. Replaces older blocks with a short omission notice, leaving text, message order and tool-call links alone.
4. Returns only the filtered outgoing context. Original images remain in your saved session and transcript.

It also handles an existing overloaded conversation after `/reload`, and a single new message containing more images than the budget. Reading/attaching an old image again makes that new copy eligible as a recent image.

The model can still read its earlier textual descriptions, but cannot inspect omitted pixels without rereading or reattaching them. This is eviction, not automatic image summarization. Removing images can reduce prefix-cache reuse. Disk usage of saved sessions does not shrink.

## Defaults and permanent settings

**No configuration file means `keep: 10`, `batch: 1`, all models.** This is permanent default behavior after installation, not something to enable on every launch.

To customize permanently, create `~/.pi/agent/image-guard.json`:

```json
{
  "keep": 10,
  "batch": 10,
  "models": []
}
```

`models: []` (or omitting `models`) means **all models**. To restrict it to one model:

```json
{
  "keep": 10,
  "models": ["vllm/GLM-5.3-Flash-EXL3"]
}
```

Each entry is an **exact, case-sensitive `provider/model-id`**. Provider names are your Pi provider IDs, not necessarily the server software's name. The example applies only if your model is actually registered under that pair. Use `/image-guard` to see the current pair. Multiple entries are supported. There are no glob patterns or substring matching.

### Batching evictions (`batch`)

`batch` controls how images are evicted when the budget is exceeded. It is an integer from 1 to 1000, default **1**.

- **`batch: 1` (default):** the legacy behavior. Every time the count goes over `keep`, the oldest image is replaced, and the eviction advances one image per turn.
- **`batch: N > 1`:** the oldest `N` images are evicted in a single batch the moment the count goes over `keep`, and nothing else changes until enough new images arrive to trigger another batch. The number of visible images stays **at or below `keep`** at all times, oscillating between `keep + 1 - batch` and `keep`.

The point of batching is prefix-cache behavior: each eviction rewrites the outgoing context once. With `batch: N`, that rewrite happens roughly once per `N` new images instead of every turn.

**Example:** with `keep: 20, batch: 10`:

- image 21 arrives → the oldest 10 images are evicted at once → 11 images visible
- images 22–30 arrive → nothing evicted, context only grows at the end → prefix cache holds
- image 31 arrives → the next 10 oldest images are evicted at once → 11 images visible

The `/image-guard` command shows the active batch size, and the status line in the footer reads `Images ≤20, batches of 10`.

Save and run `/reload`. Model switches are checked live on each request. Models outside an explicit allowlist are not protected. `PI_CODING_AGENT_DIR` is respected if you use a different agent config directory. Project-local config files are deliberately ignored so a repository cannot override your protection or inject placeholder text.

`keep` and `batch` must be integers from 1 to 1000. Invalid settings generate a warning and fall back to the defaults (10 / 1) for the invalid field. The server limit is **not auto-discovered**: use a budget no larger than your server allows. The default 10 is below the original server's 20-image cap, but a server limited to 4 needs `keep: 4` or less.

## Optional one-launch CLI flags

**Flags are temporary: they affect only that Pi process. They do not save settings.** Use the JSON file above for permanent customization.

```bash
# This launch: newest 8 images on all models (unless persistent config restricts scope)
pi --image-guard-keep 8

# This launch: keep newest 20 images, evict the oldest 10 at once (about one
# context rewrite every 10 new images instead of every turn)
pi --image-guard-keep 20 --image-guard-batch 10

# This launch: only the exact listed model
pi --image-guard-models 'vllm/GLM-5.3-Flash-EXL3'

# Multiple exact models
pi --image-guard-models 'vllm/GLM-5.3-Flash-EXL3,other/provider-model'

# Explicitly override a saved model restriction: protect all models
pi --image-guard-models '*'
```

Precedence is **CLI flags → global config → defaults**. If you don't pass any flags and don't create a config file, protection still runs automatically for all models with a budget of 10.

## Scope and limitations

- Filters Pi's internal `type: "image"` content blocks through its `context` hook, before provider serialization. It does not parse image URLs embedded in plain text, video frames, or arbitrary nested custom payloads.
- Protects normal Pi agent requests. Extensions/subagents making independent API calls must load this guard separately. Another extension injecting images *after* this hook can exceed the budget.
- Prevents this image-count error when the configured budget fits the server cap and the guard is loaded/in scope. It cannot prevent unrelated 400s, token limits, oversized images, or server outages.
- No network requests, shell commands, credential reads or file writes from the extension. No images/conversations are sent to GitHub. It reads only its optional global configuration.
- Counts in `/image-guard` describe the **last guarded request**, not unique lifetime evictions. Originals are filtered again on each call.

## Uninstall

```bash
pi remove git:github.com/christomitov/pi-image-guard@v1.0.0
```

Then `/reload`. Your original session images remain available throughout.

## Development

No third-party runtime dependencies or build step. Tests run offline without a model/server:

```bash
npm test
```

Tests cover immutability, mixed message roles, single-message overflow, fresh tool batches, randomized newest-image retention, malformed config, persistent/CLI precedence, exact live model matching, project-config isolation and hook execution.

MIT licensed. Original implementation; no third-party pruner code is bundled.
