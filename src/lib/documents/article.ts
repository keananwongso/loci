import katex from 'katex'

export type ArticleBlock = { kind: 'heading' | 'paragraph' | 'image'; text: string; src?: string }

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Keep source definitions scoped to this import; never allow trusted HTML or URL commands. */
export function articleMath(macros = '') {
 const definitions: Record<string, string> = {}
 const options = { macros: definitions, globalGroup: true, trust: false, strict: 'ignore' as const, maxExpand: 1000, maxSize: 20 }
 const commands = macros.replace(/\s+/g, ' ').replace(/}\s+{/g, '}{').match(/\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|def)\b[\s\S]*?(?=\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|def|definecolor)\b|$)/g) || []
 for (const command of commands) {
  try { katex.renderToString(command, options) } catch { /* Unsupported source definitions stay local and unused. */ }
 }
 return (text: string) => text.split(/(\\begin\{(?:equation|align|gather|multline)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline)\*?\}|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map(part => {
  const environment = part.startsWith('\\begin{')
  const inline = part.startsWith('\\(') && part.endsWith('\\)')
  const display = (part.startsWith('\\[') && part.endsWith('\\]')) || (part.startsWith('$$') && part.endsWith('$$'))
  const dollar = part.startsWith('$') && part.endsWith('$') && part.length > 2
  if (!environment && !inline && !display && !dollar) return escape(part).replace(/\n/g, '<br>')
  const latex = environment ? part : part.slice(display || inline ? 2 : 1, display || inline ? -2 : -1)
  return katex.renderToString(latex, { ...options, globalGroup: false, output: 'html', displayMode: display || environment, throwOnError: false })
 }).join('')
}
