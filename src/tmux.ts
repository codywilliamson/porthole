// input adapter — the ONLY module allowed to spawn tmux
// safety-critical invariant: argv arrays only, never shell strings from user text

const PANE_FORMAT =
  '#{pane_pid}|#{session_name}:#{window_index}.#{pane_index}|#{pane_current_path}|#{pane_current_command}'
const TARGET_RE = /^[\w.-]+:\d+\.\d+$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// delay so claude code's tui registers the paste before Enter submits
const PASTE_ENTER_DELAY_MS = 200

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
    await Bun.sleep(PASTE_ENTER_DELAY_MS)
    await tmuxOrThrow(['send-keys', '-t', target, 'Enter'])
    return
  }

  // single line: -l sends literally, -- stops flag parsing of text
  await tmuxOrThrow(['send-keys', '-t', target, '-l', '--', text])
  await tmuxOrThrow(['send-keys', '-t', target, 'Enter'])
}

// open a new tmux window resuming a session
export async function resumeSession(
  cwd: string,
  sessionId: string,
): Promise<void> {
  if (!UUID_RE.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
  await tmuxOrThrow(['new-window', '-c', cwd, 'claude', '--resume', sessionId])
}
