# Desktop whiteboard migration

Loci now uses React Flow for the desktop canvas surface, perfect-freehand for ink,
and a Loci-owned document, editor, history, and persistence layer. The tldraw runtime
and assets packages are removed. The existing tutor action protocol and six custom
shape renderers remain integrated with the new editor.

## Compatibility

The first load reads existing tldraw IndexedDB documents and session state without
modifying the source databases. Native image blobs move into Loci's existing blob
store; new document snapshots use `loci-documents`. IDs, unknown records, pages,
bindings, and rich text are retained. Known native shapes render through the new
surface; unsupported shape types display a placeholder rather than being discarded.
Native styling is approximate, so this is not a promise of pixel-identical rendering.

Existing version 1 lessons replay through the same record-diff protocol. New lessons
use version 2 and record the active page. Playback is read-only and isolated from
the live board. Audio and material blob keys retain their existing format.

Desktop tools include selection, pan/zoom, pen, text, geometry, bound arrows, eraser,
ask regions, resize, grouping, clipboard, styles, and undo/redo. Tutor camera control,
PDF materials, equations, graphs, tables, highlights, and screenshot export use the
new editor. Device import uploads migrated image assets before saving the account
snapshot.

## Validation

- TypeScript check and optimized production build passed.
- Vitest: 200 tests passed, one skipped. Migration tests cover original database
  preservation, asset import, lesson seeking, grouping, bindings, and history.
- Chrome with the mock tutor: all 23 self-test actions passed after loading the
  sample PDF. Drawing, text edits and reload, bound arrows, resizing, grouping,
  copy/paste, undo/redo, and lesson start/end seeking were exercised.
- Exported tutor screenshots were visually inspected with PDF, math, graph, table,
  and pen content. A 300-object board supported pan/zoom without console errors;
  this was a smoke test, not a measured performance benchmark.

The change has not been deployed. An authenticated cloud round trip has not been
tested live. Tablet/Pencil behavior and multiplayer are outside this desktop scope.

## Dependencies and licensing

React Flow, perfect-freehand, and html-to-image are MIT-licensed. The bundled
Shantell Sans font uses the SIL Open Font License. React Flow attribution remains
visible. No commercial canvas key or vendor CDN is needed by this implementation.
