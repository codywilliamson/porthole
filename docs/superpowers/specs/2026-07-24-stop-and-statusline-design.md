# stop button + statusline strip — design

date: 2026-07-24
status: approved (user delegated decisions — "work autonomously")

## goal

1. **stop/interrupt** — one-tap rescue when a message was sent by accident: send
   Escape to the session's pane from right next to the composer.
2. **statusline details** — surface model + context-window pressure per session
   (the useful, derivable core of the terminal statusline) for both claude and codex.

## decisions made autonomously

- both providers supported (user said "at least for [claude]"; codex data is free).
- stop button reuses `/api/nudge` (existing endpoint, already validates the pane
  runs an agent) — no new backend route.
- statusline data computed from jsonl at discovery time, not scraped from the pane:
  works for inactive sessions, no fragile terminal parsing, no nerd-font glyphs.
- no $ cost / branch / commits segments — not present in jsonl (YAGNI).
- no confirm on stop — must be instant; Escape is safe when idle.

## feature a — stop button

- `DraftPad.vue` gains a `tmuxTarget: string | null` prop (passed by `SessionView`).
- when active, a danger-styled stop button (square stop SVG icon) sits at the left
  of the composer action row; tap → `nudge(target, 'escape')`.
- errors surface via the existing draft error flash. existing ⋯-menu nudges stay.

## feature b — model + context stats

### data (backend)

`SessionSummary` gains:

```ts
model: string | null          // raw model id from the transcript
contextTokens: number | null  // tokens in the live context (last turn)
contextWindow: number | null  // codex exact; claude heuristic
```

- **claude** (`transcript.ts` deriveMeta): model = last assistant `message.model`;
  contextTokens = last assistant `usage.input_tokens + cache_creation_input_tokens +
  cache_read_input_tokens`. window heuristic: 200k default, ratchet to 1m when the
  max observed contextTokens exceeds 200k (jsonl never records the window; `[1m]`
  sessions are otherwise indistinguishable).
- **codex** (`codex.ts` deriveMeta): model = last `turn_context.model`;
  contextTokens = last `token_count` event's `last_token_usage.total_tokens`;
  contextWindow = its `model_context_window` (exact).
- fields flow through `DiscoveredSession` → `toSummary` automatically; discovery
  meta is already mtime+size cached, so cost is ~zero.
- SSE `status` tick payload (shared type `StatusPayload`) extends to include the
  three fields and fires when any of them change — the open session view updates
  live without new endpoints; the list updates via its existing poll.

### ui (web)

- **session view**: slim full-width readout strip under the header —
  `model · [context bar] pct% · used/window` in mono `--text-xs`. bar is a real
  css div (no unicode blocks), color-ramped: teal < 60%, amber ≥ 60%, danger ≥ 85%.
- **session list cards**: append `· NN% ctx` to the meta row when known, same
  color ramp on the text at high pressure.
- hidden entirely when fields are null (empty/legacy sessions).

## error handling

- parsing stays defensive: absent/malformed usage fields → nulls, never throw.
- stop on a stale target → nudge 404s → error flash, no crash.

## testing / verification

- `bun run typecheck`, `bun run build`.
- run backend, `curl /api/sessions` — confirm model/context fields on real
  claude + codex sessions.
- manual: stop button interrupts a running session.
