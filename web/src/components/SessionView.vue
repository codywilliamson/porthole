<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStream } from '../composables/useSessionStream'
import { goToList } from '../composables/useRoute'
import { truncateMiddle } from '../utils/format'
import TranscriptView from './TranscriptView.vue'
import DraftPad from './DraftPad.vue'

const props = defineProps<{ sessionId: string }>()

const { events, session, active, tmuxTarget, status } = useSessionStream(props.sessionId)

const title = computed(() => session.value?.title || 'session')
const projectPath = computed(() => (session.value ? truncateMiddle(session.value.projectPath, 40) : ''))
</script>

<template>
  <div class="session-view">
    <header class="sv-header">
      <button class="sv-back" type="button" aria-label="back to sessions" @click="goToList()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="sv-heading">
        <h1 class="sv-title mono">{{ title }}</h1>
        <p v-if="projectPath" class="sv-path mono">{{ projectPath }}</p>
      </div>

      <div class="sv-status">
        <span v-if="active" class="sv-badge sv-badge-active">
          <span class="sv-dot" aria-hidden="true"></span>
          <span v-if="tmuxTarget" class="mono">{{ tmuxTarget }}</span>
        </span>
        <span v-else class="sv-badge sv-badge-idle">inactive</span>
      </div>
    </header>

    <p v-if="status === 'connecting' && events.length === 0" class="sv-stream-banner">connecting…</p>
    <p v-else-if="status === 'reconnecting'" class="sv-stream-banner sv-stream-banner-warn">
      reconnecting — feed dropped, retrying…
    </p>

    <div class="sv-body">
      <TranscriptView :events="events" />
    </div>

    <DraftPad :session-id="sessionId" :active="active" />
  </div>
</template>

<style scoped>
.session-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sv-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: calc(var(--space-3) + var(--safe-top)) var(--space-4) var(--space-3);
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
  border-bottom: 1px solid var(--line);
  background: var(--glass-strong);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.sv-back {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--glass);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-2);
}

.sv-back svg {
  width: 18px;
  height: 18px;
}

.sv-heading {
  flex: 1;
  min-width: 0;
}

.sv-title {
  font-size: var(--text-md);
  color: var(--ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-path {
  font-size: var(--text-xs);
  color: var(--ink-3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sv-status {
  flex: 0 0 auto;
}

.sv-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  white-space: nowrap;
}

.sv-badge-active {
  border-color: var(--accent-line);
  color: var(--accent-strong);
  background: var(--accent-dim);
}

.sv-badge-idle {
  color: var(--ink-3);
  background: var(--bg-2);
}

.sv-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: sv-pulse 2.2s ease-in-out infinite;
}

@keyframes sv-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 180, 84, 0.55);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(255, 180, 84, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 180, 84, 0);
  }
}

.sv-stream-banner {
  font-size: var(--text-xs);
  text-align: center;
  padding: var(--space-2);
  color: var(--ink-3);
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
}

.sv-stream-banner-warn {
  color: var(--accent-strong);
}

.sv-body {
  flex: 1;
  min-height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sv-dot {
    animation: none;
  }
}
</style>
