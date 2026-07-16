// input adapter — the ONLY module allowed to spawn tmux
// safety-critical invariant: argv arrays only, never shell strings from user text
import type { Provider } from '../shared/types'

const PANE_FORMAT =
  '#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}|#{pane_current_path}|#{pane_current_command}'
const TARGET_RE = /^[\w.-]+:\d+\.\d+$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// delay so the tui registers injected text before Enter submits — codex's
// composer debounces input and swallows an instant Enter; claude needs it
// for pastes only, but the delay is harmless there
const TEXT_ENTER_DELAY_MS = 200
// tuis debounce input, so space out multi-key sequences
const INTER_KEY_DELAY_MS = 80
// -P -F prints the new pane target in this format
const NEW_TARGET_FORMAT = '#{session_name}:#{window_index}.#{pane_index}'
// fallback session name when no tmux server is running yet
const FALLBACK_SESSION = 'main'

// the only keys the ui is allowed to inject — never arbitrary strings.
// digits 1-9 answer AskUserQuestion pickers (option jump / toggle); Right moves
// a multiSelect picker to its Submit tab.
export type TmuxKey =
  | 'Enter'
  | 'Escape'
  | 'Down'
  | 'Up'
  | 'Space'
  | 'Tab'
  | 'Right'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'

let bufferCounter = 0

export interface Pane {
  pid: number
  target: string // session:window.pane
  cwd: string
  command: string
}

// run tmux with an argv array; optional stdin text. returns exit code + stderr
async function runTmux(
  args: string[],
  stdin?: string,
): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(['tmux', ...args], {
    stdin: stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin)
    await proc.stdin.end()
  }
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ])
  return { code, stderr }
}

async function tmuxOrThrow(args: string[], stdin?: string): Promise<void> {
  const { code, stderr } = await runTmux(args, stdin)
  if (code !== 0) throw new Error(`tmux ${args[0]} failed: ${stderr.trim()}`)
}

// like runTmux but captures stdout (for -P target printing)
async function runTmuxCapture(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr }
}

export async function listPanes(): Promise<Pane[]> {
  const proc = Bun.spawn(
    ['tmux', 'list-panes', '-a', '-F', PANE_FORMAT],
    { stdout: 'pipe', stderr: 'ignore' },
  )
  const [code, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ])
  // tmux not running / no server → nonzero exit, treat as no panes
  if (code !== 0) return []
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [pid, target, cwd, command] = line.split('|')
      return { pid: Number(pid), target, cwd, command }
    })
}

// multiline-safe injection via bracketed paste, then Enter
export async function sendToPane(target: string, text: string): Promise<void> {
  if (!TARGET_RE.test(target)) throw new Error(`invalid tmux target: ${target}`)

  if (text.includes('\n')) {
    // bracketed paste keeps newlines literal so the tui doesn't submit early
    const buf = `porthole-${bufferCounter++}`
    await tmuxOrThrow(['load-buffer', '-b', buf, '-'], text)
    await tmuxOrThrow(['paste-buffer', '-b', buf, '-p', '-d', '-t', target])
    await Bun.sleep(TEXT_ENTER_DELAY_MS)
    await sendKey(target, 'Enter')
    return
  }

  // single line: -l sends literally, -- stops flag parsing of text
  await tmuxOrThrow(['send-keys', '-t', target, '-l', '--', text])
  await Bun.sleep(TEXT_ENTER_DELAY_MS)
  await sendKey(target, 'Enter')
}

// send a single named key to a pane (enum-only, never user text)
export async function sendKey(target: string, key: TmuxKey): Promise<void> {
  if (!TARGET_RE.test(target)) throw new Error(`invalid tmux target: ${target}`)
  await tmuxOrThrow(['send-keys', '-t', target, key])
}

// send a key sequence, spaced out so debouncing tuis register each one
export async function sendKeys(target: string, keys: TmuxKey[]): Promise<void> {
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) await Bun.sleep(INTER_KEY_DELAY_MS)
    await sendKey(target, keys[i])
  }
}

// read the visible contents of a pane (read-only). used to detect a live
// AskUserQuestion picker, which claude buffers out of the jsonl until answered.
export async function capturePane(target: string): Promise<string> {
  if (!TARGET_RE.test(target)) throw new Error(`invalid tmux target: ${target}`)
  const { code, stdout } = await runTmuxCapture(['capture-pane', '-t', target, '-p'])
  return code === 0 ? stdout : ''
}

// open a new tmux window running claude in cwd; returns its pane target.
// falls back to a fresh detached session when no tmux server is running.
export async function launchClaude(cwd: string): Promise<string> {
  const newWindow = await runTmuxCapture([
    'new-window',
    '-c',
    cwd,
    '-P',
    '-F',
    NEW_TARGET_FORMAT,
    'claude',
  ])
  if (newWindow.code === 0) return newWindow.stdout.trim()

  const newSession = await runTmuxCapture([
    'new-session',
    '-d',
    '-s',
    FALLBACK_SESSION,
    '-c',
    cwd,
    '-P',
    '-F',
    NEW_TARGET_FORMAT,
    'claude',
  ])
  if (newSession.code !== 0) {
    throw new Error(`tmux launch failed: ${(newWindow.stderr || newSession.stderr).trim()}`)
  }
  return newSession.stdout.trim()
}

// close the window owning a pane target
export async function killWindow(target: string): Promise<void> {
  if (!TARGET_RE.test(target)) throw new Error(`invalid tmux target: ${target}`)
  await tmuxOrThrow(['kill-window', '-t', target])
}

// per-agent resume argv — id is UUID-validated below, never raw user text
const RESUME_ARGV: Record<Provider, (id: string) => string[]> = {
  claude: (id) => ['claude', '--resume', id],
  codex: (id) => ['codex', 'resume', id],
}

// open a new tmux window resuming a session
export async function resumeSession(
  cwd: string,
  sessionId: string,
  provider: Provider,
): Promise<void> {
  if (!UUID_RE.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
  await tmuxOrThrow(['new-window', '-c', cwd, ...RESUME_ARGV[provider](sessionId)])
}
