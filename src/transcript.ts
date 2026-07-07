// session discovery + jsonl parsing — no tmux/process knowledge here
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { SessionSummary, TranscriptEvent } from '../shared/types'

export interface DiscoveredSession extends Omit<SessionSummary, 'active' | 'tmuxTarget'> {
  filePath: string
  // 'cli' = interactive terminal session; 'sdk-py' etc = hook/sdk side sessions
  // that share the same cwd but can never own a tmux pane
  entrypoint: string
}

const TITLE_MAX = 80
const UNTITLED = '(untitled)'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// harness-injected user-role messages that aren't things the human typed:
// slash-command wrappers, and subagent/hook notifications the runtime feeds back
// (task-notifications wrap a subagent's result, so they'd otherwise render as a
// message the user "sent")
const COMMAND_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<local-command',
  '<local-command-caveat',
  '<task-notification>',
  '<system-reminder>',
]

// loose shape of a raw jsonl line — schema drifts across cc versions, stay defensive
interface RawLine {
  type?: string
  uuid?: string
  timestamp?: string
  cwd?: string
  isSidechain?: boolean
  isMeta?: boolean
  aiTitle?: string
  entrypoint?: string
  message?: { role?: string; content?: unknown }
}

interface ContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

// derived per-file metadata we cache between polls
interface Meta {
  title: string
  projectPath: string
  entrypoint: string
  eventCount: number
  // epoch ms of the newest timestamped line — the real "last activity". file
  // mtime is NOT a proxy: claude rewrites timestamp-less bookkeeping lines
  // (last-prompt/mode/permission-mode/ai-title) long after a convo ends, so an
  // idle session's file gets touched "now" while its last event is days old.
  lastEventTime: number
}

interface CacheEntry extends Meta {
  mtimeMs: number
  size: number
}

const metaCache = new Map<string, CacheEntry>()

// ---- parsing ----

function isSkippableUserText(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  return COMMAND_PREFIXES.some((p) => t.startsWith(p))
}

// flatten a tool_result's content (string | array of blocks) to plain text
function flattenResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: ContentBlock) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : `[${b?.type ?? 'block'}]`))
      .join('')
  }
  return ''
}

function eventsFromObj(obj: RawLine): TranscriptEvent[] {
  if (!obj || typeof obj !== 'object') return []
  if (obj.isSidechain === true) return []
  const { type, uuid = '', timestamp = '' } = obj
  const content = obj.message?.content

  if (type === 'assistant') {
    if (!Array.isArray(content)) return []
    const out: TranscriptEvent[] = []
    for (const block of content as ContentBlock[]) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        out.push({ kind: 'assistant_text', uuid, timestamp, text: block.text })
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        out.push({ kind: 'thinking', uuid, timestamp, text: block.thinking })
      } else if (block?.type === 'tool_use') {
        out.push({ kind: 'tool_use', uuid, timestamp, toolId: block.id ?? '', name: block.name ?? '', input: block.input })
      }
    }
    return out
  }

  if (type === 'user') {
    if (obj.isMeta === true) return []
    // plain string content → single user message
    if (typeof content === 'string') {
      return isSkippableUserText(content) ? [] : [{ kind: 'user_message', uuid, timestamp, text: content }]
    }
    if (!Array.isArray(content)) return []
    const out: TranscriptEvent[] = []
    for (const block of content as ContentBlock[]) {
      if (block?.type === 'tool_result') {
        out.push({
          kind: 'tool_result',
          uuid,
          timestamp,
          toolId: block.tool_use_id ?? '',
          text: flattenResult(block.content),
          isError: !!block.is_error,
        })
      } else if (block?.type === 'text' && typeof block.text === 'string' && !isSkippableUserText(block.text)) {
        out.push({ kind: 'user_message', uuid, timestamp, text: block.text })
      }
    }
    return out
  }

  return [] // unknown/ignored types
}

// parse one raw jsonl line; a line can yield 0..n events
// (assistant messages hold multiple content blocks)
export function parseLine(line: string): TranscriptEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  try {
    return eventsFromObj(JSON.parse(trimmed) as RawLine)
  } catch {
    return [] // malformed/partial line — skip, never throw
  }
}

// parse a whole session file to renderable events
export async function parseTranscriptFile(filePath: string): Promise<TranscriptEvent[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  const events: TranscriptEvent[] = []
  for (const line of raw.split('\n')) {
    for (const e of parseLine(line)) events.push(e)
  }
  return events
}

// ---- discovery ----

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function toTitle(raw: string): string {
  const s = collapse(raw)
  if (!s) return UNTITLED
  return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1) + '…' : s
}

// eventCount = total parseLine outputs (renderable events) across the file
function deriveMeta(raw: string): Meta {
  let lastTitle = ''
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
    if (obj?.type === 'ai-title' && typeof obj.aiTitle === 'string') lastTitle = obj.aiTitle
    if (!projectPath && typeof obj?.cwd === 'string' && obj.cwd) projectPath = obj.cwd
    if (!entrypoint && typeof obj?.entrypoint === 'string' && obj.entrypoint) entrypoint = obj.entrypoint
    // real convo/tool/system lines carry a timestamp; bookkeeping lines don't
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
  return {
    title: lastTitle ? toTitle(lastTitle) : toTitle(firstUserText),
    projectPath,
    entrypoint,
    eventCount,
    lastEventTime,
  }
}

async function getMeta(filePath: string, mtimeMs: number, size: number): Promise<Meta> {
  const cached = metaCache.get(filePath)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached
  const raw = size === 0 ? '' : await readFile(filePath, 'utf8')
  const meta = deriveMeta(raw)
  metaCache.set(filePath, { ...meta, mtimeMs, size })
  return meta
}

// list all sessions across all project dirs, newest first
// excludes <uuid>/subagents/*.jsonl (only top-level <uuid>.jsonl per project dir)
export async function discoverSessions(projectsDir: string): Promise<DiscoveredSession[]> {
  let projectDirs: string[]
  try {
    projectDirs = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }

  const sessions = await Promise.all(
    projectDirs.map(async (dirName) => {
      const projectDir = join(projectsDir, dirName)
      let files: string[]
      try {
        files = (await readdir(projectDir, { withFileTypes: true }))
          .filter((f) => f.isFile() && f.name.endsWith('.jsonl') && UUID_RE.test(basename(f.name, '.jsonl')))
          .map((f) => f.name)
      } catch {
        return []
      }
      return Promise.all(
        files.map(async (name): Promise<DiscoveredSession | null> => {
          const filePath = join(projectDir, name)
          let st
          try {
            st = await stat(filePath)
          } catch {
            return null // unreadable — skip
          }
          const meta = await getMeta(filePath, st.mtimeMs, st.size)
          return {
            id: basename(name, '.jsonl'),
            filePath,
            projectDir,
            // last real activity, not file mtime — fall back to mtime only when
            // the file has no timestamped events at all
            lastModified: meta.lastEventTime || st.mtimeMs,
            eventCount: meta.eventCount,
            projectPath: meta.projectPath,
            entrypoint: meta.entrypoint,
            title: meta.title,
          }
        }),
      )
    }),
  )

  return sessions
    .flat()
    .filter((s): s is DiscoveredSession => s !== null)
    .sort((a, b) => b.lastModified - a.lastModified)
}
