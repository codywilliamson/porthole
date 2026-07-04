// active detection: correlate running claude processes with sessions and tmux targets
// consumes tmux.listPanes() — never spawns tmux itself
import type { DiscoveredSession } from './transcript'

// map of sessionId -> tmux target for sessions a live claude process is writing
export async function getActiveTargets(
  sessions: DiscoveredSession[],
): Promise<Map<string, string>> {
  throw new Error('not implemented')
}
