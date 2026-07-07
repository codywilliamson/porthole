<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getShaderColorFromString,
  GrainGradientShapes,
  grainGradientFragmentShader,
  ShaderFitOptions,
  ShaderMount,
} from '@paper-design/shaders'

// deep-sea porthole glass: slow drifting ink/teal/brass blobs, grainy and
// low-contrast so transcript text always wins legibility
const el = ref<HTMLDivElement | null>(null)
const ready = ref(false)
let mount: ShaderMount | null = null

onMounted(() => {
  if (!el.value) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  mount = new ShaderMount(
    el.value,
    grainGradientFragmentShader,
    {
      u_colorBack: getShaderColorFromString('#04070a'),
      u_colors: [
        getShaderColorFromString('#0d2b28'), // deep teal bioluminescence
        getShaderColorFromString('#0a1626'), // ink navy
        getShaderColorFromString('#26160a'), // muted brass glow
        getShaderColorFromString('#160a20'), // faint violet depth
      ],
      u_colorsCount: 4,
      u_softness: 0.9,
      u_intensity: 0.35,
      u_noise: 0.07,
      u_shape: GrainGradientShapes.blob,
      u_scale: 1.3,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: 0.5,
      u_originY: 0.5,
      u_worldWidth: 0,
      u_worldHeight: 0,
      u_fit: ShaderFitOptions.none,
    },
    undefined,
    reduceMotion ? 0 : 0.35,
  )

  // fade in after the first frame is mounted, instead of popping in raw
  requestAnimationFrame(() => (ready.value = true))
})

onBeforeUnmount(() => {
  mount?.dispose()
  mount = null
})
</script>

<template>
  <div ref="el" class="shader-bg" :class="{ 'is-ready': ready }" aria-hidden="true"></div>
</template>

<style scoped>
.shader-bg {
  position: fixed;
  inset: 0;
  z-index: -2;
  background: var(--bg-0);
  opacity: 0;
  transition: opacity 0.6s ease;
}

.shader-bg.is-ready {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .shader-bg {
    transition: none;
  }
}
</style>
