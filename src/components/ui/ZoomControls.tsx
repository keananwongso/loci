'use client'
import { useEditor, useValue } from '@/lib/whiteboard'
export function ZoomControls() {
 const editor = useEditor()
 const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])
 const change = (next: number) => {
  const camera = editor.getCamera(), screen = editor.getViewportScreenBounds()
  const z = Math.max(.05, Math.min(8, next))
  const center = {x:screen.w / (2 * camera.z) - camera.x, y:screen.h / (2 * camera.z) - camera.y}
  editor.setCamera({x:screen.w / (2*z) - center.x,y:screen.h / (2*z) - center.y,z})
 }
 return <nav className="loci-zoom-controls" aria-label="Board zoom" onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
  <button aria-label="Zoom out" disabled={zoom <= .05} onClick={()=>change(zoom / 1.25)}>−</button><button aria-label="Reset zoom to 100 percent" title="Scroll to pan. Pinch or hold Ctrl/⌘ while scrolling to zoom." onClick={()=>change(1)}>{Math.round(zoom*100)}%</button><button aria-label="Zoom in" disabled={zoom >= 8} onClick={()=>change(zoom*1.25)}>＋</button>
 </nav>
}
