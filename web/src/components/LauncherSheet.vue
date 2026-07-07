<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useLauncher } from '../composables/useLauncher'

const emit = defineEmits<{ close: [] }>()

const shown = ref(false)
const confirmingPath = ref<string | null>(null)

const {
  projects,
  projectsLoading,
  projectsError,
  loadProjects,
  dirs,
  browsePath,
  browseLoading,
  browseError,
  crumbs,
  browseTo,
  descend,
  phase,
  launchTarget,
  launchError,
  nudging,
  launch,
  pressEnter,
} = useLauncher(() => requestClose())

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

function requestClose() {
  shown.value = false
}

function confirmLaunch(dir: string) {
  confirmingPath.value = null
  launch(dir)
}

onMounted(() => {
  loadProjects()
  browseTo('')
  nextTick(() => (shown.value = true))
})
</script>

<template>
  <div class="launcher" aria-hidden="false">
    <Transition name="scrim">
      <div v-if="shown" class="launcher-scrim" @click="requestClose" />
    </Transition>

    <Transition name="sheet" @after-leave="emit('close')">
      <div v-if="shown" class="launcher-sheet" role="dialog" aria-label="launch a session">
        <div class="ls-grip" aria-hidden="true"></div>

        <header class="ls-head">
          <h2 class="ls-title no-select">launch session</h2>
          <button class="ls-x" type="button" aria-label="close" @click="requestClose">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <!-- launch in progress / waiting -->
        <div v-if="phase !== 'idle'" class="ls-body ls-launch">
          <div v-if="phase === 'launching' || phase === 'nudged'" class="ls-spinner" aria-hidden="true"></div>

          <p v-if="phase === 'launching'" class="ls-launch-msg">launching… watching for session</p>
          <p v-else-if="phase === 'nudged'" class="ls-launch-msg">sent enter — watching…</p>
          <p v-else-if="phase === 'trust'" class="ls-launch-msg">
            claude may be waiting on the folder trust prompt
          </p>
          <p v-else-if="phase === 'gaveup'" class="ls-launch-msg">
            still no session — check the terminal
          </p>

          <p v-if="launchTarget" class="ls-target mono">{{ launchTarget }}</p>
          <p v-if="launchError" class="ls-error">{{ launchError }}</p>

          <button
            v-if="phase === 'trust' || phase === 'gaveup'"
            class="ls-enter-btn"
            type="button"
            :disabled="nudging"
            @click="pressEnter"
          >
            {{ nudging ? 'sending…' : 'press enter' }}
          </button>
        </div>

        <!-- picker -->
        <div v-else class="ls-body">
          <p v-if="launchError" class="ls-error ls-error-top">{{ launchError }}</p>

          <section class="ls-section">
            <h3 class="ls-label no-select">recent projects</h3>
            <p v-if="projectsError" class="ls-state ls-state-error">{{ projectsError }}</p>
            <div v-else-if="projectsLoading && projects.length === 0" class="ls-rows" aria-hidden="true">
              <div v-for="i in 3" :key="i" class="ls-proj ls-proj-skel">
                <span class="skel skel-line ls-skel-name" :class="{ 'ls-skel-alt': i % 2 === 0 }"></span>
                <span class="skel skel-line skel-line-sm ls-skel-path" :class="{ 'ls-skel-alt': i % 2 === 0 }"></span>
              </div>
              <span class="visually-hidden" role="status">loading…</span>
            </div>
            <div v-else-if="projects.length === 0" class="ls-state empty-state">
              <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke-linejoin="round" />
              </svg>
              <p>no known projects yet</p>
            </div>
            <div v-else class="ls-rows">
              <template v-for="p in projects" :key="p.path">
                <Transition name="ls-swap" mode="out-in">
                  <div v-if="confirmingPath === p.path" class="ls-confirm">
                    <span class="ls-confirm-q">launch claude here?</span>
                    <div class="ls-confirm-actions">
                      <button class="ls-mini ls-mini-ghost" type="button" @click="confirmingPath = null">
                        cancel
                      </button>
                      <button class="ls-mini ls-mini-go" type="button" @click="confirmLaunch(p.path)">
                        launch
                      </button>
                    </div>
                  </div>
                  <button v-else class="ls-proj" type="button" @click="confirmingPath = p.path">
                    <span class="ls-proj-name mono">{{ basename(p.path) }}</span>
                    <span class="ls-proj-path mono">{{ p.path }}</span>
                  </button>
                </Transition>
              </template>
            </div>
          </section>

          <section class="ls-section">
            <h3 class="ls-label no-select">browse</h3>
            <nav class="ls-crumbs mono" aria-label="breadcrumb">
              <template v-for="(c, i) in crumbs" :key="c.rel">
                <span v-if="i > 0" class="ls-crumb-sep" aria-hidden="true">/</span>
                <button
                  class="ls-crumb"
                  :class="{ 'is-current': i === crumbs.length - 1 }"
                  type="button"
                  @click="browseTo(c.rel)"
                >
                  {{ c.label }}
                </button>
              </template>
            </nav>

            <button class="ls-launch-here" type="button" @click="launch(browsePath)">
              <span>launch here</span>
              <span class="ls-launch-here-path mono">{{ browsePath }}</span>
            </button>

            <p v-if="browseError" class="ls-state ls-state-error">{{ browseError }}</p>
            <div v-else-if="browseLoading && dirs.length === 0" class="ls-rows" aria-hidden="true">
              <div v-for="i in 3" :key="i" class="ls-dir ls-dir-skel">
                <span class="skel ls-skel-icon"></span>
                <span class="skel skel-line ls-skel-dirname" :class="{ 'ls-skel-alt': i % 2 === 0 }"></span>
              </div>
              <span class="visually-hidden" role="status">loading…</span>
            </div>
            <div v-else-if="dirs.length === 0" class="ls-state empty-state">
              <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke-linejoin="round" />
              </svg>
              <p>no subdirectories</p>
            </div>
            <div v-else class="ls-rows">
              <button
                v-for="name in dirs"
                :key="name"
                class="ls-dir"
                type="button"
                @click="descend(name)"
              >
                <svg class="ls-dir-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke-linejoin="round" />
                </svg>
                <span class="ls-dir-name mono">{{ name }}</span>
                <svg class="ls-dir-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.launcher {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.launcher-scrim {
  position: absolute;
  inset: 0;
  background: rgba(4, 6, 8, 0.66);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  pointer-events: auto;
}

