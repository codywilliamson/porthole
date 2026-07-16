// codex cli session discovery + rollout jsonl parsing — no tmux/process knowledge here
// mirrors transcript.ts for ~/.codex/sessions/<y>/<m>/<d>/rollout-<ts>-<uuid>.jsonl
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { TranscriptEvent } from '../shared/types'
import { toTitle, type DiscoveredSession } from './transcript'

const ROLLOUT_RE = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

// loose shapes — codex rollout schema drifts across versions, stay defensive
interface RawLine {
  timestamp?: string
  type?: string
  payload?: Payload
}

interface Payload {
  type?: string
  // session_meta
  id?: string
  cwd?: string
  source?: string
  originator?: string
  // event_msg user_message
  message?: string
  // response_item message / reasoning
  role?: string
  content?: unknown
  summary?: unknown
  // response_item *_call / *_call_output
  call_id?: string
  name?: string
  arguments?: string
  input?: unknown
  action?: unknown
  output?: unknown
}

interface ContentBlock {
  type?: string
  text?: string
}

// codex lines carry no per-event id — synthesize monotonic keys for the ui
let seq = 0
const nextUuid = () => `cx-${++seq}`

// ---- parsing ----

function joinText(blocks: unknown, blockType: string): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b: ContentBlock) => b?.type === blockType && typeof b.text === 'string')
    .map((b: ContentBlock) => b.text)
    .join('')
}

function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args
  try {
    return JSON.parse(args)
  } catch {
    return args
  }
}

// exec outputs are often a json envelope {"output": "...", "metadata": {"exit_code": n}}
function flattenOutput(output: unknown): { text: string; isError: boolean } {
  if (typeof output === 'string') {
    if (output.startsWith('{')) {
      try {
        const o = JSON.parse(output) as { output?: unknown; metadata?: { exit_code?: unknown } }
        if (o && typeof o.output === 'string') {
          return { text: o.output, isError: typeof o.metadata?.exit_code === 'number' && o.metadata.exit_code !== 0 }
        }
      } catch {
        // plain string that happens to start with '{'
      }
    }
    return { text: output, isError: false }
  }
  if (Array.isArray(output)) return { text: joinText(output, 'output_text'), isError: false }
  return { text: '', isError: false }
}

function eventsFromObj(obj: RawLine): TranscriptEvent[] {
  if (!obj || typeof obj !== 'object') return []
  const p = obj.payload
  if (!p || typeof p !== 'object') return []
  const timestamp = obj.timestamp ?? ''

  // user text comes ONLY from event_msg — response_item user messages duplicate
  // it and carry env-context wrappers
  if (obj.type === 'event_msg') {
    if (p.type === 'user_message' && typeof p.message === 'string' && p.message.trim()) {
      return [{ kind: 'user_message', uuid: nextUuid(), timestamp, text: p.message }]
    }
    return [] // agent_message/agent_reasoning duplicate response_item lines — skip
  }

  if (obj.type !== 'response_item') return []

  switch (p.type) {
    case 'message': {
      if (p.role !== 'assistant') return []
      const text = joinText(p.content, 'output_text')
      return text ? [{ kind: 'assistant_text', uuid: nextUuid(), timestamp, text }] : []
    }
    case 'reasoning': {
      // encrypted reasoning has an empty summary → nothing to show
      const text = Array.isArray(p.summary)
        ? p.summary
            .filter((b: ContentBlock) => b?.type === 'summary_text' && typeof b.text === 'string')
            .map((b: ContentBlock) => b.text)
            .join('\n\n')
        : ''
      return text ? [{ kind: 'thinking', uuid: nextUuid(), timestamp, text }] : []
    }
    case 'function_call':
    case 'custom_tool_call': {
      const input = p.type === 'function_call' ? parseArgs(p.arguments) : (p.input ?? parseArgs(p.arguments))
      const uuid = nextUuid()
      return [{ kind: 'tool_use', uuid, timestamp, toolId: p.call_id ?? uuid, name: p.name ?? p.type, input }]
    }
    case 'local_shell_call': {
      const uuid = nextUuid()
      return [{ kind: 'tool_use', uuid, timestamp, toolId: p.call_id ?? uuid, name: 'shell', input: p.action }]
    }
    case 'web_search_call': {
      const uuid = nextUuid()
      return [{ kind: 'tool_use', uuid, timestamp, toolId: p.call_id ?? uuid, name: 'web_search', input: p.action }]
    }
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const { text, isError } = flattenOutput(p.output)
      const uuid = nextUuid()
      return [{ kind: 'tool_result', uuid, timestamp, toolId: p.call_id ?? uuid, text, isError }]
    }
  }

  return [] // unknown/ignored types
}

