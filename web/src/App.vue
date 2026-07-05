<script setup lang="ts">
import ShaderBackground from './components/ShaderBackground.vue'
import SessionList from './components/SessionList.vue'
import SessionView from './components/SessionView.vue'
import { useRoute } from './composables/useRoute'

const { route } = useRoute()
</script>

<template>
  <ShaderBackground />
  <div class="app-scrim" aria-hidden="true"></div>

  <main class="app-viewport">
    <Transition :name="route.name === 'session' ? 'push' : 'pop'" mode="out-in">
      <SessionList v-if="route.name === 'list'" key="list" />
      <SessionView v-else-if="route.name === 'session'" :key="route.id" :session-id="route.id" />
    </Transition>
  </main>
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

@media (prefers-reduced-motion: reduce) {
  .push-enter-active,
  .push-leave-active,
  .pop-enter-active,
  .pop-leave-active {
    transition: opacity 0.15s ease;
  }
  .push-enter-from,
  .push-leave-to,
  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
