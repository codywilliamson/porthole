import { existsSync, watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { config } from './config'
import { discoverSessions, parseLine, type DiscoveredSession } from './transcript'
import { discoverCodexSessions, parseCodexLine } from './codex'
import { getActiveTargets, paneAgent, panesWithAgent } from './activity'
import {
  sendToPane,
  resumeSession,
  launchClaude,
  killWindow,
  sendKey,
  sendKeys,
  capturePane,
  listPanes,
  type TmuxKey,
} from './tmux'
import { knownProjects, listDirs, isLaunchableDir } from './projects'
import type { SessionSummary, TranscriptEvent, NudgeKey, AskQuestion } from '../shared/types'

// tuning knobs
const HEARTBEAT_MS = 15_000
const STATUS_MS = 5_000
const CHECK_DEBOUNCE_MS = 100
// coalesce the many near-simultaneous discover+active calls (list poll + per-stream ticks)
const LOAD_TTL_MS = 1_000
// parsed-transcript LRU: warm re-opens skip the multi-MB re-parse
const TX_CACHE_MAX = 8

const DIST = resolve(import.meta.dir, '../dist')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()

// --- helpers ---

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// discover + active targets in one shot — the two feed every route.
// memoized for ~1s: a single in-flight promise is shared by concurrent callers
// (list poll + every stream's status tick) to avoid stampeding /proc + fs.
type LoadResult = { sessions: DiscoveredSession[]; targets: Map<string, string> }
let loadCache: { at: number; promise: Promise<LoadResult> } | null = null

function loadSessions(): Promise<LoadResult> {
  const now = Date.now()
  if (loadCache && now - loadCache.at < LOAD_TTL_MS) return loadCache.promise
  const promise = (async () => {
    const [claude, codex] = await Promise.all([
      discoverSessions(config.projectsDir),
      discoverCodexSessions(config.codexDir),
    ])
    const sessions = [...claude, ...codex].sort((a, b) => b.lastModified - a.lastModified)
    const targets = await getActiveTargets(sessions)
    return { sessions, targets }
  })()
  loadCache = { at: now, promise }
  // don't cache a rejection — let the next caller retry
  promise.catch(() => {
    if (loadCache?.promise === promise) loadCache = null
  })
  return promise
}

// --- parsed-transcript LRU cache ---

interface TxCacheEntry {
  size: number
  mtimeMs: number
  events: TranscriptEvent[]
  offset: number // byte position of the first not-yet-complete line
}

// map insertion order = access order; re-set on touch, evict from the front
const txCache = new Map<string, TxCacheEntry>()

function touchTxCache(filePath: string, entry: TxCacheEntry): void {
  txCache.delete(filePath)
  txCache.set(filePath, entry)
  while (txCache.size > TX_CACHE_MAX) {
    const oldest = txCache.keys().next().value
    if (oldest === undefined) break
    txCache.delete(oldest)
  }
}

type LineParser = (line: string) => TranscriptEvent[]

// which jsonl dialect a session's file speaks
function parserFor(session: DiscoveredSession): LineParser {
  return session.provider === 'codex' ? parseCodexLine : parseLine
}

// parse complete (newline-terminated) lines from text into out;
// returns bytes consumed up to the last newline (incomplete tail left unparsed)
function parseComplete(text: string, out: TranscriptEvent[], parse: LineParser): number {
  const lines = text.split('\n')
  const remainder = lines.pop() ?? ''
  for (const line of lines) if (line.trim()) out.push(...parse(line))
  return Buffer.byteLength(text, 'utf8') - Buffer.byteLength(remainder, 'utf8')
}

// warm-cached read: unchanged file → instant; grown → parse appended bytes only;
// shrunk/new → full parse. self-heals a stale entry via the grown path.
async function readTranscriptCached(filePath: string, parse: LineParser): Promise<TxCacheEntry> {
  const st = await stat(filePath)
  const cached = txCache.get(filePath)
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    touchTxCache(filePath, cached)
    return cached
  }
  let events: TranscriptEvent[]
  let offset: number
  if (cached && st.size > cached.size) {
    const chunk = await Bun.file(filePath).slice(cached.offset, st.size).text()
    events = cached.events.slice()
    offset = cached.offset + parseComplete(chunk, events, parse)
  } else {
    const raw = await Bun.file(filePath).text()
    events = []
    offset = parseComplete(raw, events, parse)
  }
  const entry: TxCacheEntry = { size: st.size, mtimeMs: st.mtimeMs, events, offset }
  touchTxCache(filePath, entry)
  return entry
}

