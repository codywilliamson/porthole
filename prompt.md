# porthole — build prompt

Build "porthole" (or use the current directory's name): a mobile-first web viewer and
reply relay for Claude Code sessions, served over Tailscale. I run multiple Claude Code
sessions across separate tmux windows and want to review long responses on my phone,
jump between sessions, and reply into the right terminal. Backend runtime is Bun.

REPO SETUP (do this as part of the build)
- Repo name = the current directory's basename (intended: porthole). Create it PUBLIC via
  the gh CLI with this description: "Mobile-first viewer and reply relay for Claude Code
  sessions running in tmux, served over Tailscale."
- Verify `gh auth status` first. If authed: after the first commit, run
  `gh repo create <name> --public --source=. --remote=origin
  --description "<desc>" --push`. If NOT authed: skip remote creation, keep everything
  as a committed local repo, and put the exact create+push command in the README so I
  can run it later. Do not hang waiting on auth.

INTEGRATIONS (wire in from the start)
- Pull in my two repos and set them up per their own READMEs, do not guess their usage:
  codywilliamson/repo-sentinel and codywilliamson/commit-guard. Run
  `gh repo view codywilliamson/commit-guard` and `... repo-sentinel` (or clone/read the
  READMEs) and follow their documented setup.
- commit-guard is almost certainly commit-time hooks: install and activate it BEFORE the
  first commit so the initial commit passes through it. repo-sentinel is likely repo/CI
  watching: add whatever it documents (workflow/config) and commit it.

CORE BEHAVIOR
- Session discovery: Claude Code writes each session as a JSONL under
  ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl (verify with
  `find ~/.claude -name '*.jsonl'`). List ALL sessions across ALL project dirs. Per
  session derive: title (first user message, truncated), project path, last-modified,
  event count, active state. Before writing the parser, cat a real file and derive the
  actual event schema empirically. Do not assume the shape; it varies by version. Pull
  the real project cwd from a field inside the events, not by decoding the dir name.
- Active detection + tmux mapping: a session is "active" if a running claude process is
  writing it, and each active session must map to its tmux target
  (session:window.pane) so replies hit the right window. Method:
  * tmux list-panes -a -F '#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}|#{pane_current_path}|#{pane_current_command}'
  * claude code runs as node, so pane_current_command is usually "node", NOT "claude".
    Do not match on command name. Walk each pane_pid's descendant processes for claude.
  * Map that pane's cwd to its project dir, take the most-recently-modified jsonl there
    as its active session. On Linux refine via /proc/<claude_pid>/fd for the open .jsonl.
    Verify which signal is reliable on this box.
  * Rule: matching running proc = active (tag with target); no proc = inactive/resumable.
- Render: parse JSONL to typed events (assistant text, tool_use, tool_result, user).
  Assistant text as real markdown. Fold every tool_use/tool_result into a collapsed
  <details> block so bash output doesn't flood the phone.
- Live updates: watch the selected session's file, push new events over SSE. Polling
  mtime/size is an acceptable fallback. Never full-reload on update.

INTERACTION
- View any session, active or historical.
- Reply to an active session: draft pad (textarea) with Copy and Send. Send POSTs to a
  backend endpoint that injects into that session's specific tmux target.
- Resume an inactive session: a Resume action running
  `tmux new-window -c <project-path> "claude --resume <session-uuid>"`, then reconcile
  the now-active session into the list on next poll.
- tmux injection (safety-critical): never build a shell string from my text. Spawn tmux
  with an argv array (Bun.spawn). For multiline-safe injection use bracketed paste: feed
  text to `tmux load-buffer -b <buf> -` via stdin, then
  `tmux paste-buffer -b <buf> -p -t <target>`, then `tmux send-keys -t <target> Enter`.
  Single-line sends can use `tmux send-keys -t <target> -l -- <text>` + Enter.
- Drafts persist in localStorage.

ARCHITECTURE (SRP, small modules)
- transcript: discover sessions + parse JSONL to typed events.
- activity: tmux/process correlation, active detection, session -> target mapping.
- server: Bun.serve, thin route map (page, session list, session stream, send, resume).
- input adapter: tmux injection wrapper, the ONLY module that spawns tmux.
- frontend: Vue 3 SPA, mobile-first.
- config (host, port, poll interval, projects path) via env with sane defaults.

FRONTEND / LOOK (must be genuinely beautiful, not default-tailwind card soup)
- Vue 3 SPA built with Vite (run via bun), output served statically by the Bun.serve
  backend alongside the API/SSE. Backend stays pure Bun.
- Background: Paper Shaders. Check if an official Vue wrapper exists yet; if not, use the
  vanilla core `@paper-design/shaders` mounted in a Vue component via a canvas ref +
  onMounted/onBeforeUnmount (verify the current mount API, createShader vs ShaderMount,
  against the installed version). PIN the version, it's 0.0.x and ships breaking changes.
  Use a dark, low-contrast animated shader as texture, fixed behind content with a scrim
  so text stays legible. Atmosphere, not focus. Keep it GPU-cheap.
- Animation: @vueuse/motion (v-motion) plus Vue's built-in <Transition>/<TransitionGroup>
  for list and route enter/leave. Confirm @vueuse/motion is current on install.
  Purposeful motion only: list/route entrances, tool-block expand/collapse, a subtle
  pulse on active sessions, pull-to-refresh feedback. No gratuitous movement.
- Visual direction: terminal-native but refined and dark. Monospace for the transcript,
  clean sans for chrome. Generous spacing, real type scale, tactile touch targets. Make
  deliberate design choices (use a design skill if you have one); avoid a templated look.

DOCS (both concise and scannable, not exhaustive)
- README: what it is and why in two lines, short feature list, quickstart (prereqs: bun,
  tmux, tailscale, gh; env vars; install/dev/build/run commands), a one-paragraph
  architecture overview, the security model (Tailscale is the perimeter, no auth by
  design), and an "optional: ntfy Stop-hook" note. Screenshot placeholder is fine.
- CLAUDE.md: concise project memory for future sessions. Cover the module map and SRP
  boundaries, run/build/test commands, env vars, and the hard invariants: tmux injection
  is argv-only (never shell strings), the input adapter is the sole module that spawns
  tmux, Tailscale = security perimeter, pin @paper-design/shaders. Include the
  active-detection gotcha (claude shows as "node", walk the process tree) so nobody
  relearns it. Note commit-guard governs commits and repo-sentinel watches the repo.

CONSTRAINTS: Bun backend. DRY, KISS, SRP, YAGNI (except features explicitly requested).
Tailscale is the security perimeter: bind so the tailnet reaches it, no auth.

OUT OF SCOPE (YAGNI): auth, multi-user, editing/deleting past messages, driving the agent
loop beyond one-shot resume, syntax highlighting inside code blocks.

WORKING METHOD: Autonomous. Don't stop to ask (except a missing gh auth, handled above);
make reasonable calls, record assumptions in the README. Keep a todo list. Verify against
reality before the risky parts: confirm the jsonl schema against a real file, and confirm
active-detection + send against a live session in a spare tmux window before calling it
done.

MODEL DISPATCH: orchestrate the build yourself. Sonnet 5 for scaffolding, static
structure, boilerplate, docs. Opus 4.8 for the transcript parser, the SSE/watch layer,
the tmux input adapter, the active-session/tmux-target detection, and the final visual
polish pass (shader tuning, motion, legibility).
