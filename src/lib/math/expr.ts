/**
 * A tiny, safe expression compiler for function plots: `y = f(x)`.
 * Model output is never passed to `eval`/`Function`; it is parsed into this small AST.
 */

type Node =
	| { t: 'num'; v: number }
	| { t: 'var' }
	| { t: 'neg'; a: Node }
	| { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
	| { t: 'call'; fn: string; args: Node[] }

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	exp: Math.exp,
	log: Math.log,
	ln: Math.log,
	log10: Math.log10,
	sqrt: Math.sqrt,
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	sign: Math.sign,
	min: Math.min,
	max: Math.max,
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 }

type Token = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string }

function tokenize(src: string): Token[] {
	const tokens: Token[] = []
	const s = src.replace(/\*\*/g, '^').replace(/π/g, 'pi').replace(/·|×/g, '*')
	let i = 0
	while (i < s.length) {
		const c = s[i]
		if (/\s/.test(c)) {
			i++
		} else if (/[0-9.]/.test(c)) {
			const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
			if (!m) throw new Error(`Bad number at "${s.slice(i, i + 6)}"`)
			tokens.push({ k: 'num', v: parseFloat(m[0]) })
			i += m[0].length
		} else if (/[a-z_]/i.test(c)) {
			const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i))!
			tokens.push({ k: 'id', v: m[0].toLowerCase() })
			i += m[0].length
		} else if ('+-*/^(),'.includes(c)) {
			tokens.push({ k: 'op', v: c })
			i++
		} else {
			throw new Error(`Unexpected character "${c}"`)
		}
	}
	return tokens
}

function parse(tokens: Token[]): Node {
	let pos = 0
	const peek = () => tokens[pos]
	const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v
	const expectOp = (v: string) => {
		if (!isOp(v)) throw new Error(`Expected "${v}"`)
		pos++
	}

	// expr := term (('+'|'-') term)*
	function expr(): Node {
		let a = term()
		while (isOp('+') || isOp('-')) {
			const op = tokens[pos++].v as '+' | '-'
			a = { t: 'bin', op, a, b: term() }
		}
		return a
	}
	// term := unary (('*'|'/'|implicit) unary)*
	function term(): Node {
		let a = unary()
		for (;;) {
			if (isOp('*') || isOp('/')) {
				const op = tokens[pos++].v as '*' | '/'
				a = { t: 'bin', op, a, b: unary() }
			} else if (peek() && (peek()!.k !== 'op' || peek()!.v === '(')) {
				// implicit multiplication: 2x, 3(x+1), x sin(x)
				a = { t: 'bin', op: '*', a, b: unary() }
			} else return a
		}
	}
	// unary := '-' unary | power
	function unary(): Node {
		if (isOp('-')) {
			pos++
			return { t: 'neg', a: unary() }
		}
		if (isOp('+')) {
			pos++
			return unary()
		}
		return power()
	}
	// power := atom ('^' unary)?   (right-associative)
	function power(): Node {
		const a = atom()
		if (isOp('^')) {
			pos++
			return { t: 'bin', op: '^', a, b: unary() }
		}
		return a
	}
	function atom(): Node {
		const tok = peek()
		if (!tok) throw new Error('Unexpected end of expression')
		if (tok.k === 'num') {
			pos++
			return { t: 'num', v: tok.v }
		}
		if (tok.k === 'id') {
			pos++
			if (tok.v === 'x') return { t: 'var' }
			if (tok.v in CONSTANTS) return { t: 'num', v: CONSTANTS[tok.v] }
			if (tok.v in FUNCTIONS) {
				expectOp('(')
				const args = [expr()]
				while (isOp(',')) {
					pos++
					args.push(expr())
				}
				expectOp(')')
				return { t: 'call', fn: tok.v, args }
			}
			throw new Error(`Unknown name "${tok.v}" (only x, constants and standard functions are allowed)`)
		}
		if (isOp('(')) {
			pos++
			const inner = expr()
			expectOp(')')
			return inner
		}
		throw new Error(`Unexpected "${tok.v}"`)
	}

	const root = expr()
	if (pos !== tokens.length) throw new Error(`Unexpected "${tokens[pos].v}"`)
	return root
}

function evaluate(n: Node, x: number): number {
	switch (n.t) {
		case 'num':
			return n.v
		case 'var':
			return x
		case 'neg':
			return -evaluate(n.a, x)
		case 'call':
			return FUNCTIONS[n.fn](...n.args.map((a) => evaluate(a, x)))
		case 'bin': {
			const a = evaluate(n.a, x)
			const b = evaluate(n.b, x)
			switch (n.op) {
				case '+':
					return a + b
				case '-':
					return a - b
				case '*':
					return a * b
				case '/':
					return a / b
				case '^':
					return Math.pow(a, b)
			}
		}
	}
}

/** Compile `expr` (a function of x). Throws a readable Error on invalid input. */
export function compileExpression(src: string): (x: number) => number {
	if (src.length > 200) throw new Error('Expression too long')
	const cleaned = src.replace(/^\s*(y|f\(x\))\s*=\s*/i, '')
	const ast = parse(tokenize(cleaned))
	return (x: number) => evaluate(ast, x)
}

/**
 * Sample a function across [x0, x1] into polyline runs, splitting at non-finite values
 * and at large jumps (asymptotes) so tan(x) doesn't draw vertical lines.
 */
export function sampleFunction(
	f: (x: number) => number,
	x0: number,
	x1: number,
	yLimit: [number, number],
	samples = 240
): Array<Array<[number, number]>> {
	const runs: Array<Array<[number, number]>> = []
	let run: Array<[number, number]> = []
	const span = yLimit[1] - yLimit[0]
	let prevY: number | null = null
	for (let i = 0; i <= samples; i++) {
		const x = x0 + ((x1 - x0) * i) / samples
		let y: number
		try {
			y = f(x)
		} catch {
			y = NaN
		}
		const outOfView = y < yLimit[0] - span * 2 || y > yLimit[1] + span * 2
		const jump = prevY !== null && Math.abs(y - prevY) > span * 1.5
		if (!Number.isFinite(y) || outOfView || jump) {
			if (run.length > 1) runs.push(run)
			run = []
			prevY = Number.isFinite(y) && !outOfView ? y : null
			if (prevY !== null) run.push([x, y])
			continue
		}
		run.push([x, y])
		prevY = y
	}
	if (run.length > 1) runs.push(run)
	return runs
}
