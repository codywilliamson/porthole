import { onMounted, onUnmounted, ref } from 'vue'
import type { SessionSummary } from '../../../shared/types'

const POLL_MS = 5000

// module-scope singleton: returning to the list reuses the last data instantly
// (stale-while-revalidate — render cached, refresh in background). loading is
// only true before the first-ever fetch resolves.
const sessions = ref<SessionSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let hasLoaded = false
let mountCount = 0
let timer: ReturnType<typeof setInterval> | undefined

// first-ever list mount runs the entrance stagger; back-navigation renders instantly
export const listAnimated = ref(false)

async function refresh() {
  try {
    const res = await fetch('/api/sessions')
    if (!res.ok) throw new Error(`request failed (${res.status})`)
    sessions.value = (await res.json()) as SessionSummary[]
    error.value = null
    hasLoaded = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'failed to load sessions'
  } finally {
    loading.value = false
  }
}

export function useSessions() {
  onMounted(() => {
    // cached data shows immediately; spinner only on the very first mount
    loading.value = !hasLoaded
    refresh()
    if (mountCount === 0) timer = setInterval(refresh, POLL_MS)
    mountCount++
  })
  onUnmounted(() => {
    mountCount--
    if (mountCount === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  })

  return { sessions, loading, error, refresh }
}
