// api contract between backend and frontend — single source of truth

export interface SessionSummary {
  id: string // session uuid (jsonl basename)
  title: string // ai-title event if present, else first real user message truncated
  projectPath: string // real cwd from events, not decoded dir name
  projectDir: string // ~/.claude/projects/<encoded> dir holding the jsonl
  lastModified: number // epoch ms
  eventCount: number
  active: boolean
  tmuxTarget: string | null // session:window.pane when active
}

// transcript events, folded from raw jsonl lines
export type TranscriptEvent =
  | AssistantTextEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | UserMessageEvent

export interface AssistantTextEvent {
  kind: 'assistant_text'
  uuid: string
  timestamp: string
  text: string // markdown
}

export interface ThinkingEvent {
  kind: 'thinking'
  uuid: string
  timestamp: string
  text: string
}

export interface ToolUseEvent {
  kind: 'tool_use'
  uuid: string
  timestamp: string
  toolId: string
  name: string
  input: unknown
}

export interface ToolResultEvent {
  kind: 'tool_result'
  uuid: string
  timestamp: string
  toolId: string
  text: string
  isError: boolean
}

export interface UserMessageEvent {
  kind: 'user_message'
  uuid: string
  timestamp: string
  text: string
}

export interface SendRequest {
  text: string
}

export interface ResumeResponse {
  ok: boolean
  error?: string
}

// --- launcher ---

export interface KnownProject {
  path: string
  lastUsed: number // epoch ms, most-recently-used first
}

export interface ProjectsResponse {
  root: string // config.rootDir
  known: KnownProject[]
}

export interface DirsResponse {
  path: string // resolved absolute path of the browsed dir
  dirs: string[] // immediate subdir names, sorted
}

export interface LaunchRequest {
  dir: string // absolute path, must be launchable
}

export interface LaunchResponse {
  ok: boolean
  target?: string // new pane target when ok
  error?: string
}

export type NudgeKey = 'enter' | 'escape'

export interface NudgeRequest {
  target: string
  key: NudgeKey
}
