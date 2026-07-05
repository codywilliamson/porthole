// active detection: correlate running claude processes with sessions and tmux targets
// consumes tmux.listPanes() — never spawns tmux itself
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import type { DiscoveredSession } from './transcript'
import { listPanes, type Pane } from './tmux'

const PROC = '/proc'
const UUID_JSONL_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

interface ProcInfo {
  pid: number
  ppid: number
  comm: string
}

// parse /proc/<pid>/stat: comm may contain spaces/parens, so split on the LAST ')'
function readStat(pid: number): ProcInfo | null {
  try {
    const stat = readFileSync(`${PROC}/${pid}/stat`, 'utf8')
    const open = stat.indexOf('(')
    const close = stat.lastIndexOf(')')
    if (open < 0 || close < 0) return null
    const comm = stat.slice(open + 1, close)
    // after ") " fields are: state ppid ...
    const rest = stat.slice(close + 2).split(' ')
    const ppid = Number(rest[1])
    return { pid, ppid, comm }
  } catch {
    return null // permission / vanished → skip
  }
}

function readProcTable(): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>()
  for (const name of readdirSync(PROC)) {
    if (!/^\d+$/.test(name)) continue
    const info = readStat(Number(name))
    if (info) table.set(info.pid, info)
  }
  return table
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

// cmdline is NUL-separated argv
function readArgv(pid: number): string[] {
  try {
    return readFileSync(`${PROC}/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter((s) => s.length > 0)
  } catch {
    return []
  }
}

// claude = comm 'claude', or argv0 basename 'claude', or node running claude
function isClaude(info: ProcInfo): boolean {
  if (info.comm === 'claude') return true
  const argv = readArgv(info.pid)
  if (argv.length === 0) return false
  const a0 = basename(argv[0])
  if (a0 === 'claude') return true
  if (a0 === 'node' && argv[1] && basename(argv[1]) === 'claude') return true
  return false
}

// find first claude process in the pane_pid's tree — including pane_pid itself:
// `tmux new-window 'claude ...'` makes the pane process claude directly, no shell parent
function findClaudeDescendant(
  panePid: number,
  children: Map<number, number[]>,
  table: Map<number, ProcInfo>,
): number | null {
  const stack = [panePid]
  while (stack.length > 0) {
    const pid = stack.pop()!
    const info = table.get(pid)
    if (info && isClaude(info)) return pid
    stack.push(...(children.get(pid) ?? []))
  }
  return null
}

function readCwd(pid: number): string | null {
  try {
    return readlinkSync(`${PROC}/${pid}/cwd`)
  } catch {
    return null
  }
}

// opportunistic exact match: a fd pointing at a known session's .jsonl
// (claude usually doesn't keep it open, so this is best-effort)
function fdSessionMatch(pid: number, byId: Map<string, DiscoveredSession>): string | null {
  try {
    for (const fd of readdirSync(`${PROC}/${pid}/fd`)) {
      let link: string
      try {
        link = readlinkSync(`${PROC}/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      const m = link.match(UUID_JSONL_RE)
      if (m && byId.has(m[1])) return m[1]
    }
  } catch {
    // no fd access → skip
  }
  return null
}

// does a live pane (by target) have a claude process in its tree?
// works before the session's jsonl exists — used to nudge the folder-trust prompt.
export async function paneHasClaude(target: string): Promise<boolean> {
  const pane = (await listPanes()).find((p) => p.target === target)
  if (!pane) return false
  const table = readProcTable()
  const children = new Map<number, number[]>()
  for (const info of table.values()) {
    const list = children.get(info.ppid)
    if (list) list.push(info.pid)
    else children.set(info.ppid, [info.pid])
  }
  return findClaudeDescendant(pane.pid, children, table) !== null
}

// which of the given panes have a claude process in their tree.
// builds the proc table once, unlike calling paneHasClaude per pane.
export function panesWithClaude(panes: Pane[]): Set<string> {
  const table = readProcTable()
  const children = new Map<number, number[]>()
  for (const info of table.values()) {
    const list = children.get(info.ppid)
    if (list) list.push(info.pid)
    else children.set(info.ppid, [info.pid])
  }
  const out = new Set<string>()
  for (const pane of panes) {
    if (findClaudeDescendant(pane.pid, children, table) !== null) out.add(pane.target)
  }
  return out
}

// map of sessionId -> tmux target for sessions a live claude process is writing
export async function getActiveTargets(
  sessions: DiscoveredSession[],
): Promise<Map<string, string>> {
  const panes = await listPanes()
  const table = readProcTable()

  // ppid -> children index
  const children = new Map<number, number[]>()
  for (const info of table.values()) {
    const list = children.get(info.ppid)
    if (list) list.push(info.pid)
    else children.set(info.ppid, [info.pid])
  }

  const byId = new Map(sessions.map((s) => [s.id, s]))
  const result = new Map<string, string>() // sessionId -> target
  const usedSessions = new Set<string>()

  // resolve each pane to its live claude process + cwd
  interface Claim {
    pane: Pane
    claudePid: number
    cwd: string
  }
  const claims: Claim[] = []
  for (const pane of panes) {
    const claudePid = findClaudeDescendant(pane.pid, children, table)
    if (claudePid === null) continue
    // fall back to pane_current_path if /proc cwd read fails
    const cwd = readCwd(claudePid) ?? pane.cwd
    claims.push({ pane, claudePid, cwd })
  }

  // pass 1: exact fd matches take priority
  const unresolved: Claim[] = []
  for (const claim of claims) {
    const sid = fdSessionMatch(claim.claudePid, byId)
    if (sid && !usedSessions.has(sid)) {
      result.set(sid, claim.pane.target)
      usedSessions.add(sid)
    } else {
      unresolved.push(claim)
    }
  }

  // pass 2: cwd matching. group panes by resolved cwd so multiple claude panes
  // in the SAME cwd get DISTINCT sessions — heuristic: sort candidate sessions by
  // lastModified desc, sort panes by target, pair one-to-one; leftover panes get nothing.
  const byCwd = new Map<string, Claim[]>()
  for (const claim of unresolved) {
    const list = byCwd.get(claim.cwd)
    if (list) list.push(claim)
    else byCwd.set(claim.cwd, [claim])
  }

  for (const [cwd, group] of byCwd) {
    const inCwd = sessions.filter((s) => s.projectPath === cwd && !usedSessions.has(s.id))
    // hook/sdk side sessions (entrypoint sdk-*) share the cwd but never own a pane —
    // only interactive cli sessions qualify; fall back to all if entrypoint is unknown
    const cli = inCwd.filter((s) => s.entrypoint === 'cli')
    const candidates = (cli.length ? cli : inCwd).sort((a, b) => b.lastModified - a.lastModified)
    const orderedPanes = group.sort((a, b) =>
      a.pane.target.localeCompare(b.pane.target),
    )
    const pairs = Math.min(orderedPanes.length, candidates.length)
    for (let i = 0; i < pairs; i++) {
      result.set(candidates[i].id, orderedPanes[i].pane.target)
      usedSessions.add(candidates[i].id)
    }
  }

  return result
}
