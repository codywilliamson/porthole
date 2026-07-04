import { ref, watch } from 'vue'

// draft text persisted to localStorage per session, so a reply survives
// navigating away and back before it's sent
export function useDraft(sessionId: string) {
  const key = `porthole:draft:${sessionId}`
  const draft = ref(localStorage.getItem(key) ?? '')

  watch(draft, (value) => {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  })

  function clear() {
    draft.value = ''
    localStorage.removeItem(key)
  }

  return { draft, clear }
}
