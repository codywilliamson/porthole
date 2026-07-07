import { onUnmounted, ref } from 'vue'
import type { SessionSummary, TranscriptEvent } from '../../../shared/types'

// 'gone' = the stream failed permanently (404 session not found / removed) —
// EventSource won't retry, so we surface a dead-end state instead of a
// forever-"reconnecting" banner.
export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'gone'

interface InitPayload {
  session: SessionSummary
  events: TranscriptEvent[]
}

interface StatusPayload {
  active: boolean
  tmuxTarget: string | null
}

// owns the EventSource lifecycle for one session id — mount a fresh instance
// per session (key the consuming component on the id) so teardown is automatic
export function useSessionStream(sessionId: string) {
  const events = ref<TranscriptEvent[]>([])
  const session = ref<SessionSummary | null>(null)
  const active = ref(false)
  const tmuxTarget = ref<string | null>(null)
  const status = ref<StreamStatus>('connecting')

  const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`)

  function applySession(next: SessionSummary) {
    session.value = next
    active.value = next.active
    tmuxTarget.value = next.tmuxTarget
  }

  source.addEventListener('init', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as InitPayload
    applySession(data.session)
    events.value = data.events
    status.value = 'live'
  })

  source.addEventListener('events', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as TranscriptEvent[]
    events.value = [...events.value, ...data]
    status.value = 'live'
  })

  source.addEventListener('reset', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as InitPayload
    applySession(data.session)
    events.value = data.events
  })

  source.addEventListener('status', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as StatusPayload
    active.value = data.active
    tmuxTarget.value = data.tmuxTarget
  })

  source.onopen = () => {
    status.value = 'live'
  }
  source.onerror = () => {
    // CLOSED = browser gave up (non-2xx like a 404); CONNECTING = it'll retry
    status.value = source.readyState === EventSource.CLOSED ? 'gone' : 'reconnecting'
  }

  onUnmounted(() => {
    source.close()
  })

  return { events, session, active, tmuxTarget, status }
}