// parse one raw rollout jsonl line; 0..n events, never throws
export function parseCodexLine(line: string): TranscriptEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  try {
    return eventsFromObj(JSON.parse(trimmed) as RawLine)
  } catch {
    return []
  }
}

// ---- discovery ----

interface Meta {
  title: string
  projectPath: string
  entrypoint: string
  eventCount: number
  lastEventTime: number
}

interface CacheEntry extends Meta {
  mtimeMs: number
  size: number
}

const metaCache = new Map<string, CacheEntry>()

function deriveMeta(raw: string): Meta {
  let firstUserText = ''
  let projectPath = ''
  let entrypoint = ''
  let eventCount = 0
  let lastEventTime = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: RawLine
    try {
      obj = JSON.parse(trimmed) as RawLine
    } catch {
      continue
    }
    if (obj?.type === 'session_meta' && obj.payload) {
      if (typeof obj.payload.cwd === 'string') projectPath = obj.payload.cwd
      // 'cli' = interactive tui that can own a pane; vscode/exec sessions can't
      if (typeof obj.payload.source === 'string') entrypoint = obj.payload.source
    }
    if (!projectPath && obj?.type === 'turn_context' && typeof obj.payload?.cwd === 'string') {
      projectPath = obj.payload.cwd
    }
    if (typeof obj?.timestamp === 'string') {
      const t = Date.parse(obj.timestamp)
      if (t > lastEventTime) lastEventTime = t // NaN never wins
    }
    const events = eventsFromObj(obj)
    eventCount += events.length
    if (!firstUserText) {
      const um = events.find((e) => e.kind === 'user_message')
      if (um) firstUserText = um.text
    }
  }
  return { title: toTitle(firstUserText), projectPath, entrypoint, eventCount, lastEventTime }
}

async function getMeta(filePath: string, mtimeMs: number, size: number): Promise<Meta> {
  const cached = metaCache.get(filePath)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached
  const raw = size === 0 ? '' : await readFile(filePath, 'utf8')
  const meta = deriveMeta(raw)
  metaCache.set(filePath, { ...meta, mtimeMs, size })
  return meta
}

// ~/.codex/session_index.jsonl maps session id -> user-visible thread name
async function readThreadNames(sessionsDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  let raw: string
  try {
    raw = await readFile(join(dirname(sessionsDir), 'session_index.jsonl'), 'utf8')
  } catch {
    return names
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as { id?: string; thread_name?: string }
      if (typeof obj?.id === 'string' && typeof obj.thread_name === 'string' && obj.thread_name) {
        names.set(obj.id, obj.thread_name)
      }
    } catch {
      continue
    }
  }
  return names
}

// list all codex sessions under sessionsDir (y/m/d tree), newest first
export async function discoverCodexSessions(sessionsDir: string): Promise<DiscoveredSession[]> {
  let entries: string[]
  try {
    entries = (await readdir(sessionsDir, { recursive: true })) as string[]
  } catch {
    return []
  }
  const threadNames = await readThreadNames(sessionsDir)

  const sessions = await Promise.all(
    entries
      .map((rel) => ({ rel, m: ROLLOUT_RE.exec(basename(rel)) }))
      .filter((e): e is { rel: string; m: RegExpExecArray } => e.m !== null)
      .map(async ({ rel, m }): Promise<DiscoveredSession | null> => {
        const filePath = join(sessionsDir, rel)
        let st
        try {
          st = await stat(filePath)
        } catch {
          return null // unreadable — skip
        }
        if (!st.isFile()) return null
        const id = m[1].toLowerCase()
        const meta = await getMeta(filePath, st.mtimeMs, st.size)
        const threadName = threadNames.get(id)
        return {
          id,
          provider: 'codex',
          filePath,
          projectDir: dirname(filePath),
          lastModified: meta.lastEventTime || st.mtimeMs,
          eventCount: meta.eventCount,
          projectPath: meta.projectPath,
          entrypoint: meta.entrypoint,
          title: threadName ? toTitle(threadName) : meta.title,
        }
      }),
  )

  return sessions
    .filter((s): s is DiscoveredSession => s !== null)
    .sort((a, b) => b.lastModified - a.lastModified)
}
