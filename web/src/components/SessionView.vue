<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionStream } from '../composables/useSessionStream'
import { nudge } from '../composables/useLauncher'
import { goToList } from '../composables/useRoute'
import { truncateMiddle } from '../utils/format'
import type { NudgeKey } from '../../../shared/types'
import TranscriptView from './TranscriptView.vue'
import DraftPad from './DraftPad.vue'

const props = defineProps<{ sessionId: string }>()

const { events, session, active, tmuxTarget, status } = useSessionStream(props.sessionId)

const title = computed(() => session.value?.title || 'session')
const projectPath = computed(() => (session.value ? truncateMiddle(session.value.projectPath, 40) : ''))

// pane actions menu
const menuOpen = ref(false)
const confirmingClose = ref(false)
const closing = ref(false)
const actionError = ref<string | null>(null)

function closeMenu() {
  menuOpen.value = false
  confirmingClose.value = false
}

function flashError(msg: string) {
  actionError.value = msg
  setTimeout(() => (actionError.value = null), 2600)
}

async function doNudge(key: NudgeKey) {
  if (!tmuxTarget.value) return
  closeMenu()
  try {
    await nudge(tmuxTarget.value, key)
  } catch (err) {
    flashError(err instanceof Error ? err.message : 'nudge failed')
  }
}

async function closeWindow() {
  if (closing.value) return
  closing.value = true
  actionError.value = null
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (res.status === 404) return flashError('window not found')
    if (res.status === 409) return flashError('session already inactive')
    if (!res.ok) throw new Error(`close failed (${res.status})`)
    closeMenu()
    goToList()
  } catch (err) {
    flashError(err instanceof Error ? err.message : 'close failed')
  } finally {
    closing.value = false
  }
}
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
        <h1 class="sv-title mono no-select">{{ title }}</h1>
        <p v-if="projectPath" class="sv-path mono no-select">{{ projectPath }}</p>
      </div>

      <div class="sv-status">
        <span v-if="active" class="sv-badge sv-badge-active no-select">
          <span class="sv-dot" aria-hidden="true"></span>
          <span v-if="tmuxTarget" class="mono">{{ tmuxTarget }}</span>
        </span>
        <span v-else class="sv-badge sv-badge-idle no-select">inactive</span>
      </div>

      <div v-if="active" class="sv-menu-wrap">
        <button
          class="sv-more"
          type="button"
          aria-label="pane actions"
          :aria-expanded="menuOpen"
          @click="menuOpen ? closeMenu() : (menuOpen = true)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>

        <Transition name="sv-menu-fade">
          <div v-if="menuOpen" class="sv-menu-backdrop" @click="closeMenu"></div>
        </Transition>
        <Transition name="sv-menu-pop">
          <div v-if="menuOpen" class="sv-menu" role="menu">
            <template v-if="!confirmingClose">
              <button class="sv-menu-item" type="button" role="menuitem" @click="doNudge('enter')">
                nudge enter
              </button>
              <button class="sv-menu-item" type="button" role="menuitem" @click="doNudge('escape')">
                nudge esc
              </button>
              <div class="sv-menu-div" aria-hidden="true"></div>
              <button
                class="sv-menu-item sv-menu-danger"
                type="button"
                role="menuitem"
                @click="confirmingClose = true"
              >
                close window
              </button>
            </template>
            <template v-else>
              <p class="sv-menu-confirm">close window?</p>
              <div class="sv-menu-confirm-actions">
                <button class="sv-menu-item" type="button" @click="confirmingClose = false">cancel</button>
                <button
                  class="sv-menu-item sv-menu-danger"
                  type="button"
                  :disabled="closing"
                  @click="closeWindow"
                >
                  {{ closing ? 'closing…' : 'confirm' }}
                </button>
              </div>
            </template>
          </div>
        </Transition>
      </div>
    </header>

    <p v-if="actionError" class="sv-stream-banner sv-action-error">{{ actionError }}</p>

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

.sv-menu-wrap {
  position: relative;
  flex: 0 0 auto;
}

.sv-more {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-strong);
  background: var(--bg-2);
  color: var(--ink-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sv-more svg {
  width: 20px;
  height: 20px;
}

.sv-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.sv-menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: 21;
  min-width: 180px;
  padding: var(--space-1);
  border-radius: var(--radius-md);
  border: 1px solid var(--line-strong);
  /* solid surface — translucent glass over the animated shader was unreadable */
  background: var(--bg-2);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.66);
}

.sv-menu-pop-enter-active {
  transition:
    opacity 0.16s var(--ease-out),
    transform 0.16s var(--ease-out);
}

.sv-menu-pop-leave-active {
  transition:
    opacity 0.12s var(--ease-out),
    transform 0.12s var(--ease-out);
}

.sv-menu-pop-enter-from,
.sv-menu-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.sv-menu-fade-enter-active {
  transition: opacity 0.16s ease;
}

.sv-menu-fade-leave-active {
  transition: opacity 0.12s ease;
}

.sv-menu-fade-enter-from,
.sv-menu-fade-leave-to {
  opacity: 0;
}

.sv-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--ink-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background 0.14s ease;
}

.sv-menu-item:active {
  background: var(--bg-2-hover);
}

.sv-menu-item:disabled {
  opacity: 0.5;
}

.sv-menu-danger {
  color: var(--danger);
}

.sv-menu-div {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--line);
}

.sv-menu-confirm {
  padding: var(--space-3) var(--space-3) var(--space-2);
  font-size: var(--text-sm);
  color: var(--ink-1);
}

.sv-menu-confirm-actions {
  display: flex;
  gap: var(--space-1);
}

.sv-action-error {
  color: var(--danger);
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
  .sv-menu-pop-enter-active,
  .sv-menu-pop-leave-active {
    transition: opacity 0.12s ease;
  }
}
</style>
