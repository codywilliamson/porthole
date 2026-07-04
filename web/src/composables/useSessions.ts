import { onMounted, onUnmounted, ref } from 'vue'
import type { SessionSummary } from '../../../shared/types'

const POLL_MS = 5000

export function useSessions() {
  const sessions = ref<SessionSummary[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh() {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) throw new Error(`request failed (${res.status})`)
      sessions.value = (await res.json()) as SessionSummary[]
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'failed to load sessions'
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    refresh()
    timer = setInterval(refresh, POLL_MS)
  })
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { sessions, loading, error, refresh }
}
