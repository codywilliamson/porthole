import { computed, onUnmounted, ref, watch } from 'vue'
import type {
  DirsResponse,
  KnownProject,
  LaunchResponse,
  NudgeKey,
  ProjectsResponse,
} from '../../../shared/types'
import { useSessions } from './useSessions'
import { goToSession } from './useRoute'

// how long we wait for the launched session to appear before hinting at the
// folder-trust prompt, then again after the user presses enter before giving up
const WATCH_BEFORE_HINT_MS = 10_000
const WATCH_AFTER_NUDGE_MS = 15_000
const WATCH_POLL_MS = 1200

// idle → launching (watching for the session) → trust (hint + press-enter) →
// nudged (watching again) → gaveup. any state can resolve to navigation.
export type LaunchPhase = 'idle' | 'launching' | 'trust' | 'nudged' | 'gaveup'

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

// onNavigated fires when the launched session is found and we've routed to it —
// the sheet uses it to close itself
export function useLauncher(onNavigated: () => void) {
  const { sessions, refresh } = useSessions()

  // --- recent projects ---
  const root = ref('')
  const projects = ref<KnownProject[]>([])
  const projectsLoading = ref(false)
  const projectsError = ref<string | null>(null)

  async function loadProjects() {
    projectsLoading.value = true
    projectsError.value = null
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error(`request failed (${res.status})`)
      const data = (await res.json()) as ProjectsResponse
      root.value = data.root
      projects.value = data.known
    } catch (err) {
      projectsError.value = err instanceof Error ? err.message : 'failed to load projects'
    } finally {
      projectsLoading.value = false
    }
  }

  // --- dir browser (rel is relative to root; '' is root) ---
  const browseRel = ref('')
  const browsePath = ref('')
  const dirs = ref<string[]>([])
  const browseLoading = ref(false)
  const browseError = ref<string | null>(null)

  const crumbs = computed(() => {
    const rootLabel = basename(root.value || browsePath.value || 'root')
    const list = [{ label: rootLabel, rel: '' }]
    if (browseRel.value) {
      const segs = browseRel.value.split('/')
      segs.forEach((seg, i) => list.push({ label: seg, rel: segs.slice(0, i + 1).join('/') }))
    }
    return list
  })

  async function browseTo(rel: string) {
    browseLoading.value = true
    browseError.value = null
    try {
      const res = await fetch(`/api/dirs?path=${encodeURIComponent(rel)}`)
      if (!res.ok) throw new Error(`request failed (${res.status})`)
      const data = (await res.json()) as DirsResponse
      browseRel.value = rel
      browsePath.value = data.path
      dirs.value = data.dirs
    } catch (err) {
      browseError.value = err instanceof Error ? err.message : 'failed to read directory'
    } finally {
      browseLoading.value = false
    }
  }

  function descend(name: string) {
    browseTo(browseRel.value ? `${browseRel.value}/${name}` : name)
  }

  // --- launch + watch ---
  const phase = ref<LaunchPhase>('idle')
  const launchTarget = ref<string | null>(null)
  const launchError = ref<string | null>(null)
  const nudging = ref(false)

  let hintTimer: ReturnType<typeof setTimeout> | undefined
  let giveupTimer: ReturnType<typeof setTimeout> | undefined
  let watchPoll: ReturnType<typeof setInterval> | undefined

  function clearTimers() {
    if (hintTimer) clearTimeout(hintTimer)
    if (giveupTimer) clearTimeout(giveupTimer)
    if (watchPoll) clearInterval(watchPoll)
    hintTimer = giveupTimer = watchPoll = undefined
  }

  function resetLaunch() {
    clearTimers()
    phase.value = 'idle'
    launchTarget.value = null
    launchError.value = null
    nudging.value = false
  }

  // a new active pane matching the target means claude is up — route to it
  watch(sessions, (list) => {
    const target = launchTarget.value
    if (!target || phase.value === 'idle' || phase.value === 'gaveup') return
    const match = list.find((s) => s.active && s.tmuxTarget === target)
    if (match) {
      clearTimers()
      phase.value = 'idle'
      goToSession(match.id)
      onNavigated()
    }
  })

  async function launch(dir: string) {
    launchError.value = null
    phase.value = 'launching'
    try {
      const res = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir }),
      })
      const data = (await res.json().catch(() => null)) as LaunchResponse | null
      if (!res.ok || !data?.ok || !data.target) {
        launchError.value = data?.error || `launch failed (${res.status})`
        phase.value = 'idle'
        return
      }
      launchTarget.value = data.target
      // poll the list fast while watching so the session is caught promptly
      refresh()
      watchPoll = setInterval(refresh, WATCH_POLL_MS)
      hintTimer = setTimeout(() => {
        if (phase.value === 'launching') phase.value = 'trust'
      }, WATCH_BEFORE_HINT_MS)
    } catch (err) {
      launchError.value = err instanceof Error ? err.message : 'launch failed'
      phase.value = 'idle'
    }
  }

  async function pressEnter() {
    if (!launchTarget.value || nudging.value) return
    nudging.value = true
    launchError.value = null
    try {
      await nudge(launchTarget.value, 'enter')
      phase.value = 'nudged'
      if (giveupTimer) clearTimeout(giveupTimer)
      giveupTimer = setTimeout(() => {
        if (phase.value === 'nudged') {
          phase.value = 'gaveup'
          if (watchPoll) clearInterval(watchPoll)
          watchPoll = undefined
        }
      }, WATCH_AFTER_NUDGE_MS)
    } catch (err) {
      launchError.value = err instanceof Error ? err.message : 'nudge failed'
    } finally {
      nudging.value = false
    }
  }

  onUnmounted(clearTimers)

  return {
    // projects
    root,
    projects,
    projectsLoading,
    projectsError,
    loadProjects,
    // browse
    browseRel,
    browsePath,
    dirs,
    browseLoading,
    browseError,
    crumbs,
    browseTo,
    descend,
    // launch
    phase,
    launchTarget,
    launchError,
    nudging,
    launch,
    pressEnter,
    resetLaunch,
  }
}

// shared nudge helper — used by the launcher and the pane action menu
export async function nudge(target: string, key: NudgeKey): Promise<void> {
  const res = await fetch('/api/nudge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target, key }),
  })
  if (!res.ok) throw new Error(`nudge failed (${res.status})`)
}
