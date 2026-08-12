import { ref, watch } from 'vue'

// draft text persisted to localStorage per session, so a reply survives navigating
// away and back before it's sent.
//
// a successful POST only proves tmux accepted the keys — not that this session
// received them. so a sent draft moves to a `pending` slot and is only dropped once
// the text shows up in the transcript. nothing the user typed is ever discarded on
// the strength of a 200 alone.
export function useDraft(sessionId: string) {
  const key = `porthole:draft:${sessionId}`
  const pendingKey = `porthole:pending:${sessionId}`
  const draft = ref(localStorage.getItem(key) ?? '')
  const pending = ref(localStorage.getItem(pendingKey) ?? '')

  const persist = (storeKey: string) => (value: string) => {
    if (value) localStorage.setItem(storeKey, value)
    else localStorage.removeItem(storeKey)
  }
  watch(draft, persist(key))
  watch(pending, persist(pendingKey))

  // sent to the pane, not yet observed coming back
  function markSent() {
    pending.value = draft.value
    draft.value = ''
  }

  // seen in the transcript — it really landed here
  function confirmSent() {
    pending.value = ''
  }

  // put an unconfirmed message back in the box to resend or edit
  function restorePending() {
    draft.value = draft.value ? `${pending.value}\n${draft.value}` : pending.value
    pending.value = ''
  }

  return { draft, pending, markSent, confirmSent, restorePending }
}
