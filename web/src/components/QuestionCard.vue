<script setup lang="ts">
import { ref } from 'vue'
import type { AskQuestion } from '../../../shared/types'

// the live AskUserQuestion picker, detected by polling the tmux pane (it never
// reaches the jsonl while pending). answering injects keys into the pane; the
// answered tool_use + result then land in the transcript via the normal SSE flow.
const props = defineProps<{ sessionId: string; question: AskQuestion }>()

const selected = ref<Set<number>>(new Set())
const sending = ref(false)
const submitted = ref(false)
const errorMsg = ref<string | null>(null)

function toggle(i: number) {
  if (sending.value || submitted.value) return
  const next = new Set(selected.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  selected.value = next
}

async function submit(optionIndexes: number[]) {
  if (sending.value || submitted.value || optionIndexes.length === 0) return
  sending.value = true
  errorMsg.value = null
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionIndexes }),
    })
    if (res.status === 409) {
      errorMsg.value = 'session no longer waiting'
      return
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(data?.error ?? `answer failed (${res.status})`)
    }
    // lock the card; the parent poll drops it once the picker clears
    submitted.value = true
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'answer failed'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="qc">
    <div class="qc-head">
      <span class="qc-chip">question</span>
      <span v-if="question.header" class="qc-header-label mono">{{ question.header }}</span>
    </div>

    <p class="qc-question">{{ question.question }}</p>

    <div class="qc-options">
      <template v-if="question.multiSelect">
        <button
          v-for="(opt, i) in question.options"
          :key="i"
          type="button"
          class="qc-opt"
          :class="{ 'is-selected': selected.has(i) }"
          :disabled="sending || submitted"
          @click="toggle(i)"
        >
          <span class="qc-check" aria-hidden="true">{{ selected.has(i) ? '☑' : '☐' }}</span>
          <span class="qc-opt-text">
            <span class="qc-opt-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="qc-opt-desc">{{ opt.description }}</span>
          </span>
        </button>
      </template>
      <template v-else>
        <button
          v-for="(opt, i) in question.options"
          :key="i"
          type="button"
          class="qc-opt"
          :disabled="sending || submitted"
          @click="submit([i])"
        >
          <span class="qc-opt-text">
            <span class="qc-opt-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="qc-opt-desc">{{ opt.description }}</span>
          </span>
        </button>
      </template>
    </div>

    <button
      v-if="question.multiSelect"
      type="button"
      class="qc-submit"
      :disabled="sending || submitted || selected.size === 0"
      @click="submit([...selected])"
    >
      {{ sending || submitted ? 'submitting…' : `submit (${selected.size})` }}
    </button>
    <p v-else-if="sending || submitted" class="qc-status">submitting…</p>
    <p v-if="errorMsg" class="qc-error">{{ errorMsg }}</p>
  </div>
</template>

<style scoped>
.qc {
  border: 1px solid var(--accent-line);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--glass);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.qc-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.qc-chip {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  color: var(--accent-strong);
  background: var(--accent-dim);
  border: 1px solid var(--accent-line);
}

.qc-header-label {
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.qc-question {
  font-size: var(--text-base);
  color: var(--ink-1);
  line-height: 1.5;
  margin: 0;
}

.qc-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.qc-opt {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
  padding: var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--bg-1);
  color: var(--ink-1);
  cursor: pointer;
  min-height: 44px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.12s ease;
}

.qc-opt:active {
  transform: scale(0.99);
}

.qc-opt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.qc-opt.is-selected {
  border-color: var(--accent-line);
  background: var(--accent-dim);
}

.qc-check {
  flex: 0 0 auto;
  color: var(--accent-strong);
  font-size: 1.05em;
  line-height: 1.3;
}

.qc-opt-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.qc-opt-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink-1);
}

.qc-opt-desc {
  font-size: var(--text-xs);
  color: var(--ink-3);
  line-height: 1.4;
}

.qc-submit {
  align-self: flex-end;
  min-height: 44px;
  padding: 0 20px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.qc-submit:active {
  transform: scale(0.97);
}

.qc-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.qc-status {
  font-size: var(--text-xs);
  color: var(--ink-3);
  margin: 0;
  text-align: right;
}

.qc-error {
  font-size: var(--text-xs);
  color: var(--danger);
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .qc-opt,
  .qc-submit {
    transition: none;
  }
}
</style>