// extend a coherent cache entry with tail-parsed events so re-opens stay warm.
// no-op if the entry was evicted or diverged — readTranscriptCached self-heals.
function appendTxCache(
  filePath: string,
  startOffset: number,
  newEvents: TranscriptEvent[],
  offset: number,
  size: number,
  mtimeMs: number,
): void {
  const cached = txCache.get(filePath)
  if (!cached || cached.offset !== startOffset) return
  touchTxCache(filePath, {
    size,
    mtimeMs,
    offset,
    events: newEvents.length ? cached.events.concat(newEvents) : cached.events,
  })
}

// merge active/tmuxTarget and strip internal fields
function toSummary(s: DiscoveredSession, targets: Map<string, string>): SessionSummary {
  const { filePath: _filePath, entrypoint: _entrypoint, ...rest } = s
  return { ...rest, active: targets.has(s.id), tmuxTarget: targets.get(s.id) ?? null }
}

// keep resolution inside dist — reject traversal
function safeJoin(base: string, pathname: string): string | null {
  const target = resolve(base, `.${pathname}`)
  return target === base || target.startsWith(base + sep) ? target : null
}

// --- SSE live-tail ---

function streamSession(session: DiscoveredSession, summary: SessionSummary, signal: AbortSignal): Response {
  const filePath = session.filePath
  const parse = parserFor(session)
  // offset = byte position of the first not-yet-complete line (line boundary)
  let offset = 0
  let closed = false

  let watcher: FSWatcher | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let statusTimer: ReturnType<typeof setInterval> | null = null
  let checkTimer: ReturnType<typeof setTimeout> | null = null

  let lastActive = summary.active
  let lastTarget = summary.tmuxTarget

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(sseFrame(event, data))
        } catch {
          cleanup()
        }
      }
      const ping = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }

      // read appended bytes, emit complete lines, keep the cache warm
      const scanGrowth = async (size: number, mtimeMs: number) => {
        const startOffset = offset
        const chunk = await Bun.file(filePath).slice(startOffset, size).text()
        const events: TranscriptEvent[] = []
        offset = startOffset + parseComplete(chunk, events, parse)
        appendTxCache(filePath, startOffset, events, offset, size, mtimeMs)
        if (events.length) send('events', events)
      }

      // debounced funnel for both watch + poll
      const runCheck = async () => {
        if (closed) return
        let st
        try {
          st = await stat(filePath)
        } catch {
          return // file vanished; poll will retry
        }
        if (st.size < offset) {
          // file replaced/truncated — full re-parse
          const entry = await readTranscriptCached(filePath, parse)
          offset = entry.offset
          send('reset', { session: summary, events: entry.events })
        } else if (st.size > offset) {
          await scanGrowth(st.size, st.mtimeMs)
        }
      }
      const scheduleCheck = () => {
        if (closed || checkTimer) return
        checkTimer = setTimeout(() => {
          checkTimer = null
          runCheck().catch((err) => console.error('tail check failed', err))
        }, CHECK_DEBOUNCE_MS)
      }

      const checkStatus = async () => {
        if (closed) return
        const { sessions, targets } = await loadSessions()
        if (!sessions.some((s) => s.id === session.id)) return
        const active = targets.has(session.id)
        const tmuxTarget = targets.get(session.id) ?? null
        if (active !== lastActive || tmuxTarget !== lastTarget) {
          lastActive = active
          lastTarget = tmuxTarget
          send('status', { active, tmuxTarget })
        }
      }

      try {
        const entry = await readTranscriptCached(filePath, parse)
        offset = entry.offset
        send('init', { session: summary, events: entry.events })
      } catch (err) {
        console.error('stream init failed', err)
        cleanup()
        return
      }

      try {
        watcher = watch(filePath, scheduleCheck)
      } catch {
        watcher = null // polling covers us
      }
      pollTimer = setInterval(scheduleCheck, config.pollMs)
      heartbeatTimer = setInterval(ping, HEARTBEAT_MS)
      statusTimer = setInterval(() => {
        checkStatus().catch((err) => console.error('status check failed', err))
      }, STATUS_MS)
    },
    cancel() {
      cleanup()
    },
  })

  function cleanup() {
    if (closed) return
    closed = true
    watcher?.close()
    if (pollTimer) clearInterval(pollTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (statusTimer) clearInterval(statusTimer)
    if (checkTimer) clearTimeout(checkTimer)
    watcher = null
    pollTimer = heartbeatTimer = statusTimer = checkTimer = null
  }

  signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

// --- routes ---

async function handleSessions(): Promise<Response> {
  const { sessions, targets } = await loadSessions()
  return json(sessions.map((s) => toSummary(s, targets)))
}

async function handleStream(id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'invalid session id' }, 400)
  const { sessions, targets } = await loadSessions()
  const session = sessions.find((s) => s.id === id)
  if (!session) return json({ error: 'session not found' }, 404)
  return streamSession(session, toSummary(session, targets), req.signal)
}

