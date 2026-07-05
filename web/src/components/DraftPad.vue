<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useDraft } from '../composables/useDraft'

const props = defineProps<{ sessionId: string; active: boolean }>()

const { draft, clear } = useDraft(props.sessionId)

const textareaEl = ref<HTMLTextAreaElement | null>(null)
const sending = ref(false)
const resuming = ref(false)
const copied = ref(false)
const errorMsg = ref<string | null>(null)

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
    errorMsg.value = 'copy failed — clipboard unavailable'
    setTimeout(() => (errorMsg.value = null), 2200)
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
      errorMsg.value = 'session inactive'
      return
    }
    if (!res.ok) throw new Error(`send failed (${res.status})`)
    clear()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'send failed'
  } finally {
    sending.value = false
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
      errorMsg.value = 'already active'
      return
    }
    if (!res.ok) throw new Error(`resume failed (${res.status})`)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'resume failed'
  } finally {
    resuming.value = false
  }
}
</script>

<template>
  <div class="draft-pad">
    <p v-if="errorMsg" class="draft-error">{{ errorMsg }}</p>
    <textarea
      ref="textareaEl"
      v-model="draft"
      class="draft-textarea mono"
      rows="1"
      placeholder="reply into the tmux pane…"
      @input="autoGrow"
    ></textarea>
    <div class="draft-actions">
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

.draft-textarea {
  width: 100%;
  resize: none;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  color: var(--ink-1);
  font-size: var(--text-sm);
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

.draft-btn {
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  border: 1px solid var(--line);
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
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
