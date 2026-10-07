'use client'
import React, {
	useEffect,
	useContext,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore
} from 'react'
import {
	ReactFlow,
	NodeResizer,
	type Node,
	type NodeProps,
	type NodeChange,
	type Viewport,
	SelectionMode
} from '@xyflow/react'
import { getStroke } from 'perfect-freehand'
import { Editor, fontSize } from './editor'
import { EditorContext, ShapeUtil, useEditor, useValue } from './react'
import {
	createShapeId,
	inverse,
	renderPlaintextFromRichText,
	strokePoints,
	toRichText,
	transform,
	worldMatrix,
	type TLShape,
	type TLStoreSnapshot
} from './model'
import { checkpointBoard, loadBoard, saveBoard } from './persistence'
import { inkHex } from '@/lib/canvas/palette'
import { getBlobUrl } from '@/lib/storage/blobs'
import { loadHandFont } from '@/lib/canvas/hand'

type ShapeNode = Node<{ shape: TLShape; geometryKey: string }, 'shape'>
const strokeHitShape = (shape: TLShape) =>
	['arrow', 'line', 'draw', 'highlight'].includes(shape.type) ||
	(shape.type === 'geo' &&
		shape.meta.author === 'assistant' &&
		shape.props.fill === 'none')
const colors: Record<string, string> = {
	black: '#1c2230',
	yellow: '#edbd13',
	'light-blue': '#7bc4e9',
	'light-red': '#ed9693',
	'light-green': '#a1d894',
	'light-violet': '#b5a1de',
	white: '#fff'
}
const color = (name: string) => colors[name] ?? inkHex(name)
const strokeWidth = (size: string) =>
	({ s: 2, m: 3.5, l: 5, xl: 8 })[size] ?? 3.5
const dash = (value: string, width: number) =>
	value === 'dashed'
		? `${width * 4} ${width * 3}`
		: value === 'dotted'
			? `1 ${width * 3}`
			: undefined
