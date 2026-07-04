// input adapter — the ONLY module allowed to spawn tmux
// safety-critical invariant: argv arrays only, never shell strings from user text

export interface Pane {
  pid: number
  target: string // session:window.pane
  cwd: string
  command: string
}

export async function listPanes(): Promise<Pane[]> {
  throw new Error('not implemented')
}

// multiline-safe injection via bracketed paste, then Enter
export async function sendToPane(target: string, text: string): Promise<void> {
  throw new Error('not implemented')
}

// open a new tmux window resuming a session
export async function resumeSession(cwd: string, sessionId: string): Promise<void> {
  throw new Error('not implemented')
}