.launcher-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: auto;
  max-height: 82dvh;
  display: flex;
  flex-direction: column;
  background: var(--glass-strong);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1px solid var(--line-strong);
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
  box-shadow: 0 -18px 48px rgba(0, 0, 0, 0.5);
}

.ls-grip {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--line-strong);
  margin: var(--space-2) auto 0;
  flex: 0 0 auto;
}

.ls-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4) var(--space-2);
  flex: 0 0 auto;
}

.ls-title {
  font-family: var(--font-mono);
  font-size: var(--text-md);
  color: var(--ink-1);
}

.ls-x {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--glass);
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ls-x svg {
  width: 18px;
  height: 18px;
}

.ls-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
  padding: 0 var(--space-4) calc(var(--space-5) + var(--safe-bottom));
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
}

.ls-section {
  margin-top: var(--space-4);
}

.ls-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-3);
  padding: 0 var(--space-1) var(--space-2);
}

.ls-state {
  padding: var(--space-3) var(--space-1);
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.ls-state-error {
  color: var(--danger);
}

.ls-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* recent project row */
.ls-proj {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  min-height: 56px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--bg-2);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
}

.ls-proj:active {
  transform: scale(0.98);
  background: var(--bg-2-hover);
}

.ls-proj-name {
  font-size: var(--text-md);
  color: var(--ink-1);
}

.ls-proj-skel {
  justify-content: center;
  cursor: default;
}

.ls-skel-name {
  width: 40%;
}

.ls-skel-path {
  width: 70%;
}

.ls-skel-alt.ls-skel-name {
  width: 55%;
}

.ls-skel-alt.ls-skel-path {
  width: 50%;
}

.ls-proj-path {
  font-size: var(--text-xs);
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* inline confirm */
.ls-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 56px;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-line);
  background: var(--accent-dim);
}

.ls-confirm-q {
  font-size: var(--text-sm);
  color: var(--accent-strong);
}

.ls-confirm-actions {
  display: flex;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.ls-mini {
  min-height: 44px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  border: 1px solid var(--line);
  cursor: pointer;
}

.ls-mini-ghost {
  background: var(--glass);
  color: var(--ink-2);
}

.ls-mini-go {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: transparent;
}

/* breadcrumb */
.ls-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-1) var(--space-3);
  font-size: var(--text-sm);
}

.ls-crumb {
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--ink-2);
  cursor: pointer;
}

.ls-crumb.is-current {
  color: var(--accent-strong);
}

.ls-crumb-sep {
  color: var(--ink-3);
}

.ls-launch-here {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-line);
  background: var(--accent-dim);
  color: var(--accent-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.ls-launch-here:active {
  transform: scale(0.99);
}

.ls-launch-here-path {
  font-weight: 400;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
}

/* dir row */
.ls-dir {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  text-align: left;
  min-height: 52px;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--bg-2);
  cursor: pointer;
  transition: background 0.18s ease, transform 0.12s ease;
}

.ls-dir:active {
  transform: scale(0.98);
  background: var(--bg-2-hover);
}

.ls-dir-icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  color: var(--accent);
  opacity: 0.85;
}

.ls-dir-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls-dir-skel {
  cursor: default;
}

.ls-skel-icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
}

.ls-skel-dirname {
  flex: 1;
  width: 45%;
}

.ls-skel-alt.ls-skel-dirname {
  width: 60%;
}

.ls-dir-chev {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: var(--ink-3);
}

/* launch status panel */
.ls-launch {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding-top: var(--space-6);
}

.ls-launch-msg {
  font-size: var(--text-base);
  color: var(--ink-1);
  max-width: 32ch;
}

.ls-target {
  font-size: var(--text-xs);
  color: var(--accent-strong);
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--accent-line);
  background: var(--accent-dim);
}

.ls-error {
  color: var(--danger);
  font-size: var(--text-sm);
}

.ls-error-top {
  padding: var(--space-3) var(--space-1) 0;
}

.ls-enter-btn {
  min-height: 48px;
  padding: 0 var(--space-6);
  margin-top: var(--space-2);
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: var(--text-base);
  font-weight: 600;
  cursor: pointer;
}

.ls-enter-btn:disabled {
  opacity: 0.5;
}

.ls-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  animation: ls-spin 0.85s linear infinite;
}

@keyframes ls-spin {
  to {
    transform: rotate(360deg);
  }
}

/* transitions — sheet slide + scrim fade ~200ms */
.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.2s var(--ease-out), opacity 0.2s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
  opacity: 0.6;
}

.scrim-enter-active,
.scrim-leave-active {
  transition: opacity 0.2s ease;
}

.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}

/* recent-project row <-> inline confirm crossfade */
.ls-swap-enter-active,
.ls-swap-leave-active {
  transition: opacity 0.1s ease;
}

.ls-swap-enter-from,
.ls-swap-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-from,
  .sheet-leave-to {
    transform: none;
  }
  .ls-spinner {
    animation: none;
  }
}
</style>
