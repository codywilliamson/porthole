<script setup lang="ts">
import ShaderBackground from './components/ShaderBackground.vue'
import SessionList from './components/SessionList.vue'
import SessionView from './components/SessionView.vue'
import TmuxView from './components/TmuxView.vue'
import { updateReady, applyUpdate } from './composables/useAppUpdate'
import { useRoute } from './composables/useRoute'

const { route } = useRoute()
</script>

<template>
  <ShaderBackground />
  <div class="app-scrim" aria-hidden="true"></div>

  <main class="app-viewport">
    <Transition :name="route.name === 'list' ? 'pop' : 'push'" mode="out-in">
      <SessionList v-if="route.name === 'list'" key="list" />
      <SessionView v-else-if="route.name === 'session'" :key="route.id" :session-id="route.id" />
      <TmuxView v-else-if="route.name === 'tmux'" key="tmux" />
    </Transition>
  </main>

  <Transition name="update-pop">
    <button v-if="updateReady" class="update-pill mono" type="button" @click="applyUpdate()">
      update ready — reload
    </button>
  </Transition>
</template>

<style>
.app-scrim {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 80% at 50% 0%, transparent 0%, rgba(4, 6, 8, 0.55) 65%, rgba(4, 6, 8, 0.86) 100%),
    linear-gradient(180deg, rgba(4, 6, 8, 0.35) 0%, rgba(4, 6, 8, 0.55) 100%);
}

.app-viewport {
  position: relative;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
}

.app-viewport > * {
  position: absolute;
  inset: 0;
}

/* route transitions: list <-> session slide + fade. transform/opacity only
   (compositor-friendly, no layout on the big transcript DOM). out-in keeps the
   heavy view from mounting until the old one has left; kept short so the mount
   lands fast. */
.push-enter-active,
.push-leave-active,
.pop-enter-active,
.pop-leave-active {
  transition:
    transform 0.18s var(--ease-out),
    opacity 0.18s ease;
  will-change: transform, opacity;
}

.push-enter-from {
  transform: translateX(28px);
  opacity: 0;
}
.push-leave-to {
  transform: translateX(-16px);
  opacity: 0;
}

.pop-enter-from {
  transform: translateX(-28px);
  opacity: 0;
}
.pop-leave-to {
  transform: translateX(16px);
  opacity: 0;
}

/* new-build pill — floats over everything, top center below the notch */
.update-pill {
  position: fixed;
  top: calc(var(--safe-top) + var(--space-3));
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 9px 18px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font-size: var(--text-sm);
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}

.update-pop-enter-active,
.update-pop-leave-active {
  transition:
    opacity 0.2s var(--ease-out),
    transform 0.2s var(--ease-out);
}

.update-pop-enter-from,
.update-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

@media (prefers-reduced-motion: reduce) {
  .push-enter-active,
  .push-leave-active,
  .pop-enter-active,
  .pop-leave-active,
  .update-pop-enter-active,
  .update-pop-leave-active {
    transition: opacity 0.15s ease;
  }
  .update-pop-enter-from,
  .update-pop-leave-to {
    transform: translateX(-50%);
  }
  .push-enter-from,
  .push-leave-to,
  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
