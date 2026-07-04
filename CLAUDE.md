# porthole

Mobile-first web viewer and reply relay for Claude Code sessions running in tmux, served
over Tailscale.

## module map (SRP)

- `src/transcript.ts` — session discovery + jsonl parsing. no tmux/process knowledge.
- `src/activity.ts` — tmux/process correlation, active detection, session -> tmux target
  mapping. consumes `tmux.listPanes()`, never spawns tmux itself.
- `src/tmux.ts` — the ONLY module that spawns tmux. injection + resume.
- `src/server.ts` — thin `Bun.serve` route map (session list, SSE stream, send, resume)
  + static serving of `dist/`. no domain logic.
- `src/config.ts` — the only place env is read. everything else imports `config`.
- `shared/types.ts` — single source of truth for the api contract. import it, never
  redefine the shapes on either side (backend or `web/`).
- `web/` — Vue 3 SPA, mobile-first, built by Vite into `dist/`, served by the backend.

## commands

```sh
bun install
bun run dev       # backend, --watch, port 4747
bun run dev:web   # vite dev server, proxies /api
bun run build     # vite build -> dist/
bun start         # bun src/index.ts, serves everything
bun run typecheck # vue-tsc --noEmit
```

## env vars

- `PORTHOLE_HOST` (default `0.0.0.0`)
- `PORTHOLE_PORT` (default `4747`)
- `PORTHOLE_POLL_MS` (default `2000`)
- `PORTHOLE_PROJECTS_DIR` (default `~/.claude/projects`)
- `PORTHOLE_ALLOWED_HOSTS` (default empty = any; comma-separated `host:port` allowlist)

## HARD INVARIANTS

- tmux injection is **argv-only** (`Bun.spawn` arrays) — NEVER build shell strings from
  user text.
- `src/tmux.ts` is the ONLY module allowed to spawn tmux.
- Tailscale is the security perimeter. There is no auth by design — do not add auth, do
  not expose this publicly.
- `@paper-design/shaders` is pinned **exact** (`0.0.77`) in `package.json` — it's 0.0.x
  and ships breaking changes across patches. Bump deliberately, re-verify the mount API.

## active-detection gotcha

Claude Code can show up as tmux `pane_current_command` `"node"` OR native `"claude"` —
**never match on the pane command**. Walk the pane_pid's descendant process tree
(`/proc`) looking for a claude process (comm `claude`, or argv0/argv1 basename `claude`).

The claude process does **not** reliably keep its `.jsonl` fd open, so fd-matching
(`/proc/<pid>/fd`) is best-effort only, tried first as an exact match. The reliable
signal is: claude-process cwd -> session `projectPath` -> newest `.jsonl` in that
project dir.

jsonl schema drifts across Claude Code versions — parse defensively (`transcript.ts`'s
`eventsFromObj`), unknown event types are silently ignored, never thrown on.

## repo tooling

- **commit-guard** enforces conventional commits via `.githooks/commit-msg` +
  `.github/workflows/commitlint.yml` (pinned `@v0.2.2`).
- **repo-sentinel** watches the repo via `.github/workflows/security-scan.yml`
  (pinned `@v0.2.2`).
