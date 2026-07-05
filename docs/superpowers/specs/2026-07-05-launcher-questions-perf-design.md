# porthole: session launcher, AskUserQuestion support, navigation performance

approved scope (2026-07-05): launcher + scoped dir picker + minimal pane actions
(enter/esc nudge, close window), in-app answering of AskUserQuestion prompts,
and faster session switching. explicitly OUT: arbitrary key/command sending,
general filesystem browsing, tmux rename/reorder/attach, prompt-at-launch.

## 1. session launcher

- `src/projects.ts` (new): `knownProjects(sessions)` — unique projectPaths from
  discovered sessions, recency-ordered. `listDirs(rel)` — one level of subdirs
  under `config.rootDir` (env `PORTHOLE_ROOT`, default `~/dev`), resolve+prefix
  checked, hidden dirs and node_modules skipped.
- `src/tmux.ts` gains `launchClaude(cwd)` (`new-window -c <cwd> claude`,
  fallback `new-session -d` when no server), `sendKey(target, key)` with key a
  strict enum (Enter, Escape, Down, Up, Space, Tab — the minimum the features
  need, never arbitrary strings), `killWindow(target)`.
- routes: `GET /api/projects`, `GET /api/dirs?path=`, `POST /api/launch {dir}`
  → `{ok, target}`, `POST /api/nudge {target, key: enter|escape}` (target must
  be a live pane with a claude process — works before the session file exists,
  which is how the folder-trust prompt gets cleared from the phone),
  `POST /api/sessions/:id/close` (active only, kill-window). all writes behind
  the existing cross-site guard; launch dir must be inside rootDir or exactly
  match a known project path.
- frontend: ＋ FAB on the list → bottom sheet: recent projects (tap → confirm →
  launch), breadcrumb dir browser below. after launch, watch for the session to
  appear; if nothing within ~10s show the trust-prompt hint with a Press Enter
  button (nudge by target). session view header gets an overflow menu: nudge
  enter, nudge esc, close window (confirm).

## 2. AskUserQuestion answering

- a pending question = an `AskUserQuestion` tool_use event with no matching
  tool_result yet, in an active session.
- transcript renders it as a question card: header chips, question text, option
  buttons (label + description), multiSelect handled.
- answering injects keys into the pane. the exact key sequence (number jump vs
  arrows+enter, multi-select space toggling, Other text entry) MUST be derived
  empirically against a live claude in a disposable tmux session before
  implementation — do not trust assumptions about the TUI.
- `POST /api/sessions/:id/answer {optionIndexes: number[], questionIndex}` (or
  the shape the empirical work dictates) → tmux.sendKey sequences. free-text
  "Other" support only if the empirical probe shows it is reliably injectable;
  otherwise the card links the user to the draft pad fallback.
- when the tool_result lands in the jsonl, the card collapses into a normal
  answered block via the existing SSE flow.

## 3. navigation performance

back-and-forth between list and session is laggy. three causes, three fixes:

- backend: stream init re-reads and re-parses the whole jsonl (multi-MB for
  busy sessions) on every open. add a parsed-transcript LRU cache (~8 files):
  `{size, mtimeMs, events, offset}` per path; unchanged file → instant init;
  grown file → parse appended bytes only (reuse tail logic). also memoize
  `loadSessions()` for ~1s to coalesce the per-stream status ticks and list
  polls.
- frontend list: module-scope session cache in `useSessions` (stale-while-
  revalidate) so returning to the list renders instantly from cache; entrance
  stagger runs only on first mount, not on every back-navigation.
- frontend transcript: window the initial render to the most recent ~75 events
  with a "show earlier" button; keeps first paint cheap on 500+ event sessions.

## invariants (unchanged)

argv-only tmux via src/tmux.ts exclusively; keys are enums, never user
strings; tailscale is the perimeter, cross-site guard on all writes; no
general fs access — rootDir is the boundary.

## verification

live e2e before done: launch into a scratch dir via the api, clear the trust
prompt with nudge, session appears active, answer a real AskUserQuestion from
the api (spawn one in a disposable session), close window, list reconciles.
perf: measure list→session→list round trip before/after on a 500-event session.
