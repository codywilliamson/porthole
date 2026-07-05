import { onMounted, onUnmounted, ref } from 'vue'
import type { PaneInfo, PanesResponse } from '../../../shared/types'

const POLL_MS = 3000

// tmux pane overview — polled only while the tmux view is mounted
export function usePanes() {
  const panes = ref<PaneInfo[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    try {
      const res = await fetch('/api/panes')
      if (!res.ok) throw new Error(`panes failed (${res.status})`)
      const data = (await res.json()) as PanesResponse
      panes.value = data.panes
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'failed to load panes'
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

  return { panes, loading, error, refresh }
}
