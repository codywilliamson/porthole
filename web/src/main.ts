import { createApp } from 'vue'
import { MotionPlugin } from '@vueuse/motion'
import App from './App.vue'
import { initAppUpdate } from './composables/useAppUpdate'
import './style.css'

createApp(App).use(MotionPlugin).mount('#app')

// app-shell caching for instant home-screen launch; dev stays uncached
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
  initAppUpdate()
}
