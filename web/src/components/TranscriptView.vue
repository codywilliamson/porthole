<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { TranscriptEvent } from '../../../shared/types'
import { useAutoScroll } from '../composables/useAutoScroll'
import { groupEvents } from '../utils/transcript'
import EventBlock from './EventBlock.vue'

const props = defineProps<{ events: TranscriptEvent[] }>()

const scroller = ref<HTMLElement | null>(null)
const { hasNewBelow, checkNearBottom, scrollToBottom, onContentGrew } = useAutoScroll(scroller)

const items = computed(() => groupEvents(props.events))

watch(
  () => props.events.length,
  (len, prevLen) => {
    if (len > (prevLen ?? 0)) onContentGrew()
  },
)

onMounted(() => {
  scrollToBottom(false)
})
</script>

<template>
  <div class="transcript-view">
    <div ref="scroller" class="transcript-scroller" @scroll="checkNearBottom">
      <p v-if="items.length === 0" class="transcript-empty">no transcript yet — waiting for events…</p>
      <TransitionGroup v-else name="ev" tag="div" class="transcript-items">
        <EventBlock v-for="it in items" :key="it.key" :item="it" />
      </TransitionGroup>
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
