import { marked } from 'marked'

marked.setOptions({ breaks: true })

// escape raw HTML before handing to marked so transcript text can never
// inject real tags/scripts — markdown syntax itself is untouched since it
// uses no reserved html characters
function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderMarkdown(text: string): string {
  return marked.parse(escapeHtml(text)) as string
}
