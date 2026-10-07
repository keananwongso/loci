import { describe, expect, it } from 'vitest'
import { articleMath } from './article'

describe('textbook math', () => {
 it('renders MathJax delimiters and source macros without leaking definitions between imports', () => {
  const render = articleMath(String.raw`\newcommand{\vv}{\mathbf{v}} \newcommand{\llt}{\left\lt} \newcommand{\rgt}{\right\gt} \newcommand{\vnabla}{\pmb{\nabla}}`)
  const html = render(String.raw`The gradient \(\vnabla f(a,b)\) and vector \(\llt 1,2\rgt\). \[D_{\vv}f=\vnabla f\cdot\vv\]`)
  expect(html).toContain('katex-display')
  expect(html).not.toContain('#cc0000')
  expect(articleMath()(String.raw`\(\vv\)`)).toContain('#cc0000')
 })
 it('renders display environments and multiline mathchoice definitions used by textbooks', () => {
  const render = articleMath(String.raw`\newcommand{\gradient}{\mathchoice{\nabla}
  {\nabla} {\nabla} {\nabla}}`)
  const html = render(String.raw`\begin{equation*}D_vf=\gradient f\cdot v\end{equation*}`)
  expect(html).toContain('katex-display')
  expect(html).not.toContain('katex-error')
  expect(html).not.toContain(String.raw`\begin{`)
 })
 it('escapes page text and rejects trusted math commands', () => {
  const html = articleMath()(String.raw`<img src=x onerror=alert(1)> \(\href{https://evil.example}{x}\)`)
  expect(html).toContain('&lt;img')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('href=')
 })
})
