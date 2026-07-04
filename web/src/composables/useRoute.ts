import { onMounted, onUnmounted, ref } from 'vue'

// manual hash routing — no vue-router. '#/' = session list, '#/session/<id>' = transcript
export type Route = { name: 'list' } | { name: 'session'; id: string }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash.startsWith('session/')) {
    const id = decodeURIComponent(hash.slice('session/'.length))
    if (id) return { name: 'session', id }
  }
  return { name: 'list' }
}

const route = ref<Route>(parseHash())
let listenerCount = 0

function handleHashChange() {
  route.value = parseHash()
}

export function useRoute() {
  onMounted(() => {
    if (listenerCount === 0) window.addEventListener('hashchange', handleHashChange)
    listenerCount++
  })
  onUnmounted(() => {
    listenerCount--
    if (listenerCount === 0) window.removeEventListener('hashchange', handleHashChange)
  })
  return { route }
}

export function goToList() {
  window.location.hash = '#/'
}

export function goToSession(id: string) {
  window.location.hash = `#/session/${encodeURIComponent(id)}`
}
