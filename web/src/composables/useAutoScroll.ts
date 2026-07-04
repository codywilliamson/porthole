import { nextTick, ref, type Ref } from 'vue'

const BOTTOM_THRESHOLD_PX = 96

// tracks whether a scroll container is near its bottom edge, so the
// transcript can auto-follow new events without yanking the view when the
// user has scrolled up to read history
export function useAutoScroll(container: Ref<HTMLElement | null>) {
  const isNearBottom = ref(true)
  const hasNewBelow = ref(false)

  function checkNearBottom() {
    const el = container.value
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottom.value = distance < BOTTOM_THRESHOLD_PX
    if (isNearBottom.value) hasNewBelow.value = false
  }

  function scrollToBottom(smooth = true) {
    const el = container.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    hasNewBelow.value = false
  }

  // call after new events are appended to the DOM
  async function onContentGrew() {
    if (isNearBottom.value) {
      await nextTick()
      scrollToBottom(false)
    } else {
      hasNewBelow.value = true
    }
  }

  return { isNearBottom, hasNewBelow, checkNearBottom, scrollToBottom, onContentGrew }
}
