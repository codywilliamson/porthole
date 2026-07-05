// directory intelligence for the launcher — no tmux, no fs writes
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { config } from './config'
import type { DiscoveredSession } from './transcript'
import type { KnownProject } from '../shared/types'

// dirs we never surface in the browser
const SKIP_DIRS = new Set(['node_modules'])

// keep resolution inside base — reject traversal (mirrors server.ts safeJoin)
function safeResolve(base: string, rel: string): string | null {
  const target = resolve(base, `.${sep}${rel}`)
  return target === base || target.startsWith(base + sep) ? target : null
}

// unique real cwd paths from discovered sessions, most-recently-used first.
// only paths that still exist on disk.
export function knownProjects(sessions: DiscoveredSession[]): KnownProject[] {
  const lastUsed = new Map<string, number>()
  for (const s of sessions) {
    if (!s.projectPath) continue
    const prev = lastUsed.get(s.projectPath) ?? 0
    if (s.lastModified > prev) lastUsed.set(s.projectPath, s.lastModified)
  }
  return [...lastUsed.entries()]
    .filter(([path]) => existsSync(path))
    .map(([path, ts]) => ({ path, lastUsed: ts }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
}

// list immediate subdir names under rootDir/rel; null on escape or missing dir
export async function listDirs(
  rel: string,
): Promise<{ path: string; dirs: string[] } | null> {
  const path = safeResolve(config.rootDir, rel)
  if (!path) return null
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return null // nonexistent / unreadable
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => e.name)
    .sort()
  return { path, dirs }
}

// an absolute path is launchable if it exists and is either inside rootDir
// or exactly a known project path
export function isLaunchableDir(dir: string, sessions: DiscoveredSession[]): boolean {
  if (!existsSync(dir)) return false
  const resolved = resolve(dir)
  const inRoot = resolved === config.rootDir || resolved.startsWith(config.rootDir + sep)
  if (inRoot) return true
  return knownProjects(sessions).some((p) => p.path === resolved)
}