// full tmux pane overview — every pane, mapped to its porthole session when active
async function handlePanes(): Promise<Response> {
  const [{ sessions, targets }, panes] = await Promise.all([loadSessions(), listPanes()])
  const agents = panesWithAgent(panes)
  const sessionByTarget = new Map<string, string>()
  for (const [sid, t] of targets) sessionByTarget.set(t, sid)
  const titleById = new Map(sessions.map((s) => [s.id, s.title]))
  const out = panes.map((p) => {
    const sessionId = sessionByTarget.get(p.target) ?? null
    return {
      target: p.target,
      cwd: p.cwd,
      command: p.command,
      agent: agents.get(p.target) ?? null,
      sessionId,
      title: sessionId ? (titleById.get(sessionId) ?? null) : null,
    }
  })
  return json({ panes: out })
}

async function handleSend(id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid session id' }, 400)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const text = (body as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || !text.trim()) {
    return json({ ok: false, error: 'text required' }, 400)
  }
  const { targets } = await loadSessions()
  const target = targets.get(id)
  if (!target) return json({ ok: false, error: 'session not active' }, 409)
  try {
    await sendToPane(target, text)
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
  return json({ ok: true })
}

async function handleResume(id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid session id' }, 400)
  const { sessions, targets } = await loadSessions()
  const session = sessions.find((s) => s.id === id)
  if (!session) return json({ ok: false, error: 'session not found' }, 404)
  if (targets.has(id)) return json({ ok: false, error: 'already active' }, 409)
  try {
    await resumeSession(session.projectPath, id, session.provider)
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
  return json({ ok: true })
}

// --- launcher routes ---

async function handleProjects(): Promise<Response> {
  const { sessions } = await loadSessions()
  return json({ root: config.rootDir, known: knownProjects(sessions) })
}

async function handleDirs(rel: string): Promise<Response> {
  const result = await listDirs(rel)
  if (!result) return json({ error: 'invalid or missing directory' }, 400)
  return json(result)
}

async function handleLaunch(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const dir = (body as { dir?: unknown } | null)?.dir
  if (typeof dir !== 'string' || !dir) return json({ ok: false, error: 'dir required' }, 400)
  const { sessions } = await loadSessions()
  if (!isLaunchableDir(dir, sessions)) return json({ ok: false, error: 'dir not launchable' }, 403)
  try {
    const target = await launchClaude(dir)
    return json({ ok: true, target })
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
}

const NUDGE_KEYS: Record<NudgeKey, TmuxKey> = { enter: 'Enter', escape: 'Escape' }

async function handleNudge(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const { target, key } = (body as { target?: unknown; key?: unknown } | null) ?? {}
  if (typeof target !== 'string' || !target) return json({ ok: false, error: 'target required' }, 400)
  const tmuxKey = typeof key === 'string' ? NUDGE_KEYS[key as NudgeKey] : undefined
  if (!tmuxKey) return json({ ok: false, error: 'key must be enter or escape' }, 400)
  // only nudge a live pane running an agent (works before the jsonl exists)
  if (!(await paneAgent(target))) return json({ ok: false, error: 'no agent pane at target' }, 404)
  try {
    await sendKey(target, tmuxKey)
    return json({ ok: true })
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
}

async function handleClose(id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid session id' }, 400)
  const { targets } = await loadSessions()
  const target = targets.get(id)
  if (!target) return json({ ok: false, error: 'session not active' }, 409)
  try {
    await killWindow(target)
    return json({ ok: true })
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
}

// --- AskUserQuestion answering ---
//
// claude buffers the AskUserQuestion assistant message out of the jsonl until
// the tool resolves — the tool_use + tool_result land together at answer time,
// so a *pending* question is never visible in the transcript (empirically
// verified). the only live signal is the tmux pane, so we detect + validate
// against a capture-pane of the picker.

// an option line: `❯ 1. Red` (single) or `  2. [ ] Cheese` (multiSelect)
const PICKER_OPT_RE = /^[\s❯>]*(\d+)\.\s+(?:\[[ xX✔]\]\s+)?(.+?)\s*$/
// the picker auto-appends these after the model's options — never answerable
const PICKER_AUTO_LABEL = /^(Type something\.?|Chat about this)$/
const PICKER_RULE_RE = /^[─—-]{3,}$/

// parse an AskUserQuestion picker out of pane text; null when no picker is up.
// only the currently-focused question tab is visible/parseable — which is the
// one a fresh single-question picker starts on.
function parsePicker(pane: string): AskQuestion | null {
  const lines = pane.split('\n')
  const footerIdx = lines.findIndex((l) => /to navigate/.test(l) && /cancel/i.test(l))
  if (footerIdx < 0) return null

  const multiSelect =
    lines.some((l) => /^[\s❯>]*\d+\.\s+\[[ xX✔]\]/.test(l)) || lines.some((l) => /✔\s*Submit/.test(l))

  const headerLine = lines.find((l) => /[☐☒]/.test(l))
  const header = headerLine
    ? headerLine
        .slice(headerLine.search(/[☐☒]/) + 1)
        .replace(/✔\s*Submit.*$/, '')
        .replace(/→.*$/, '')
        .replace(/[☐☒]/g, '')
        .trim() || undefined
    : undefined

  const options: { label: string; description?: string }[] = []
  const questionParts: string[] = []
  let lastOpt: { label: string; description?: string } | null = null
  let seenOption = false
  const startIdx = headerLine ? lines.indexOf(headerLine) + 1 : 0

  for (let i = startIdx; i < footerIdx; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line || PICKER_RULE_RE.test(line)) continue
    const m = raw.match(PICKER_OPT_RE)
    if (m) {
      seenOption = true
      const label = m[2].trim()
      if (PICKER_AUTO_LABEL.test(label)) {
        lastOpt = null // skip auto option + its trailing description line
        continue
      }
      lastOpt = { label }
      options.push(lastOpt)
    } else if (!seenOption) {
      questionParts.push(line)
    } else if (lastOpt && !lastOpt.description && line !== 'Submit') {
      lastOpt.description = line
    }
  }

  if (options.length === 0) return null
  return { question: questionParts.join(' ').trim(), header, multiSelect, options }
}

// derive the tmux key sequence for an answer, per the empirically-probed TUI:
// single-select → the option's number selects AND auto-submits; multiSelect →
// toggle each number, Right to the Submit tab, Enter to confirm.
function answerKeys(question: AskQuestion, optionIndexes: number[]): TmuxKey[] | null {
  const n = question.options.length
  if (new Set(optionIndexes).size !== optionIndexes.length) return null
  for (const oi of optionIndexes) if (oi < 0 || oi >= n || oi + 1 > 9) return null
  const digits = optionIndexes.map((oi) => String(oi + 1) as TmuxKey)
  if (!question.multiSelect) return optionIndexes.length === 1 ? [digits[0]] : null
  return [...digits, 'Right', 'Enter']
}

async function handleQuestion(id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ question: null, error: 'invalid session id' }, 400)
  const { sessions, targets } = await loadSessions()
  // the picker parser reads claude's tui — other agents never have one
  const session = sessions.find((s) => s.id === id)
  if (!session || session.provider !== 'claude') return json({ question: null })
  const target = targets.get(id)
  if (!target) return json({ question: null })
  const pane = await capturePane(target)
  return json({ question: parsePicker(pane) })
}

async function handleAnswer(id: string, req: Request): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'invalid session id' }, 400)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const optionIndexes = (body as { optionIndexes?: unknown } | null)?.optionIndexes
  if (
    !Array.isArray(optionIndexes) ||
    optionIndexes.length === 0 ||
    !optionIndexes.every((o) => Number.isInteger(o) && o >= 0)
  ) {
    return json({ ok: false, error: 'optionIndexes required' }, 400)
  }

  const { sessions, targets } = await loadSessions()
  const session = sessions.find((s) => s.id === id)
  if (session && session.provider !== 'claude') {
    return json({ ok: false, error: 'answering not supported for this agent' }, 409)
  }
  const target = targets.get(id)
  if (!target) return json({ ok: false, error: 'session not active' }, 409)

  // re-detect the picker at answer time — guards against injecting digits when
  // no picker is up (which would corrupt the prompt) and drives multiSelect vs
  // single-select from the live state.
  const question = parsePicker(await capturePane(target))
  if (!question) return json({ ok: false, error: 'no pending question' }, 409)
  const keys = answerKeys(question, optionIndexes as number[])
  if (!keys) return json({ ok: false, error: 'invalid option selection' }, 400)
  try {
    await sendKeys(target, keys)
    return json({ ok: true })
  } catch (err) {
    return json({ ok: false, error: String((err as Error).message ?? err) }, 500)
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  if (!existsSync(DIST)) {
    return new Response('porthole — run `bun run build` to create ./dist', {
      headers: { 'content-type': 'text/plain' },
    })
  }
  const rel = pathname === '/' ? '/index.html' : pathname
  const target = safeJoin(DIST, rel)
  if (target) {
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file)
  }
  // a missing hashed asset is a hard 404 — the spa fallback would hand html
  // to a module script (and poison caches) after a deploy rolls the hashes
  if (pathname.startsWith('/assets/')) {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  // spa fallback
  const index = Bun.file(resolve(DIST, 'index.html'))
  if (await index.exists()) return new Response(index)
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

// csrf/dns-rebinding guard: same-origin + json content-type on writes,
// optional Host allowlist (no auth by design — tailscale is the perimeter,
// but the phone's browser lives inside it, so block cross-site posts)
function crossSiteBlock(req: Request): Response | null {
  const host = (req.headers.get('host') ?? '').toLowerCase()
  if (config.allowedHosts.length && !config.allowedHosts.includes(host)) {
    return json({ error: 'host not allowed' }, 403)
  }
  if (req.method === 'GET' || req.method === 'HEAD') return null
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host) return json({ error: 'bad origin' }, 403)
    } catch {
      return json({ error: 'bad origin' }, 403)
    }
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return json({ error: 'content-type must be application/json' }, 415)
  }
  return null
}

