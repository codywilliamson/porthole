<script setup lang="ts">
import { ref } from 'vue'
import { usePanes } from '../composables/usePanes'
import { nudge } from '../composables/useLauncher'
import { goToList, goToSession } from '../composables/useRoute'
import { truncateMiddle } from '../utils/format'
import type { NudgeKey, PaneInfo } from '../../../shared/types'

const { panes, loading, error, refresh } = usePanes()

// which pane row is showing its close confirm
const confirming = ref<string | null>(null)
const busy = ref<string | null>(null)
const rowError = ref<Record<string, string>>({})

function flash(target: string, msg: string) {
  rowError.value = { ...rowError.value, [target]: msg }
  setTimeout(() => {
    const next = { ...rowError.value }
    delete next[target]
    rowError.value = next
  }, 2600)
}

async function doNudge(p: PaneInfo, key: NudgeKey) {
  try {
    await nudge(p.target, key)
  } catch (err) {
    flash(p.target, err instanceof Error ? err.message : 'nudge failed')
  }
}

async function doClose(p: PaneInfo) {
  if (!p.sessionId || busy.value) return
  busy.value = p.target
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(p.sessionId)}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) throw new Error(`close failed (${res.status})`)
    confirming.value = null
    await refresh()
  } catch (err) {
    flash(p.target, err instanceof Error ? err.message : 'close failed')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="tmux-view">
    <header class="tv-header">
      <button class="tv-back" type="button" aria-label="back to sessions" @click="goToList()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="tv-heading">
        <h1 class="tv-title">tmux panes</h1>
        <p class="tv-sub">{{ panes.length }} pane{{ panes.length === 1 ? '' : 's' }}</p>
      </div>
      <button class="tv-refresh" type="button" aria-label="refresh" @click="refresh()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 11a8 8 0 1 0-.9 4.5" stroke-linecap="round" />
          <path d="M20 4v5h-5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </header>

    <div class="tv-body">
      <p v-if="loading && panes.length === 0" class="tv-empty">loading panes…</p>
      <p v-else-if="error && panes.length === 0" class="tv-empty tv-empty-err">{{ error }}</p>
      <p v-else-if="panes.length === 0" class="tv-empty">no tmux panes running.</p>

      <ul v-else class="tv-list">
        <li v-for="p in panes" :key="p.target" class="tv-row" :class="{ 'is-claude': p.hasClaude }">
          <button
            class="tv-row-main"
            type="button"
            :disabled="!p.sessionId"
            @click="p.sessionId && goToSession(p.sessionId)"
          >
            <span class="tv-row-top">
              <span class="tv-target mono">{{ p.target }}</span>
              <span v-if="p.hasClaude" class="tv-tag tv-tag-claude">claude</span>
              <span v-else class="tv-tag mono">{{ p.command }}</span>
            </span>
            <span class="tv-title-line mono">{{ p.title || p.cwd }}</span>
            <span v-if="p.title" class="tv-path mono">{{ truncateMiddle(p.cwd, 42) }}</span>
          </button>

          <div v-if="p.hasClaude" class="tv-actions">
            <template v-if="confirming !== p.target">
              <button class="tv-act" type="button" @click="doNudge(p, 'enter')">⏎</button>
              <button class="tv-act" type="button" @click="doNudge(p, 'escape')">esc</button>
              <button
                v-if="p.sessionId"
                class="tv-act tv-act-danger"
                type="button"
                aria-label="close window"
                @click="confirming = p.target"
              >
                ✕
              </button>
            </template>
            <template v-else>
              <span class="tv-confirm">close?</span>
              <button class="tv-act" type="button" @click="confirming = null">no</button>
              <button
                class="tv-act tv-act-danger"
                type="button"
                :disabled="busy === p.target"
                @click="doClose(p)"
              >
                {{ busy === p.target ? '…' : 'yes' }}
              </button>
            </template>
          </div>
          <p v-if="rowError[p.target]" class="tv-row-err">{{ rowError[p.target] }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.tmux-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tv-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: calc(var(--space-4) + var(--safe-top)) var(--space-4) var(--space-3);
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
  border-bottom: 1px solid var(--line);
  background: var(--glass-strong);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.tv-back,
.tv-refresh {
  flex: 0 0 auto;
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

.tv-back svg,
.tv-refresh svg {
  width: 18px;
  height: 18px;
}

.tv-heading {
  flex: 1;
  min-width: 0;
}

.tv-title {
  font-size: var(--text-md);
  color: var(--ink-1);
}

.tv-sub {
  font-size: var(--text-xs);
  color: var(--ink-3);
  margin-top: 2px;
}

.tv-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: clip;
  padding: var(--space-4);
  padding-left: calc(var(--space-4) + var(--safe-left));
  padding-right: calc(var(--space-4) + var(--safe-right));
  padding-bottom: calc(var(--space-6) + var(--safe-bottom));
}

.tv-empty {
  text-align: center;
  color: var(--ink-3);
  font-size: var(--text-sm);
  padding: var(--space-6) 0;
}

.tv-empty-err {
  color: var(--danger);
}

.tv-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.tv-row {
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  background: var(--bg-2);
  overflow: hidden;
}

.tv-row.is-claude {
  border-color: var(--accent-line);
}

.tv-row-main {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
}

.tv-row-main:disabled {
  cursor: default;
}

.tv-row-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 4px;
}

.tv-target {
  font-size: var(--text-sm);
  color: var(--accent-strong);
  font-weight: 600;
}

.tv-tag {
  font-size: var(--text-xs);
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  color: var(--ink-3);
}

.tv-tag-claude {
  color: var(--accent-strong);
  background: var(--accent-dim);
  border-color: var(--accent-line);
}

.tv-title-line {
  display: block;
  font-size: var(--text-sm);
  color: var(--ink-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tv-path {
  display: block;
  font-size: var(--text-xs);
  color: var(--ink-3);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tv-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4) var(--space-3);
  border-top: 1px solid var(--line);
}

.tv-act {
  min-width: 44px;
  height: 36px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg-1);
  color: var(--ink-1);
  font-size: var(--text-sm);
  cursor: pointer;
}

.tv-act:active {
  background: var(--bg-2-hover);
}

.tv-act:disabled {
  opacity: 0.5;
}

.tv-act-danger {
  color: var(--danger);
  border-color: var(--danger-line);
}

.tv-confirm {
  font-size: var(--text-sm);
  color: var(--ink-2);
  margin-right: auto;
}

.tv-row-err {
  padding: 0 var(--space-4) var(--space-3);
  font-size: var(--text-xs);
  color: var(--danger);
}
</style>
