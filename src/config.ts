import os from 'node:os'

// only place env is read — everything else imports `config`
export const config = {
  host: process.env.PORTHOLE_HOST ?? '0.0.0.0', // tailscale is the perimeter, bind wide
  port: Number(process.env.PORTHOLE_PORT ?? 4747),
  pollMs: Number(process.env.PORTHOLE_POLL_MS ?? 2000),
  projectsDir: process.env.PORTHOLE_PROJECTS_DIR ?? `${os.homedir()}/.claude/projects`,
  // optional dns-rebinding defense: comma-separated host[:port] allowlist for the Host header
  allowedHosts: (process.env.PORTHOLE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
}
