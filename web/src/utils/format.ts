// small formatting helpers — no reactivity, pure functions only

export function truncateMiddle(str: string, max = 40): string {
  if (str.length <= max) return str
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${str.slice(0, head)}…${str.slice(str.length - tail)}`
}

export function relativeTime(epochMs: number): string {
  const diffSec = Math.round((Date.now() - epochMs) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const min = Math.round(diffSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

// one-line hint for a tool_use input, e.g. a truncated bash command or file path
export function toolHint(input: unknown): string {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
      const value = obj[key]
      if (typeof value === 'string' && value.length > 0) return truncateMiddle(value, 64)
    }
  }
  try {
    return truncateMiddle(JSON.stringify(input), 64)
  } catch {
    return ''
  }
}

export function prettyJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}
