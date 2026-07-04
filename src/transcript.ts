// session discovery + jsonl parsing — no tmux/process knowledge here
import type { SessionSummary, TranscriptEvent } from '../shared/types'

export interface DiscoveredSession extends Omit<SessionSummary, 'active' | 'tmuxTarget'> {
  filePath: string
}

// list all sessions across all project dirs, newest first
// excludes <uuid>/subagents/*.jsonl
export async function discoverSessions(projectsDir: string): Promise<DiscoveredSession[]> {
  throw new Error('not implemented')
}

// parse a whole session file to renderable events
export async function parseTranscriptFile(filePath: string): Promise<TranscriptEvent[]> {
  throw new Error('not implemented')
}

// parse one raw jsonl line; a line can yield 0..n events
// (assistant messages hold multiple content blocks)
export function parseLine(line: string): TranscriptEvent[] {
  throw new Error('not implemented')
}
