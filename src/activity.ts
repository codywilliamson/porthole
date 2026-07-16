// active detection: correlate running agent processes (claude/codex) with sessions
// and tmux targets. consumes tmux.listPanes() — never spawns tmux itself
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import type { Provider } from '../shared/types'
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

// claude = comm 'claude', or argv0 basename 'claude', or node running claude.
// codex = comm/argv0 starting with 'codex' (native binary is codex-linux-x64),
// or node running the codex.js shim.
function agentOf(info: ProcInfo): Provider | null {
  if (info.comm === 'claude') return 'claude'
  if (info.comm.startsWith('codex')) return 'codex'
  const argv = readArgv(info.pid)
  if (argv.length === 0) return null
  const a0 = basename(argv[0])
  if (a0 === 'claude') return 'claude'
  if (a0.startsWith('codex')) return 'codex'
  if (a0 === 'node' && argv[1]) {
    const a1 = basename(argv[1])
    if (a1 === 'claude') return 'claude'
    if (a1 === 'codex' || a1 === 'codex.js') return 'codex'
  }
  return null
}

// find first agent process in the pane_pid's tree — including pane_pid itself:
// `tmux new-window 'claude ...'` makes the pane process the agent directly, no shell parent
function findAgentDescendant(
  panePid: number,
  children: Map<number, number[]>,
  table: Map<number, ProcInfo>,
): { pid: number; provider: Provider } | null {
  const stack = [panePid]
  while (stack.length > 0) {
    const pid = stack.pop()!
    const info = table.get(pid)
    const provider = info ? agentOf(info) : null
    if (info && provider) return { pid, provider }
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

// opportunistic exact match: a fd pointing at a known session's jsonl, provider-
// consistent with the process. matches both <uuid>.jsonl and rollout-…-<uuid>.jsonl
// (claude usually doesn't keep it open; codex does — best-effort either way)
function fdSessionMatch(
  pid: number,
  provider: Provider,
  byId: Map<string, DiscoveredSession>,
): string | null {
  try {
    for (const fd of readdirSync(`${PROC}/${pid}/fd`)) {
      let link: string
      try {
        link = readlinkSync(`${PROC}/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      const m = link.match(UUID_JSONL_RE)
      if (!m) continue
      const session = byId.get(m[1].toLowerCase())
      if (session && session.provider === provider) return session.id
    }
  } catch {
    // no fd access → skip
  }
  return null
}

// which agent (if any) runs in a live pane's process tree?
// works before the session's jsonl exists — used to gate nudges.
export async function paneAgent(target: string): Promise<Provider | null> {
  const pane = (await listPanes()).find((p) => p.target === target)
  if (!pane) return null
  const table = readProcTable()
  const children = childIndex(table)
  return findAgentDescendant(pane.pid, children, table)?.provider ?? null
}

function childIndex(table: Map<number, ProcInfo>): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const info of table.values()) {
    const list = children.get(info.ppid)
    if (list) list.push(info.pid)
    else children.set(info.ppid, [info.pid])
  }
  return children
}

// which of the given panes have an agent process in their tree, and which one.
// builds the proc table once, unlike calling paneAgent per pane.
export function panesWithAgent(panes: Pane[]): Map<string, Provider> {
  const table = readProcTable()
  const children = childIndex(table)
  const out = new Map<string, Provider>()
  for (const pane of panes) {
    const found = findAgentDescendant(pane.pid, children, table)
    if (found) out.set(pane.target, found.provider)
  }
  return out
}

// map of sessionId -> tmux target for sessions a live agent process is writing
export async function getActiveTargets(
  sessions: DiscoveredSession[],
): Promise<Map<string, string>> {
  const panes = await listPanes()
  const table = readProcTable()
  const children = childIndex(table)

  const byId = new Map(sessions.map((s) => [s.id, s]))
  const result = new Map<string, string>() // sessionId -> target
  const usedSessions = new Set<string>()

  // resolve each pane to its live agent process + cwd
  interface Claim {
    pane: Pane
    agentPid: number
    provider: Provider
    cwd: string
  }
  const claims: Claim[] = []
  for (const pane of panes) {
    const found = findAgentDescendant(pane.pid, children, table)
    if (!found) continue
    // fall back to pane_current_path if /proc cwd read fails
    const cwd = readCwd(found.pid) ?? pane.cwd
    claims.push({ pane, agentPid: found.pid, provider: found.provider, cwd })
  }

  // pass 1: exact fd matches take priority
  const unresolved: Claim[] = []
  for (const claim of claims) {
    const sid = fdSessionMatch(claim.agentPid, claim.provider, byId)
    if (sid && !usedSessions.has(sid)) {
      result.set(sid, claim.pane.target)
      usedSessions.add(sid)
    } else {
      unresolved.push(claim)
    }
  }

  // pass 2: cwd matching within a provider. group panes by provider+cwd so multiple
  // agent panes in the SAME cwd get DISTINCT sessions — heuristic: sort candidate
  // sessions by lastModified desc, sort panes by target, pair one-to-one; leftover
  // panes get nothing.
  const byCwd = new Map<string, Claim[]>()
  for (const claim of unresolved) {
    const key = `${claim.provider}\0${claim.cwd}`
    const list = byCwd.get(key)
    if (list) list.push(claim)
    else byCwd.set(key, [claim])
  }

  for (const [key, group] of byCwd) {
    const [provider, cwd] = key.split('\0')
    const inCwd = sessions.filter(
      (s) => s.provider === provider && s.projectPath === cwd && !usedSessions.has(s.id),
    )
    // hook/sdk/ide side sessions (entrypoint sdk-*/vscode) share the cwd but never own
    // a pane — only interactive cli sessions qualify; fall back to all if unknown
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