function richNodes(value: any): React.ReactNode {
	if (!value) return null
	if (value.type === 'text') {
		let result: React.ReactNode = value.text
		for (const mark of value.marks ?? [])
			switch (mark.type) {
				case 'bold':
					result = <strong>{result}</strong>
					break
				case 'italic':
					result = <em>{result}</em>
					break
				case 'code':
					result = <code>{result}</code>
					break
				case 'underline':
					result = <u>{result}</u>
					break
				case 'strike':
					result = <s>{result}</s>
					break
			}
		return result
	}
	const children = (value.content ?? []).map((node: any, i: number) => (
		<React.Fragment key={i}>{richNodes(node)}</React.Fragment>
	))
	if (value.type === 'paragraph')
		return <p>{children.length ? children : <br />}</p>
	if (value.type === 'hardBreak') return <br />
	if (value.type === 'bulletList') return <ul>{children}</ul>
	if (value.type === 'orderedList') return <ol>{children}</ol>
	if (value.type === 'listItem') return <li>{children}</li>
	return children
}
function TextView({ shape }: { shape: TLShape }) {
	const editor = useEditor(),
		editing = useValue('edit', () => editor.editing === shape.id),
		ref = useRef<HTMLTextAreaElement>(null)
	const font =
		shape.props.font === 'sans'
			? 'sans-serif'
			: shape.props.font === 'serif'
				? 'serif'
				: shape.props.font === 'mono'
					? 'monospace'
					: 'Shantell Sans'
	const text = renderPlaintextFromRichText(
		shape.props.richText ?? toRichText(shape.props.text ?? '')
	)
	const style: React.CSSProperties = {
		fontSize: fontSize(shape.props.size),
		fontFamily: font,
		color: color(shape.props.color),
		width: shape.props.autoSize ? 'max-content' : shape.props.w,
		minWidth: 20,
		maxWidth: shape.props.autoSize ? 1200 : undefined,
		transform: `scale(${shape.props.scale ?? 1})`,
		transformOrigin: '0 0',
		whiteSpace: 'pre-wrap'
	}
	useEffect(() => {
		if (editing) {
			ref.current?.focus()
			ref.current?.select()
		}
	}, [editing])
	const commit = () => {
		if (ref.current) {
			editor.updateShape({
				id: shape.id,
				props: { richText: toRichText(ref.current.value) }
			})
			editor.setEditingShape(null)
		}
	}
	return (
		<div style={{ position: 'relative' }}>
			<div
				className="loci-rich-text loci-hand"
				style={{ ...style, visibility: editing ? 'hidden' : undefined }}
			>
				{richNodes(shape.props.richText ?? toRichText(shape.props.text ?? ''))}
			</div>
			{editing && (
				<textarea
					ref={ref}
					className="loci-text-editor nodrag nopan"
					aria-label="Edit canvas text"
					defaultValue={text}
					style={{
						...style,
						width: Math.max(200, shape.props.w ?? 200),
						minHeight:
							fontSize(shape.props.size) *
							1.4 *
							Math.max(2, text.split('\n').length),
						position: 'absolute',
						inset: 0,
						resize: 'both',
						background: '#fdfcfc',
						border: '1px solid #ddd',
						outline: 'none',
						lineHeight: 1.4,
						padding: 0
					}}
					onPointerDown={(e) => e.stopPropagation()}
					onBlur={commit}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (
							e.key === 'Escape' ||
							(e.key === 'Enter' && (e.ctrlKey || e.metaKey))
						) {
							e.preventDefault()
							commit()
						}
					}}
				/>
			)}
		</div>
	)
}
function NativeImage({ shape }: { shape: TLShape }) {
	const editor = useEditor(),
		asset = editor.resolveAsset(shape.props.assetId),
		crop = shape.props.crop,
		p = shape.props
	const [url, setUrl] = useState<string>()
	useEffect(() => {
		let live = true
		setUrl(undefined)
		if (asset?.props?.blobKey)
			getBlobUrl(asset.props.blobKey)
				.then((url) => {
					if (live) setUrl(url)
				})
				.catch(() => {})
		return () => {
			live = false
		}
	}, [asset?.props?.blobKey])
	const src =
		url ?? (!asset?.props?.blobKey ? (asset?.props?.src ?? p.src) : undefined)
	if (!src || src.startsWith('asset:'))
		return <div className="loci-material__missing">Loading image…</div>
	return (
		<div style={{ width: p.w, height: p.h, overflow: 'hidden' }}>
			<img
				src={src}
				alt={asset?.props?.name ?? 'Image'}
				draggable={false}
				style={{
					width: crop
						? `${100 / Math.max(0.001, crop.bottomRight.x - crop.topLeft.x)}%`
						: '100%',
					height: crop
						? `${100 / Math.max(0.001, crop.bottomRight.y - crop.topLeft.y)}%`
						: '100%',
					maxWidth: 'none',
					transform: crop
						? `translate(${-crop.topLeft.x * 100}%,${-crop.topLeft.y * 100}%)`
						: undefined,
					objectFit: 'fill'
				}}
			/>
		</div>
	)
}
function NativeShape({ shape }: { shape: TLShape }) {
	const editor = useEditor(),
		p = shape.props,
		b = editor.getShapeGeometry(shape).bounds,
		ink = color(p.color),
		width = strokeWidth(p.size),
		label = renderPlaintextFromRichText(p.richText)
	if (shape.type === 'text' || shape.type === 'note')
		return <TextView shape={shape} />
	if (shape.type === 'image') return <NativeImage shape={shape} />
	if (shape.type === 'group') return <div style={{ width: b.w, height: b.h }} />
	let paths: React.ReactNode
	if (shape.type === 'draw' || shape.type === 'highlight') {
		try {
			const points = strokePoints(shape)
			const outline = getStroke(points, {
				size: shape.type === 'highlight' ? width * 5 : width * 2,
				thinning: shape.type === 'highlight' ? 0 : 0.5,
				smoothing: 0.5,
				simulatePressure: p.isPen === false,
				last: p.isComplete !== false
			})
			paths = (
				<path
					d={
						outline.length
							? `M ${outline.map((v) => v.join(',')).join(' L ')} Z`
							: ''
					}
					fill={ink}
					opacity={shape.type === 'highlight' ? 0.35 : 1}
				/>
			)
		} catch {
			return (
				<div role="alert">
					Saved stroke could not be decoded. Original data is retained.
				</div>
			)
		}
	} else if (shape.type === 'arrow') {
		const { start, end } = editor.arrowEnds(shape),
			dx = end.x - start.x,
			dy = end.y - start.y,
			length = Math.hypot(dx, dy) || 1,
			bend = p.bend ?? 0,
			c = {
				x: (start.x + end.x) / 2 - (dy / length) * bend,
				y: (start.y + end.y) / 2 + (dx / length) * bend
			}
		const head = (
			at: { x: number; y: number },
			from: { x: number; y: number },
			kind: string
		) => {
			if (!kind || kind === 'none') return null
			const a = Math.atan2(at.y - from.y, at.x - from.x),
				s = width * 4 + 6
			return kind === 'dot' ? (
				<circle cx={at.x} cy={at.y} r={s / 3} fill={ink} />
			) : (
				<path
					d={`M ${at.x - Math.cos(a - 0.45) * s} ${at.y - Math.sin(a - 0.45) * s} L ${at.x} ${at.y} L ${at.x - Math.cos(a + 0.45) * s} ${at.y - Math.sin(a + 0.45) * s}`}
					fill={kind === 'triangle' ? ink : 'none'}
					stroke={ink}
					strokeWidth={width}
				/>
			)
		}
		paths = (
			<>
				<path
					d={`M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`}
					fill="none"
					stroke={ink}
					strokeWidth={width}
					strokeDasharray={dash(p.dash, width)}
				/>
				{head(end, c, p.arrowheadEnd)}
				{head(start, c, p.arrowheadStart)}
				{label && (
					<text
						x={c.x}
						y={c.y - 8}
						textAnchor="middle"
						fill={ink}
						fontSize={fontSize(p.size)}
						fontFamily="Shantell Sans"
					>
						{label}
					</text>
				)}
			</>
		)
	} else if (shape.type === 'line') {
		const pts = Object.values(p.points ?? {}) as { x: number; y: number }[]
		paths = (
			<polyline
				points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
				fill="none"
				stroke={ink}
				strokeWidth={width}
				strokeDasharray={dash(p.dash, width)}
			/>
		)
	} else if (shape.type === 'geo') {
		const fill = p.fill === 'none' ? 'none' : ink
		const common = {
			fill,
			fillOpacity: p.fill === 'solid' ? 1 : 0.12,
			stroke: ink,
			strokeWidth: width,
			strokeDasharray: dash(p.dash, width)
		}
		const w = p.w,
			h = p.h + (p.growY ?? 0)
		paths = (
			<>
				{p.geo === 'ellipse' ? (
					<ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
				) : p.geo === 'triangle' ? (
					<polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...common} />
				) : p.geo === 'diamond' ? (
					<polygon
						points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
						{...common}
					/>
				) : (
					<rect
						width={w}
						height={h}
						rx={p.geo === 'cloud' ? 16 : 2}
						{...common}
					/>
				)}{' '}
				{label && (
					<foreignObject
						x={8}
						y={8}
						width={Math.max(1, w - 16)}
						height={Math.max(1, h - 16)}
					>
						<div
							className="loci-rich-text loci-hand"
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: '100%',
								color: ink,
								fontSize: fontSize(p.size)
							}}
						>
							{richNodes(p.richText)}
						</div>
					</foreignObject>
				)}
			</>
		)
	} else
		return (
			<div className="loci-unsupported" role="status">
				Unsupported saved {shape.type}. Original data retained.
			</div>
		)
	return (
		<svg
			width={Math.max(1, b.w)}
			height={Math.max(1, b.h)}
			viewBox={`${b.x} ${b.y} ${Math.max(1, b.w)} ${Math.max(1, b.h)}`}
			data-hit-strokes={strokeHitShape(shape) || undefined}
			style={{
				overflow: 'visible',
				display: 'block',
				pointerEvents: strokeHitShape(shape) ? 'none' : undefined
			}}
		>
			{paths}
		</svg>
	)
}
const CanvasNode = React.memo(
	function CanvasNode({ data, selected }: NodeProps<ShapeNode>) {
		const editor = useEditor(),
			readonly = useValue('node-readonly', () => editor.getIsReadonly()),
			shape = data.shape,
			b = editor.getShapeGeometry(shape).bounds,
			m = worldMatrix(shape, editor.records),
			angle = Math.atan2(m[1], m[0]),
			renderer = editor.renderers.get(shape.type)
		return (
			<>
				{selected &&
					renderer?.resizable !== false &&
					!readonly &&
					!['draw', 'highlight', 'arrow', 'line', 'text'].includes(
						shape.type
					) && (
						<NodeResizer
							isVisible
							keepAspectRatio={renderer?.aspect}
							minWidth={20}
							minHeight={20}
							onResizeStart={() => editor.markHistoryStoppingPoint('resize')}
							onResize={(_e, params) => {
								const parent = editor.getShapeParent(shape),
									point = transform(
										parent
											? inverse(worldMatrix(parent, editor.records))
											: [1, 0, 0, 1, 0, 0],
										params
									)
								editor.resizeShape(shape.id, params.width, params.height, point)
							}}
						/>
					)}
				<div
					className="loci-shape"
					data-shape-id={shape.id}
					style={{
						width: Math.max(1, b.w),
						height: Math.max(1, b.h),
						opacity: shape.opacity,
						transform: `rotate(${angle}rad)`,
						transformOrigin: '0 0'
					}}
					onDoubleClick={() => {
						if (shape.type === 'group' && !readonly) {
							editor.select(
								...editor
									.getCurrentPageShapes()
									.filter((s) => s.parentId === shape.id)
									.map((s) => s.id)
							)
							return
						}
						if (
							!readonly &&
							(renderer?.editable ||
								shape.type === 'text' ||
								shape.type === 'note')
						) {
							editor.markHistoryStoppingPoint('edit')
							editor.setEditingShape(shape.id)
						}
					}}
				>
					{renderer ? renderer.component(shape) : <NativeShape shape={shape} />}
				</div>
			</>
		)
	},
	(a, b) =>
		a.selected === b.selected &&
		a.data.shape === b.data.shape &&
		a.data.geometryKey === b.data.geometryKey
)
const nodeTypes = { shape: CanvasNode }
export interface WhiteboardProps {
	persistenceKey?: string
	snapshot?: TLStoreSnapshot
	shapeUtils?: Array<typeof ShapeUtil<any>>
	onMount?: (editor: Editor) => void
	components?: {
		InFrontOfTheCanvas?: React.ComponentType
		StylePanel?: React.ComponentType
	}
	hideUi?: boolean
	children?: React.ReactNode
}
export function Whiteboard({
	persistenceKey,
	snapshot,
	shapeUtils = [],
	onMount,
	components,
	hideUi,
	children
}: WhiteboardProps) {
	const assetSource = useContext(EditorContext)
	const [editor] = useState(() => {
		const e = new Editor()
		e.assetSource = assetSource ?? undefined
		for (const Util of shapeUtils) {
			const util = new Util(e)
			e.renderers.set(Util.type, {
				type: Util.type,
				defaults: util.getDefaultProps(),
				geometry: (s) => util.getGeometry(s),
				component: (s) => util.component(s),
				aspect: util.isAspectRatioLocked(),
				editable: util.canEdit(),
				resizable: util.canResize()
			})
		}
		if (snapshot) e.loadSnapshot(snapshot)
		return e
	})
	const [ready, setReady] = useState(!persistenceKey),
		[error, setError] = useState(''),
		root = useRef<HTMLDivElement>(null),
		mounted = useRef(false)
	useSyncExternalStore(editor.subscribe, editor.getVersion, () => 0)
	useEffect(() => {
		let cancelled = false
		if (persistenceKey)
			loadBoard(persistenceKey)
				.then((saved) => {
					if (cancelled) return
					if (saved) {
						editor.loadSnapshot(saved.snapshot)
						editor.camera = saved.camera
						if (saved.pageId) editor.pageId = saved.pageId
					}
					setReady(true)
				})
				.catch(() => {
					if (!cancelled)
						setError(
							'Could not open saved board. Your saved data has been retained. Refresh to retry.'
						)
				})
		return () => {
			cancelled = true
		}
	}, [editor, persistenceKey])
	useEffect(() => {
		if (!ready || !root.current) return
		editor.container = root.current
		root.current
			.querySelector('.react-flow__viewport')
			?.classList.add('loci-capture-layer')
		void loadHandFont()
		if (!mounted.current) {
			mounted.current = true
			onMount?.(editor)
		}
	}, [editor, ready, onMount])
	useEffect(() => {
		if (!ready || !persistenceKey) return
		let timer: ReturnType<typeof setTimeout>
		let writes = Promise.resolve()
		const persist = (checkpoint = false) => {
			const saved = {
				snapshot: editor.store.getStoreSnapshot(),
				camera: editor.camera,
				pageId: editor.pageId
			}
			if (checkpoint) {
				try {
					checkpointBoard(persistenceKey, saved)
				} catch {
					/* Durable saving below can still succeed when checkpoint storage is full. */
				}
			}
			writes = writes
				.catch(() => {})
				.then(() => saveBoard(persistenceKey, saved))
				.catch(() =>
					setError(
						'Browser storage is unavailable. This board has unsaved changes.'
					)
				)
		}
		persist() // Finish a successful legacy import even when the board is not edited.
		const stop = editor.store.listen(
			() => {
				clearTimeout(timer)
				timer = setTimeout(() => persist(), 150)
			},
			{ scope: 'all' }
		)
		const flush = () => {
			clearTimeout(timer)
			persist(true)
		}
		window.addEventListener('pagehide', flush)
		return () => {
			stop()
			window.removeEventListener('pagehide', flush)
			flush()
		}
	}, [editor, ready, persistenceKey])
	useEffect(() => {
		if (!ready) return
		const key = (event: KeyboardEvent) => {
			if (
				!root.current?.contains(document.activeElement) &&
				document.activeElement !== document.body
			)
				return
			if (
				(event.target as HTMLElement)?.closest(
					'input,textarea,select,[contenteditable="true"]'
				)
			)
				return
			if (editor.getIsReadonly()) return
			const accel = event.metaKey || event.ctrlKey
			if (accel && event.key.toLowerCase() === 'z') {
				event.preventDefault()
				event.shiftKey ? editor.redo() : editor.undo()
				return
			}
			if (accel && event.key.toLowerCase() === 'y') {
				event.preventDefault()
				editor.redo()
				return
			}
			if (accel && event.key.toLowerCase() === 'g') {
				event.preventDefault()
				event.shiftKey ? editor.ungroupShapes() : editor.groupShapes()
				return
			}
			if (accel && event.key.toLowerCase() === 'a') {
				event.preventDefault()
				editor.select(...editor.getCurrentPageShapeIds())
				return
			}
			if (event.key === 'Backspace' || event.key === 'Delete') {
				event.preventDefault()
				editor.markHistoryStoppingPoint('delete')
				editor.deleteShapes(editor.selected)
				return
			}
			if (event.key === 'Escape') {
				editor.setEditingShape(null)
				editor.selectNone()
				editor.setCurrentTool('select')
				return
			}
			const tool: Record<string, string> = {
				v: 'select',
				h: 'hand',
				d: 'draw',
				t: 'text',
				r: 'geo',
				a: 'arrow',
				e: 'eraser',
				q: 'loci-region'
			}
			if (!accel && !event.altKey && tool[event.key.toLowerCase()])
				editor.setCurrentTool(tool[event.key.toLowerCase()])
		}
		window.addEventListener('keydown', key)
		return () => window.removeEventListener('keydown', key)
	}, [editor, ready])
	const nodeData = useRef(new Map<string, ShapeNode['data']>())
	const nodes: ShapeNode[] = useMemo(() => {
		for (const id of nodeData.current.keys())
			if (!editor.records[id]) nodeData.current.delete(id)
		return editor.getCurrentPageShapesSorted().map((shape, order) => {
			const b = editor.getShapeGeometry(shape).bounds,
				m = worldMatrix(shape, editor.records),
				point = transform(m, { x: b.x, y: b.y })
			// Parent rotation, group bounds and bound arrow targets can change without
			// replacing the shape itself. Include their visual dependencies in the key.
			const geometryKey = JSON.stringify([
				b.x,
				b.y,
				b.w,
				b.h,
				Math.atan2(m[1], m[0]),
				shape.type === 'arrow' ? editor.arrowEnds(shape) : null,
				shape.type === 'image' ? editor.resolveAsset(shape.props.assetId) : null
			])
			let data = nodeData.current.get(shape.id)
			if (!data || data.shape !== shape || data.geometryKey !== geometryKey) {
				data = { shape, geometryKey }
				nodeData.current.set(shape.id, data)
			}
			return {
				id: shape.id,
				type: 'shape',
				position: point,
				data,
				style: {
					width: Math.max(1, b.w),
					height: Math.max(1, b.h),
					zIndex: order,
					// Tutor annotations must not intercept clicks through transparent bounds.
					pointerEvents:
						['loci-highlight', 'loci-region'].includes(shape.type) ||
						strokeHitShape(shape)
							? 'none'
							: undefined
				},
				selected: editor.selected.includes(shape.id),
				draggable:
					!editor.getIsReadonly() &&
					!editor.isShapeOrAncestorLocked(shape) &&
					editor.tool === 'select',
				selectable: editor.tool === 'select' && !editor.getIsReadonly()
			}
		})
	}, [
		editor,
		editor.records,
		editor.selected,
		editor.tool,
		editor.readonlyState
	])
	const viewport: Viewport = {
		x: editor.camera.x * editor.camera.z,
		y: editor.camera.y * editor.camera.z,
		zoom: editor.camera.z
	}
	const touchPointers = useRef(new Map<number, { x: number; y: number }>())
	const pinch = useRef<{
		distance: number
		zoom: number
		anchor: { x: number; y: number }
	} | null>(null)
	const gesture = useRef<{
		mark: string
		id: string
		start: { x: number; y: number }
		tool: string
		points: { x: number; y: number; z: number }[]
	} | null>(null)
	const bindEndpoint = (
		id: string,
		terminal: 'start' | 'end',
		point: { x: number; y: number }
	) => {
		const target = editor.getShapeAtPoint(point, {
			exclude: [
				id,
				...editor
					.getCurrentPageShapes()
					.filter((s) =>
						[
							'arrow',
							'draw',
							'line',
							'highlight',
							'loci-highlight',
							'loci-region'
						].includes(s.type)
					)
					.map((s) => s.id)
			]
		})
		if (
			!target ||
			[
				'arrow',
				'draw',
				'line',
				'highlight',
				'loci-highlight',
				'loci-region'
			].includes(target.type)
		)
			return
		const b = editor.getShapeGeometry(target).bounds,
			p = transform(inverse(worldMatrix(target, editor.records)), point)
		editor.createBindings([
			{
				fromId: id,
				toId: target.id,
				props: {
					terminal,
					normalizedAnchor: {
						x: (p.x - b.x) / Math.max(1, b.w),
						y: (p.y - b.y) / Math.max(1, b.h)
					},
					isExact: true,
					isPrecise: true
				}
			}
		])
	}
	const drawDown = (event: React.PointerEvent) => {
		if (
			editor.getIsReadonly() ||
			!['draw', 'geo', 'arrow', 'text', 'loci-region', 'eraser'].includes(
				editor.tool
			) ||
			event.button !== 0 ||
			event.ctrlKey ||
			event.altKey
		)
			return
		if (
			(event.target as HTMLElement).closest(
				'input,textarea,select,button,[contenteditable="true"],.loci-toolbar,.loci-dock'
			)
		)
			return
		if (event.pointerType === 'touch') {
			touchPointers.current.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY
			})
			if (touchPointers.current.size > 1) {
				// A second finger turns drawing into a pinch. Restore the document
				// before this gesture and track a pinch around its page-space anchor.
				if (gesture.current) editor.bailToMark(gesture.current.mark)
				gesture.current = null
				const [a, b] = [...touchPointers.current.values()]
				pinch.current = {
					distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
					zoom: editor.camera.z,
					anchor: editor.screenToPage({
						x: (a.x + b.x) / 2,
						y: (a.y + b.y) / 2
					})
				}
				event.stopPropagation()
				event.preventDefault()
				root.current?.setPointerCapture(event.pointerId)
				return
			}
		}
		event.stopPropagation()
		event.preventDefault()
		root.current?.setPointerCapture(event.pointerId)
		const start = editor.screenToPage({ x: event.clientX, y: event.clientY }),
			tool = editor.tool,
			id = createShapeId()
		const mark = editor.markHistoryStoppingPoint(tool)
		if (tool === 'eraser') {
			const target = editor.getShapeAtPoint(start)
			if (target && !editor.isShapeOrAncestorLocked(target))
				editor.deleteShapes([target.id])
		} else {
			editor.createShape({
				id,
				type: tool === 'loci-region' ? 'loci-region' : tool,
				x: start.x,
				y: start.y,
				props:
					tool === 'draw'
						? {
								segments: [
									{
										type: 'free',
										points: [{ x: 0, y: 0, z: event.pressure || 0.5 }]
									}
								],
								isPen: event.pointerType === 'pen',
								isComplete: false
							}
						: tool === 'arrow'
							? { end: { x: 1, y: 1 } }
							: tool === 'text'
								? { richText: toRichText(''), autoSize: true }
								: { w: 1, h: 1 }
			})
			if (tool === 'arrow') bindEndpoint(id, 'start', start)
			editor.select(id)
		}
		gesture.current = {
			mark,
			id,
			start,
			tool,
			points: [{ x: 0, y: 0, z: event.pressure || 0.5 }]
		}
	}
	const drawMove = (event: React.PointerEvent) => {
		if (touchPointers.current.has(event.pointerId))
			touchPointers.current.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY
			})
		if (pinch.current && touchPointers.current.size >= 2) {
			const [a, b] = [...touchPointers.current.values()],
				p = pinch.current,
				z = Math.max(
					0.05,
					Math.min(8, (p.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / p.distance)
				),
				rect = root.current!.getBoundingClientRect()
			editor.setCamera({
				x: ((a.x + b.x) / 2 - rect.left) / z - p.anchor.x,
				y: ((a.y + b.y) / 2 - rect.top) / z - p.anchor.y,
				z
			})
			return
		}
		const g = gesture.current
		if (!g) return
		const point = editor.screenToPage({ x: event.clientX, y: event.clientY }),
			dx = point.x - g.start.x,
			dy = point.y - g.start.y
		if (g.tool === 'draw') {
			g.points.push({ x: dx, y: dy, z: event.pressure || 0.5 })
			editor.updateShape({
				id: g.id,
				props: { segments: [{ type: 'free', points: [...g.points] }] }
			})
		} else if (g.tool === 'arrow')
			editor.updateShape({ id: g.id, props: { end: { x: dx, y: dy } } })
		else if (g.tool === 'eraser') {
			const target = editor.getShapeAtPoint(point)
			if (target && !editor.isShapeOrAncestorLocked(target))
				editor.deleteShapes([target.id])
		} else if (g.tool !== 'text')
			editor.updateShape({
				id: g.id,
				x: Math.min(g.start.x, point.x),
				y: Math.min(g.start.y, point.y),
				props: { w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) }
			})
	}
	const drawUp = (event: React.PointerEvent) => {
		touchPointers.current.delete(event.pointerId)
		if (touchPointers.current.size < 2) pinch.current = null
		if (root.current?.hasPointerCapture(event.pointerId))
			root.current.releasePointerCapture(event.pointerId)
		const g = gesture.current
		if (!g) return
		gesture.current = null
		if (g.tool === 'draw')
			editor.updateShape({ id: g.id, props: { isComplete: true } })
		if (g.tool === 'arrow')
			bindEndpoint(
				g.id,
				'end',
				editor.screenToPage({ x: event.clientX, y: event.clientY })
			)
		if (g.tool === 'text') {
			editor.setCurrentTool('select')
			editor.setEditingShape(g.id)
		}
		if (g.tool === 'loci-region') {
			editor.setCurrentTool('select')
			window.dispatchEvent(new CustomEvent('loci:focus-prompt'))
		}
	}
	const changes = (changes: NodeChange<ShapeNode>[]) => {
		const positions = changes.filter((c) => c.type === 'position')
		if (positions.length)
			editor.run(() =>
				positions.forEach((c) => {
					if (c.type !== 'position' || !c.position) return
					const s = editor.getShape(c.id)
					if (!s) return
					const b = editor.getShapeGeometry(s).bounds,
						m = worldMatrix(s, editor.records),
						angle = Math.atan2(m[1], m[0]),
						origin = {
							x: c.position.x - (Math.cos(angle) * b.x - Math.sin(angle) * b.y),
							y: c.position.y - (Math.sin(angle) * b.x + Math.cos(angle) * b.y)
						},
						parent = editor.getShapeParent(s),
						p = transform(
							parent
								? inverse(worldMatrix(parent, editor.records))
								: [1, 0, 0, 1, 0, 0],
							origin
						)
					editor.updateShape({ id: s.id, x: p.x, y: p.y })
				})
			)
		const selections = changes.filter((c) => c.type === 'select')
		if (selections.length) {
			const next = new Set(editor.selected)
			for (const c of selections)
				if (c.type === 'select') c.selected ? next.add(c.id) : next.delete(c.id)
			if ([...next].join('|') !== editor.selected.join('|'))
				editor.select(...next)
		}
	}
	const foreground = components?.InFrontOfTheCanvas,
		Styles = components?.StylePanel
	if (error && !ready)
		return (
			<div role="alert" className="loci-loading">
				{error}
			</div>
		)
	if (!ready) return <div className="loci-loading">Opening your board…</div>
	return (
		<EditorContext.Provider value={editor}>
			<div
				ref={(element) => {
					root.current = element
					editor.container = element
				}}
				className="loci-whiteboard"
				tabIndex={0}
				aria-label="Whiteboard"
				onPointerDownCapture={drawDown}
				onPointerMove={drawMove}
				onPointerUp={drawUp}
				onPointerCancel={drawUp}
				onDragOver={(e) => e.preventDefault()}
				onDrop={(e) => {
					e.preventDefault()
					if (e.dataTransfer.files.length)
						void editor.externalFiles?.({
							files: Array.from(e.dataTransfer.files)
						})
				}}
				onCopy={(e) => {
					if (
						(e.target as HTMLElement).closest(
							'input,textarea,select,[contenteditable="true"]'
						) ||
						!editor.selected.length
					)
						return
					const records = editor.copyRecords()
					e.clipboardData.setData(
						'application/x-loci-shapes',
						JSON.stringify(records)
					)
					e.clipboardData.setData(
						'text/plain',
						editor
							.getSelectedShapes()
							.map((s) => renderPlaintextFromRichText(s.props.richText))
							.filter(Boolean)
							.join('\n')
					)
					e.preventDefault()
				}}
				onPaste={(e) => {
					if (editor.getIsReadonly()) return
					if (e.clipboardData.files.length) {
						e.preventDefault()
						e.stopPropagation()
						void editor.externalFiles?.({
							files: Array.from(e.clipboardData.files)
						})
						return
					}
					if (
						(e.target as HTMLElement).closest(
							'input,textarea,select,[contenteditable="true"]'
						)
					)
						return
					const raw = e.clipboardData.getData('application/x-loci-shapes')
					if (raw) {
						try {
							editor.pasteRecords(JSON.parse(raw))
							e.preventDefault()
						} catch {
							setError('Could not paste those canvas objects.')
						}
						return
					}
					const text = e.clipboardData.getData('text/plain')
					if (text) {
						const bounds = editor.getViewportPageBounds()
						const id = createShapeId()
						editor.markHistoryStoppingPoint('paste text')
						editor.createShape({
							id,
							type: 'text',
							x: bounds.x + bounds.w / 2,
							y: bounds.y + bounds.h / 2,
							props: { richText: toRichText(text), autoSize: false, w: 400 }
						})
						editor.select(id)
						e.preventDefault()
					}
				}}
			>
				<ReactFlow<ShapeNode>
					nodes={nodes}
					edges={[]}
					nodeTypes={nodeTypes}
					viewport={viewport}
					onMove={(_event, v) => {
						if (
							v.x !== viewport.x ||
							v.y !== viewport.y ||
							v.zoom !== viewport.zoom
						)
							editor.setCamera({ x: v.x / v.zoom, y: v.y / v.zoom, z: v.zoom })
					}}
					onNodesChange={changes}
					onNodeDragStart={() => editor.markHistoryStoppingPoint('move')}
					onPaneClick={() => {
						if (editor.tool === 'select') editor.selectNone()
					}}
					panOnDrag={
						editor.tool === 'hand' || editor.tool === 'select'
							? [0, 1, 2]
							: [1, 2]
					}
					selectionKeyCode="Shift"
					multiSelectionKeyCode={['Meta', 'Control']}
					selectionMode={SelectionMode.Partial}
					deleteKeyCode={null}
					minZoom={0.05}
					maxZoom={8}
					onlyRenderVisibleElements={false}
					nodesConnectable={false}
					zoomOnDoubleClick={false}
     panOnScroll
     panOnScrollSpeed={1}
     zoomOnScroll={false}
     zoomActivationKeyCode={['Meta', 'Control']}
					zoomOnPinch={
						!['draw', 'geo', 'arrow', 'text', 'loci-region', 'eraser'].includes(
							editor.tool
						)
					}
					preventScrolling
				>
					{!hideUi && foreground && React.createElement(foreground)}
				</ReactFlow>
				{!hideUi && Styles && <Styles />}
				{error && (
					<p className="loci-toast" role="alert">
						{error}
					</p>
				)}
				{children}
			</div>
		</EditorContext.Provider>
	)
}
