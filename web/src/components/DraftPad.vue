<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDraft } from '../composables/useDraft'
import { nudge } from '../composables/useLauncher'
import type { TranscriptEvent } from '../../../shared/types'

const props = defineProps<{
  sessionId: string
  active: boolean
  tmuxTarget: string | null
  events: TranscriptEvent[]
}>()

const { draft, pending, markSent, confirmSent, restorePending } = useDraft(props.sessionId)

// how long a sent message may go unseen before we call it out as probably misrouted
const CONFIRM_GRACE_MS = 25_000
const overdue = ref(false)
let overdueTimer: ReturnType<typeof setTimeout> | undefined

function startOverdueWatch() {
  clearTimeout(overdueTimer)
  overdue.value = false
  if (!pending.value) return
  overdueTimer = setTimeout(() => (overdue.value = true), CONFIRM_GRACE_MS)
}

// whitespace-insensitive: the tui reflows a paste, the jsonl keeps the text verbatim
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

watch(
  () => props.events,
  (events) => {
    if (!pending.value) return
    const needle = norm(pending.value)
    if (!needle) return confirmSent()
    const seen = events.some((e) => e.kind === 'user_message' && norm(e.text).includes(needle))
    if (seen) {
      confirmSent()
      clearTimeout(overdueTimer)
      overdue.value = false
    }
  },
  { deep: false, immediate: true },
)

onMounted(startOverdueWatch)
onUnmounted(() => clearTimeout(overdueTimer))

const textareaEl = ref<HTMLTextAreaElement | null>(null)
const sending = ref(false)
const resuming = ref(false)
const copied = ref(false)
const errorMsg = ref<string | null>(null)
let errorTimer: ReturnType<typeof setTimeout> | undefined

// shared error flash: set the message, clear any prior pending clear, then auto-clear
function flashError(msg: string) {
  errorMsg.value = msg
  clearTimeout(errorTimer)
  errorTimer = setTimeout(() => (errorMsg.value = null), 2200)
}

function autoGrow() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`
}

watch(draft, () => nextTick(autoGrow))
onMounted(autoGrow)

async function copy() {
  try {
    await navigator.clipboard.writeText(draft.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    flashError('copy failed — clipboard unavailable')
  }
}

async function send() {
  if (!draft.value.trim() || sending.value) return
  sending.value = true
  errorMsg.value = null
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: draft.value }),
    })
    if (res.status === 409) {
      flashError('session inactive')
      return
    }
    if (!res.ok) throw new Error(`send failed (${res.status})`)
    // held, not dropped — cleared once the transcript echoes it back
    markSent()
    startOverdueWatch()
  } catch (err) {
    flashError(err instanceof Error ? err.message : 'send failed')
  } finally {
    sending.value = false
  }
}

// one-tap interrupt — Escape stops a running agent (safe when idle)
const stopped = ref(false)
async function stop() {
  if (!props.tmuxTarget) return
  try {
    await nudge(props.tmuxTarget, 'escape')
    stopped.value = true
    setTimeout(() => (stopped.value = false), 1600)
  } catch (err) {
    flashError(err instanceof Error ? err.message : 'stop failed')
  }
}

async function resume() {
  if (resuming.value) return
  resuming.value = true
  errorMsg.value = null
  try {
    // content-type required or the cross-site guard rejects it with 415
    const res = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (res.status === 409) {
      flashError('already active')
      return
    }
    if (!res.ok) throw new Error(`resume failed (${res.status})`)
  } catch (err) {
    flashError(err instanceof Error ? err.message : 'resume failed')
  } finally {
    resuming.value = false
  }
}
</script>

<template>
  <div class="draft-pad">
    <p v-if="errorMsg" class="draft-error">{{ errorMsg }}</p>
    <div v-if="pending" class="draft-pending" :class="{ 'draft-pending-overdue': overdue }">
      <p class="draft-pending-text mono">{{ pending }}</p>
      <p class="draft-pending-note">
        {{ overdue ? 'not seen in this session yet — it may have gone elsewhere' : 'sent · waiting for it to appear' }}
      </p>
      <button class="draft-pending-restore" type="button" @click="restorePending">
        put it back in the box
      </button>
    </div>
    <textarea
      ref="textareaEl"
      v-model="draft"
      class="draft-textarea mono"
      rows="1"
      placeholder="reply into the tmux pane…"
      @input="autoGrow"
    ></textarea>
    <div class="draft-actions">
      <button
        v-if="active && tmuxTarget"
        class="draft-btn draft-btn-stop"
        type="button"
        aria-label="stop — interrupt the agent"
        @click="stop"
      >
        <svg class="draft-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1.5" stroke-linejoin="round" />
        </svg>
        {{ stopped ? 'sent' : 'stop' }}
      </button>
      <button class="draft-btn draft-btn-ghost" type="button" :disabled="!draft" @click="copy">
        {{ copied ? 'copied' : 'copy' }}
      </button>
      <button
        v-if="active"
        class="draft-btn draft-btn-primary"
        type="button"
        :disabled="!draft.trim() || sending"
        @click="send"
      >
        <svg
          v-if="!sending"
          class="draft-btn-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ sending ? 'sending…' : 'send' }}
      </button>
      <button v-else class="draft-btn draft-btn-primary" type="button" :disabled="resuming" @click="resume">
        {{ resuming ? 'resuming…' : 'resume session' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.draft-pad {
  border-top: 1px solid var(--line);
  background: var(--glass-strong);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: var(--space-3) var(--space-4) calc(var(--space-3) + var(--safe-bottom));
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.draft-error {
  color: var(--danger);
  font-size: var(--text-xs);
}

/* a sent-but-unconfirmed message: visible and recoverable, never silently dropped */
.draft-pending {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-left: 2px solid var(--accent-line);
  border-radius: var(--radius-md);
  background: var(--bg-1);
}

.draft-pending-overdue {
  border-left-color: var(--danger);
}

.draft-pending-text {
  font-size: var(--text-xs);
  color: var(--ink-2);
  line-height: 1.5;
  max-height: 4.5em;
  overflow: hidden;
}

.draft-pending-note {
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.draft-pending-overdue .draft-pending-note {
  color: var(--danger);
}

.draft-pending-restore {
  align-self: flex-start;
  min-height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg-2);
  color: var(--ink-1);
  font-size: var(--text-xs);
  cursor: pointer;
}

.draft-textarea {
  width: 100%;
  resize: none;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  color: var(--ink-1);
  font-size: var(--text-md);
  line-height: 1.5;
  max-height: 240px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.draft-textarea:focus {
  outline: none;
  border-color: var(--accent-line);
}

.draft-textarea::placeholder {
  color: var(--ink-3);
  font-family: var(--font-sans);
}

.draft-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* stop sits alone on the left — the rescue action, away from send */
.draft-btn-stop {
  margin-right: auto;
  background: var(--danger-dim);
  border-color: var(--danger-line);
  color: var(--danger);
}

.draft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  border: 1px solid var(--line);
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.draft-btn-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.draft-btn:active {
  transform: scale(0.97);
}

.draft-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.draft-btn-ghost {
  background: var(--glass);
  color: var(--ink-2);
}

.draft-btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: transparent;
}
</style>
