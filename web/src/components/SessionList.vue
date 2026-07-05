<script setup lang="ts">
import { computed } from 'vue'
import { useSessions, listAnimated } from '../composables/useSessions'
import { goToSession } from '../composables/useRoute'
import { relativeTime, truncateMiddle } from '../utils/format'

const { sessions, loading, error, refresh } = useSessions()

const activeSessions = computed(() => sessions.value.filter((s) => s.active))
const recentSessions = computed(() =>
  [...sessions.value].filter((s) => !s.active).sort((a, b) => b.lastModified - a.lastModified),
)

// stagger only the first screenful — with 100+ sessions an unbounded
// i * 45 delay leaves the tail invisible for seconds
const STAGGER_MS = 45
const STAGGER_CAP = 12
const enterDelay = (i: number) => Math.min(i, STAGGER_CAP) * STAGGER_MS

// entrance stagger runs once ever — back-navigation renders rows instantly
// with no re-stagger. after the first paint, flip the module flag.
const animate = !listAnimated.value
if (animate) requestAnimationFrame(() => (listAnimated.value = true))
const rowInitial = (i: number) => (animate ? { opacity: 0, y: 14 } : { opacity: 1, y: 0 })
const rowEnter = (i: number) =>
  animate
    ? { opacity: 1, y: 0, transition: { duration: 320, delay: enterDelay(i) } }
    : { opacity: 1, y: 0, transition: { duration: 0 } }
</script>

<template>
  <div class="session-list">
    <header class="sl-header">
      <div>
        <h1 class="sl-title">porthole</h1>
        <p class="sl-subtitle">{{ sessions.length }} session{{ sessions.length === 1 ? '' : 's' }} · claude code</p>
      </div>
      <button
        class="sl-refresh"
        :class="{ 'is-loading': loading }"
        type="button"
        aria-label="refresh sessions"
        @click="refresh"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path
            d="M4 12a8 8 0 0 1 14.5-4.6M20 12a8 8 0 0 1-14.5 4.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path d="M18 3v5h-5M6 21v-5h5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </header>

    <div class="sl-body">
      <p v-if="error" class="sl-state sl-state-error">reception lost — {{ error }}</p>
      <p v-else-if="loading && sessions.length === 0" class="sl-state">scanning for sessions…</p>
      <p v-else-if="sessions.length === 0" class="sl-state">
        no sessions yet.<br />start claude code in a tmux window to see it here.
      </p>

      <template v-else>
        <section v-if="activeSessions.length" class="sl-section">
          <h2 class="sl-section-label">active</h2>
          <TransitionGroup name="row" tag="div" class="sl-rows">
            <button
              v-for="(s, i) in activeSessions"
              :key="s.id"
              v-motion
              :initial="rowInitial(i)"
              :enter="rowEnter(i)"
              class="sl-row"
              type="button"
              @click="goToSession(s.id)"
            >
              <span class="sl-dot sl-dot-active" aria-hidden="true"></span>
              <span class="sl-row-main">
                <span class="sl-row-title">{{ s.title || 'untitled session' }}</span>
                <span class="sl-row-meta">
                  <span class="sl-path">{{ truncateMiddle(s.projectPath, 34) }}</span>
                  <span class="sl-dot-sep">·</span>
                  <span>{{ relativeTime(s.lastModified) }}</span>
                  <span class="sl-dot-sep">·</span>
                  <span>{{ s.eventCount }} events</span>
                </span>
              </span>
              <span v-if="s.tmuxTarget" class="sl-badge mono">{{ s.tmuxTarget }}</span>
            </button>
          </TransitionGroup>
        </section>

        <section v-if="recentSessions.length" class="sl-section">
          <h2 class="sl-section-label">recent</h2>
          <TransitionGroup name="row" tag="div" class="sl-rows">
            <button
              v-for="(s, i) in recentSessions"
              :key="s.id"
              v-motion
              :initial="rowInitial(activeSessions.length + i)"
              :enter="rowEnter(activeSessions.length + i)"
              class="sl-row"
              type="button"
              @click="goToSession(s.id)"
            >
              <span class="sl-dot sl-dot-idle" aria-hidden="true"></span>
              <span class="sl-row-main">
                <span class="sl-row-title">{{ s.title || 'untitled session' }}</span>
                <span class="sl-row-meta">
                  <span class="sl-path">{{ truncateMiddle(s.projectPath, 34) }}</span>
                  <span class="sl-dot-sep">·</span>
                  <span>{{ relativeTime(s.lastModified) }}</span>
                  <span class="sl-dot-sep">·</span>
                  <span>{{ s.eventCount }} events</span>
                </span>
              </span>
            </button>
          </TransitionGroup>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.session-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.sl-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: calc(var(--space-5) + var(--safe-top)) var(--space-5) var(--space-4);
  padding-left: calc(var(--space-5) + var(--safe-left));
  padding-right: calc(var(--space-5) + var(--safe-right));
}

.sl-title {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  letter-spacing: 0.01em;
  font-weight: 600;
  color: var(--ink-1);
}

.sl-subtitle {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.sl-refresh {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-2);
}

.sl-refresh svg {
  width: 18px;
  height: 18px;
}

.sl-refresh.is-loading svg {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.sl-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 var(--space-4) calc(var(--space-7) + var(--safe-bottom));
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
}

.sl-state {
  padding: var(--space-6) var(--space-3);
  text-align: center;
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.sl-state-error {
  color: var(--danger);
}

.sl-section {
  margin-top: var(--space-4);
}

.sl-section-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-3);
  padding: 0 var(--space-2) var(--space-2);
}

.sl-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: relative;
}

.sl-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
  padding: var(--space-3) var(--space-4);
  min-height: 64px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.15s ease;
}

.sl-row:active {
  transform: scale(0.98);
  background: var(--bg-2-hover);
}

.sl-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-top: 2px;
}

.sl-dot-active {
  background: var(--accent);
  animation: pulse 2.2s ease-in-out infinite;
}

.sl-dot-idle {
  background: var(--ink-3);
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 180, 84, 0.55);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(255, 180, 84, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 180, 84, 0);
  }
}

.sl-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sl-row-title {
  font-family: var(--font-mono);
  font-size: var(--text-md);
  color: var(--ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sl-row-meta {
  font-size: var(--text-xs);
  color: var(--ink-3);
  display: flex;
  gap: var(--space-1);
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
}

.sl-path {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
}

.sl-dot-sep {
  opacity: 0.6;
}

.sl-badge {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--accent-line);
  color: var(--accent-strong);
  background: var(--accent-dim);
}

.row-move,
.row-enter-active,
.row-leave-active {
  transition: all 0.3s var(--ease-out);
}

.row-leave-active {
  position: absolute;
  width: 100%;
}

.row-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sl-dot-active {
    animation: none;
  }
}
</style>