// route table — thin dispatch, domain logic lives in the modules
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  const blocked = crossSiteBlock(req)
  if (blocked) return blocked

  if (pathname === '/api/sessions' && req.method === 'GET') return handleSessions()
  if (pathname === '/api/panes' && req.method === 'GET') return handlePanes()
  if (pathname === '/api/projects' && req.method === 'GET') return handleProjects()
  if (pathname === '/api/dirs' && req.method === 'GET') return handleDirs(url.searchParams.get('path') ?? '')
  if (pathname === '/api/launch' && req.method === 'POST') return handleLaunch(req)
  if (pathname === '/api/nudge' && req.method === 'POST') return handleNudge(req)

  const m = pathname.match(/^\/api\/sessions\/([^/]+)\/(stream|send|resume|close|answer|question)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    const action = m[2]
    if (action === 'stream' && req.method === 'GET') return handleStream(id, req)
    if (action === 'send' && req.method === 'POST') return handleSend(id, req)
    if (action === 'resume' && req.method === 'POST') return handleResume(id)
    if (action === 'close' && req.method === 'POST') return handleClose(id)
    if (action === 'answer' && req.method === 'POST') return handleAnswer(id, req)
    if (action === 'question' && req.method === 'GET') return handleQuestion(id)
    return json({ error: 'method not allowed' }, 405)
  }

  if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)

  if (req.method === 'GET') return serveStatic(pathname)
  return json({ error: 'not found' }, 404)
}

export function startServer() {
  Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 120, // default 10s would kill sse streams between 15s heartbeats
    async fetch(req) {
      try {
        return await route(req)
      } catch (err) {
        console.error('unhandled route error', err)
        return json({ error: 'internal error' }, 500)
      }
    },
  })
  console.log(`porthole listening on ${config.host}:${config.port}`)
}
