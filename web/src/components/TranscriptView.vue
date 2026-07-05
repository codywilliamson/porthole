<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AskQuestion, PendingQuestionResponse, TranscriptEvent } from '../../../shared/types'
import { useAutoScroll } from '../composables/useAutoScroll'
import { useRoute } from '../composables/useRoute'
import { groupEvents } from '../utils/transcript'
import EventBlock from './EventBlock.vue'
import QuestionCard from './QuestionCard.vue'

const props = defineProps<{ events: TranscriptEvent[] }>()

// a live AskUserQuestion picker is never in the jsonl (claude buffers it), so we
// poll the pane for it here — the parent SessionView chain is owned elsewhere.
// sessionId comes from the route rather than a prop for the same reason.
const QUESTION_POLL_MS = 2500
const { route } = useRoute()
const sessionId = computed(() => (route.value.name === 'session' ? route.value.id : ''))
const pendingQuestion = ref<AskQuestion | null>(null)
let questionTimer: ReturnType<typeof setInterval> | undefined

async function pollQuestion() {
  const id = sessionId.value
  if (!id) return
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/question`)
    if (!res.ok) return
    const data = (await res.json()) as PendingQuestionResponse
    pendingQuestion.value = data.question
  } catch {
    // transient — keep the last state, next tick retries
  }
}

const scroller = ref<HTMLElement | null>(null)
const { hasNewBelow, checkNearBottom, scrollToBottom, onContentGrew } = useAutoScroll(scroller)

// window the render to the most recent items — 500+ event sessions jank the
// phone if every markdown block paints at once. the window slides with new
// events and expands on demand.
const INITIAL_WINDOW = 75
const EXPAND_STEP = 150

const items = computed(() => groupEvents(props.events))
const shown = ref(0)
const suppressEnter = ref(false)

const visibleItems = computed(() => {
  const all = items.value
  return all.length <= shown.value ? all : all.slice(all.length - shown.value)
})
const hiddenCount = computed(() => Math.max(0, items.value.length - shown.value))

// keep the shown-window boundary stable as items change: first fill windows to
// the tail; later appends grow the window so already-shown rows never drop; a
// shrink (session switch / reset) re-windows to the tail.
watch(
  () => items.value.length,
  (len, prev) => {
    const p = prev ?? 0
    if (p === 0 || len < p) shown.value = Math.min(len, INITIAL_WINDOW)
    else if (len > p) shown.value = Math.min(len, shown.value + (len - p))
  },
  { immediate: true },
)

// auto-scroll follows new events (also fires when a tool_result merges into an
// existing item, growing its height without adding a row)
watch(
  () => props.events.length,
  (len, prevLen) => {
    if (len > (prevLen ?? 0)) onContentGrew()
  },
)

// reveal older items, preserving the reading position: measure before, restore after
async function showEarlier() {
  const el = scroller.value
  const prevHeight = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  suppressEnter.value = true
  shown.value = Math.min(items.value.length, shown.value + EXPAND_STEP)
  await nextTick()
  if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
  requestAnimationFrame(() => (suppressEnter.value = false))
}

// a freshly-appeared question card grows the content — follow it if pinned
watch(pendingQuestion, (q, prev) => {
  if (q && !prev) onContentGrew()
})

onMounted(() => {
  scrollToBottom(false)
  pollQuestion()
  questionTimer = setInterval(pollQuestion, QUESTION_POLL_MS)
})

onUnmounted(() => {
  if (questionTimer) clearInterval(questionTimer)
})
</script>

<template>
  <div class="transcript-view">
    <div ref="scroller" class="transcript-scroller" @scroll="checkNearBottom">
      <p v-if="items.length === 0" class="transcript-empty">no transcript yet — waiting for events…</p>
      <template v-else>
        <button v-if="hiddenCount > 0" class="show-earlier mono" type="button" @click="showEarlier">
          show earlier ({{ hiddenCount }})
        </button>
        <TransitionGroup name="ev" tag="div" class="transcript-items" :class="{ 'no-enter-anim': suppressEnter }">
          <EventBlock v-for="it in visibleItems" :key="it.key" :item="it" />
        </TransitionGroup>
      </template>
      <QuestionCard
        v-if="pendingQuestion && sessionId"
        :key="`${pendingQuestion.header ?? ''}|${pendingQuestion.question}`"
        class="transcript-question"
        :session-id="sessionId"
        :question="pendingQuestion"
      />
    </div>

    <Transition name="pill">
      <button v-if="hasNewBelow" class="jump-pill mono" type="button" @click="scrollToBottom(true)">
        new events ↓
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.transcript-view {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.transcript-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: clip; /* wide content scrolls inside pre/table wrappers, never the transcript */
  -webkit-overflow-scrolling: touch;
  padding: var(--space-4);
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
}

.transcript-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.transcript-question {
  margin-top: var(--space-4);
}

/* pinned at the top of the scroller — reveals windowed-out history */
.show-earlier {
  position: sticky;
  top: 0;
  z-index: 1;
  display: block;
  margin: 0 auto var(--space-4);
  padding: 7px 16px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  background: var(--glass-strong);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--ink-2);
  font-size: var(--text-xs);
  cursor: pointer;
}

/* bulk prepend from "show earlier" should appear instantly, not mass-fade */
.no-enter-anim :deep(.ev-enter-active) {
  transition: none;
}

.transcript-empty {
  text-align: center;
  color: var(--ink-3);
  padding: var(--space-6) var(--space-3);
  font-size: var(--text-sm);
}

.jump-pill {
  position: absolute;
  left: 50%;
  bottom: var(--space-4);
  transform: translateX(-50%);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  padding: 9px 18px;
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}

.ev-move,
.ev-enter-active {
  transition: all 0.25s var(--ease-out);
}

.ev-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.pill-enter-active,
.pill-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.pill-enter-from,
.pill-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (prefers-reduced-motion: reduce) {
  .ev-move,
  .ev-enter-active,
  .pill-enter-active,
  .pill-leave-active {
    transition: opacity 0.15s ease;
  }
}
</style>
