<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DisplayItem } from '../utils/transcript'
import { renderMarkdown } from '../utils/markdown'
import { prettyJson, toolHint } from '../utils/format'

const props = defineProps<{ item: DisplayItem }>()

const expanded = ref(false)

// mcp tool names are huge (mcp__server__tool) — show the last segment, keep full name in title
const toolName = computed(() => {
  if (props.item.kind !== 'tool_pair') return ''
  const name = props.item.use?.name ?? 'tool'
  return name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name
})
const toolNameFull = computed(() => (props.item.kind === 'tool_pair' ? (props.item.use?.name ?? 'tool') : ''))
const toolInputHint = computed(() =>
  props.item.kind === 'tool_pair' && props.item.use ? toolHint(props.item.use.input) : '',
)
const isError = computed(() => props.item.kind === 'tool_pair' && Boolean(props.item.result?.isError))
const hasResult = computed(() => props.item.kind === 'tool_pair' && Boolean(props.item.result))

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div v-if="item.kind === 'assistant_text'" class="ev ev-assistant">
    <div class="ev-md mono" v-html="renderMarkdown(item.event.text)"></div>
  </div>

  <div v-else-if="item.kind === 'user_message'" class="ev ev-user-row">
    <div class="ev-user mono">{{ item.event.text }}</div>
  </div>

  <div v-else-if="item.kind === 'thinking'" class="ev ev-thinking">
    <button class="ev-disclosure ev-disclosure-quiet" type="button" :aria-expanded="expanded" @click="toggle">
      <span class="ev-chevron" :class="{ 'is-open': expanded }" aria-hidden="true">›</span>
      <span class="ev-thinking-label">thinking</span>
    </button>
    <div class="ev-collapse" :class="{ 'is-open': expanded }">
      <div class="ev-collapse-inner">
        <p class="ev-thinking-text">{{ item.event.text }}</p>
      </div>
    </div>
  </div>

  <div v-else-if="item.kind === 'tool_pair'" class="ev ev-tool" :class="{ 'is-error': isError }">
    <button class="ev-disclosure" type="button" :aria-expanded="expanded" @click="toggle">
      <span class="ev-chevron" :class="{ 'is-open': expanded }" aria-hidden="true">›</span>
      <span class="ev-tool-name mono" :title="toolNameFull">{{ toolName }}</span>
      <span v-if="toolInputHint" class="ev-tool-hint mono">{{ toolInputHint }}</span>
      <span class="ev-tool-flag-wrap">
        <span v-if="isError" class="ev-tool-flag ev-tool-flag-error">error</span>
        <span v-else-if="!hasResult" class="ev-tool-flag ev-tool-flag-pending">running</span>
      </span>
    </button>
    <div class="ev-collapse" :class="{ 'is-open': expanded }">
      <div class="ev-collapse-inner">
        <div v-if="item.use" class="ev-tool-block">
          <p class="ev-tool-block-label">input</p>
          <pre class="ev-pre mono">{{ prettyJson(item.use.input) }}</pre>
        </div>
        <div v-if="item.result" class="ev-tool-block">
          <p class="ev-tool-block-label">result</p>
          <pre class="ev-pre mono" :class="{ 'is-error': item.result.isError }">{{ item.result.text }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev {
  width: 100%;
}

/* assistant markdown */
.ev-assistant {
  color: var(--ink-1);
  font-size: var(--text-base);
}

.ev-md {
  line-height: 1.65;
  overflow-wrap: anywhere; /* long urls/tokens wrap instead of pushing the layout */
}

.ev-md :deep(p) {
  margin: 0 0 var(--space-3);
}

.ev-md :deep(p:last-child) {
  margin-bottom: 0;
}

.ev-md :deep(a) {
  color: var(--accent-strong);
}

.ev-md :deep(strong) {
  color: var(--ink-1);
  font-weight: 700;
}

.ev-md :deep(ul),
.ev-md :deep(ol) {
  margin: 0 0 var(--space-3);
  padding-left: 1.3em;
}

.ev-md :deep(code) {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.92em;
}

.ev-md :deep(pre) {
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0 0 var(--space-3);
}

.ev-md :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}

.ev-md :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-collapse: collapse;
  margin: 0 0 var(--space-3);
}

.ev-md :deep(th),
.ev-md :deep(td) {
  border: 1px solid var(--line);
  padding: var(--space-1) var(--space-2);
  text-align: left;
}

.ev-md :deep(blockquote) {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-3);
  border-left: 2px solid var(--line-strong);
  color: var(--ink-2);
}

/* user message */
.ev-user-row {
  display: flex;
}

.ev-user {
  margin-left: auto;
  max-width: 86%;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-right: 2px solid var(--accent-line);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  color: var(--ink-1);
  white-space: pre-wrap;
  word-break: break-word;
}

/* shared disclosure chrome */
.ev-disclosure {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: var(--space-1) 0;
  cursor: pointer;
  color: var(--ink-2);
  min-height: 44px;
}

.ev-chevron {
  flex: 0 0 auto;
  display: inline-block;
  transition: transform 0.22s var(--ease-out);
  color: var(--ink-3);
}

.ev-chevron.is-open {
  transform: rotate(90deg);
}

.ev-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.26s var(--ease-out);
}

.ev-collapse.is-open {
  grid-template-rows: 1fr;
}

.ev-collapse-inner {
  overflow: hidden;
  min-height: 0;
}

/* thinking */
.ev-thinking {
  font-style: italic;
}

.ev-disclosure-quiet .ev-thinking-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.ev-thinking-text {
  color: var(--ink-3);
  font-size: var(--text-sm);
  line-height: 1.6;
  padding: var(--space-1) 0 var(--space-3) 1.4em;
  white-space: pre-wrap;
}

/* tool pair */
.ev-tool {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--glass);
  padding: 0 var(--space-3);
}

.ev-tool.is-error {
  border-color: var(--danger-line);
  box-shadow: inset 3px 0 0 var(--danger);
}

.ev-tool-name {
  flex: 0 0 auto;
  max-width: 45%; /* full name unless huge; hint truncates first */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-strong);
  font-size: var(--text-sm);
}

.ev-tool-hint {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.ev-tool-flag-wrap {
  flex: 0 0 auto;
}

.ev-tool-flag {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

.ev-tool-flag-error {
  color: var(--danger);
  background: var(--danger-dim);
}

.ev-tool-flag-pending {
  color: var(--ink-3);
  background: var(--bg-2);
}

.ev-tool-block {
  padding: var(--space-2) 0 var(--space-3);
}

.ev-tool-block-label {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  margin-bottom: var(--space-1);
}

.ev-pre {
  margin: 0;
  max-height: 40vh;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.ev-pre.is-error {
  color: #ffb3ab;
  border-color: var(--danger-line);
}

@media (prefers-reduced-motion: reduce) {
  .ev-chevron {
    transition: none;
  }
  .ev-collapse {
    transition: none;
  }
}
</style>
