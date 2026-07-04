import type {
  AssistantTextEvent,
  ThinkingEvent,
  ToolResultEvent,
  ToolUseEvent,
  TranscriptEvent,
  UserMessageEvent,
} from '../../../shared/types'

// flattened transcript events, folded into renderable blocks: tool_use + its
// matching tool_result (paired by toolId) collapse into a single block
export type DisplayItem =
  | { kind: 'assistant_text'; key: string; event: AssistantTextEvent }
  | { kind: 'thinking'; key: string; event: ThinkingEvent }
  | { kind: 'user_message'; key: string; event: UserMessageEvent }
  | { kind: 'tool_pair'; key: string; toolId: string; use?: ToolUseEvent; result?: ToolResultEvent }

export function groupEvents(events: TranscriptEvent[]): DisplayItem[] {
  const items: DisplayItem[] = []
  const toolPairIndex = new Map<string, number>()

  for (const event of events) {
    if (event.kind === 'tool_use') {
      toolPairIndex.set(event.toolId, items.length)
      items.push({ kind: 'tool_pair', key: event.uuid, toolId: event.toolId, use: event })
      continue
    }
    if (event.kind === 'tool_result') {
      const idx = toolPairIndex.get(event.toolId)
      if (idx !== undefined) {
        const existing = items[idx]
        if (existing.kind === 'tool_pair') items[idx] = { ...existing, result: event }
        continue
      }
      // result arrived with no matching use in this window — render standalone
      toolPairIndex.set(event.toolId, items.length)
      items.push({ kind: 'tool_pair', key: event.uuid, toolId: event.toolId, result: event })
      continue
    }
    items.push({ kind: event.kind, key: event.uuid, event } as DisplayItem)
  }

  return items
}
