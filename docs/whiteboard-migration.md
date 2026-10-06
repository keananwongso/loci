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
- Vitest: 203 tests passed, one skipped. Migration tests cover original database
  preservation, asset import, lesson seeking, grouping, bindings, and history.
- Chrome with the mock tutor: all 23 self-test actions passed after loading the
  sample PDF. Drawing, text edits and reload, bound arrows, resizing, grouping,
  copy/paste, undo/redo, and lesson start/end seeking were exercised.
- Exported tutor screenshots were visually inspected with PDF, math, graph, table,
  and pen content. A 300-object board supported pan/zoom without console errors;
  this was a smoke test, not a measured performance benchmark.

The branch has a Vercel preview deployment; production has not been changed. An
authenticated cloud round trip has not been tested live. Physical-device Safari,
Pencil behavior, and multiplayer remain unverified.

## Follow-up UI testing

An independent Chrome pass reproduced and fixed four issues: unnecessary rendering
of unchanged shapes, unlimited undo and cancellation snapshots, a fractional final
playhead value that could miss the last deletion, and a rapid reload outrunning the
debounced save. Shape rendering now uses stable data and memoization, subscriptions
compare their selected values, history retains 100 steps/marks, and an unload
checkpoint recovers pending saves before normal IndexedDB persistence resumes.
Tutor annotations let pointer events reach the material beneath them; native ink
and connectors hit their painted strokes rather than their empty SVG viewport.

For a board containing 300 text/rectangle objects and 40 equations, 30 updates to
one equation produced 4,800 equation renderer calls before the fix and 60 after it
in React's development Strict Mode. This counts renderer calls, not frame rate or
production performance. Offscreen shapes stay mounted for measurement and export.

The follow-up exercised pen selection/erase/undo, bound arrows following a moved
box, resizing, grouping/ungrouping, copy/paste and undo, text edits and immediate
reload, equation editing under annotations, pan/zoom, area selection, and all 23
mock tutor actions. Replay Home/End seeking matched the live document at completion
and replay keyboard input left the live board intact. Final Chrome console had no
errors. Browser screenshots are in the ignored `output/playwright/ui-audit-*.png`
files in the implementation worktree.

## Pre-merge follow-up

Rebased onto freshly fetched `origin/main` at `d047e0e` and formatted the new
whiteboard files with tabs, single quotes, and no semicolons to match the repo.
Chrome phone (393 by 659) and tablet (768 by 1024) touch emulation exercised sample
PDF loading, pen drawing, one-finger panning, and pinch zoom. A pinch with the pen
selected originally left unwanted strokes. Drawing tools now cancel the unfinished
edit when the second finger arrives and zoom around the gesture's page-space
anchor. Pinching leaves shape counts unchanged, and a subsequent single-finger
stroke still works. Desktop mouse drawing and undo were checked again.

The phone opening screen now leaves space for the tool rail and prompt dock.
These checks use Chrome touch emulation, not physical iOS hardware. A real phone
check and an authenticated save/reload against the preview are still required
before merging. Preview access follows the project's existing Vercel protection.

## Dependencies and licensing

React Flow, perfect-freehand, and html-to-image are MIT-licensed. The bundled
Shantell Sans font uses the SIL Open Font License. React Flow attribution remains
visible. No commercial canvas key or vendor CDN is needed by this implementation.
