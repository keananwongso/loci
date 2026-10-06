# Teach a topic from sources

Design notes, 6 October 2026. The initial implementation now includes multiple
materials, public links, editable outlines, objective-by-objective teaching, source
navigation and saved checkpoints. Lazy rendering, scan OCR, hosted indexing and
semantic retrieval remain future work; see `docs/guide.md` for current limits.
Branch: `codex/feat/use-notes-as-topic-explainer`.

## Product idea

Upload lecture notes and a syllabus, or paste a public article/PDF link. Ask
“Teach me eigenvectors from these notes.” Loci proposes an editable path through
the topic, then teaches one section at a time on the shared board. Interrupt,
ask why, change an example, try a problem, skip a section, or resume later.

Whole-topic coverage belongs to the lesson plan. Each teaching turn stays small
enough to follow and interrupt. Completion means the agreed objectives were
covered; evidence from practice is tracked separately from coverage.

Suggested controls: Teach me / Quick overview / Practise; Start / Continue /
Explain another way / Skip. Avoid asking the learner to configure a lesson before
they can begin. Offer a sensible outline with optional pace and depth controls.

Example path: vectors and transformations → eigenvector intuition → eigenvalue
meaning → finding them → repeated eigenvalues → practice. Exact scope comes from
the uploaded syllabus and notes, not this generic example.

## Existing infrastructure and gaps

- `src/lib/documents/pdf.ts`: browser PDF rendering and positioned text extraction;
  currently limited to the first 40 pages. Scanned PDF pages do not use the image
  OCR path automatically.
- `src/lib/canvas/ingest.ts`: creates a material shape for every imported page,
  groups pages by a document ID, and assigns notes/syllabus/exercises/mark-scheme
  roles. Image uploads have background OCR.
- `src/lib/canvas/serialize.ts`: sends detailed text for up to three focused
  materials, ~300-character previews for other notes, and bounded reference text
  for off-screen syllabus/mark-scheme pages. This is view-oriented context, not
  an index of the complete course.
- `src/app/api/tutor/route.ts` and `src/lib/tutor/session.ts`: provider abstraction,
  streamed speech/drawing actions, schema validation, and live board checks.
- `src/lib/tutor/prompt.ts`: already teaches one idea visually and checks
  understanding. Topic teaching needs explicit objectives and navigation state.
- `src/components/useTutor.ts`: turn cancellation, voice, and explanation
  recording. `src/lib/tutor/client.ts` sends the latest 12 conversation turns;
  a long lesson cannot rely on this history alone.
- IndexedDB stores local boards, blobs, conversations and replays. Optional hosted
  accounts already sync board snapshots and files through Supabase. Preserve
  this local mode when adding source and lesson storage.

## Proposed pipeline

```text
PDF / public URL / pasted text
  → source records + extracted sections + page/paragraph anchors
  → topic inventory and syllabus objective mapping
  → editable lesson outline
  → fetch evidence for the current objective
  → existing tutor stream → interactive board + speech + replay
  → save checkpoint, practice evidence, and return point after interruptions
```

Separate the source library from its presentation. A 200-page PDF should be a
document in the library; only useful pages need to become board objects. Keep the
original file, stable source version, positioned text and page references so a
citation can open the exact material. Rendering every page before teaching would
work against both speed and a usable canvas.

Use two levels of context: an overview across all source sections to plan coverage,
and specific passages for each teaching section. Retrieving a few similar chunks
alone is insufficient for “fully explain this topic”: it can omit objectives.
Map syllabus objectives to source sections, track uncovered objectives, and show
gaps instead of claiming complete coverage. Extra examples can use model knowledge
but should be distinguished from claims attributed to uploaded sources.

Preserve headings, definitions, worked examples and equations when splitting text.
Keep neighbouring sections accessible. Add images when a diagram, notation or weak
extraction requires them. A summary is a navigation aid, not the evidence itself.

Retrieved citations are not automatically drawable canvas targets. Before the
tutor highlights an off-board page, mount it and include its stable shape ID and
positioned text in the board context that ActionSession validates. Website
paragraphs need their own source-card representation and anchors.

## Infrastructure choices

For the first version, use browser extraction, IndexedDB source/lesson records,
heading-aware sections and keyword search. Small source packs can use their full
text under a context budget. Keep an explicit retrieval interface so hosted and
local search implementations can differ.

For larger hosted libraries, extend existing Supabase Postgres and private Storage
with source, section, objective, lesson and checkpoint records. Add full-text search
and pgvector together rather than a separate vector database. Supabase documents
[hybrid search](https://supabase.com/docs/guides/ai/hybrid-search) using both keyword
and semantic retrieval. Scope every query to the authorized user's source set;
existing server account routes use a service role, so authorization must be enforced
explicitly. Mirror appropriate records locally for self-hosted use.

Public link ingestion needs a server fetch/extraction endpoint because browser
fetches may be blocked by CORS. Start with public HTML and direct PDF URLs. Bound
bytes, time and redirects; reject private/internal destinations at every redirect;
save an extracted snapshot with fetch time and original URL. Login-only pages and
unsupported content should ask for an exported PDF or pasted text. Source text
remains untrusted content under the existing tutor prompt rules.

Use a durable job queue and worker when hosted extraction/OCR/indexing becomes
long-running. Jobs need versioned inputs, retry safety and cancellation. Do not
depend on detached work inside a Next.js request. Browser extraction can be the
initial path; choose a queue service only when workload and hosting justify it.

Persist a lesson's chosen scope, ordered objectives, source versions, current
section, pending check, observed misconceptions, and return point. Save coverage
separately from demonstrated understanding. Cache source extraction and the outline;
generate live teaching from the student's current board and answer. Speculative
preparation must be discarded after a branch or source change.

## Speed and cost

Extract text before rendering all page images. Start once the selected topic has
sufficient evidence; label any outline provisional while other sources are being
processed. Prepare the next section's passages in the background, and stream the
current section through the existing action protocol. Pause continuation at useful
checkpoints rather than generating the entire lecture in one request.

Measure upload-to-ready, request-to-first-meaningful-drawing, section cost, and
interruption response separately. Do not promise a latency before measuring it.
Meter extraction, embeddings, planning, teaching and speech separately: an automatic
multi-turn lesson would otherwise consume the existing per-question quota in a
surprising way. Avoid charging speculative teaching that the learner never uses.

## Recommended first slice

1. Select uploaded notes and an optional syllabus as a source set; index all
   imported text independently of the viewport.
2. Add “Teach me this topic” with an editable, source-linked outline.
3. Teach one objective through the existing drawing tools and end with a check.
4. Save progress; support continue, skip, clarification detours and resume.
5. Add public article/direct-PDF links, with explicit import errors.

Then expand beyond the 40-page import limit with lazy rendering, scan OCR, hosted
indexing and semantic retrieval. Start with flat outlines and prerequisite IDs;
a graph database and multiple autonomous agents are unnecessary for this slice.

Acceptance examples: an off-screen definition informs the lesson; every agreed
syllabus objective is covered or marked unsupported; citations open the right
version/page; an interruption resumes at the right point; refresh restores progress;
an updated source invalidates stale retrieval and plans; cancel prevents further
queued narration/drawing. Use these for implementation tests when work begins.

## Positioning

NotebookLM already offers source-grounded chat and a learning-guide mode, alongside
generated overviews; see [Google's chat documentation](https://support.google.com/notebooklm/answer/16179559?hl=en).
The proposed distinction is visible, manipulable explanations on a shared canvas,
student work inside the explanation, and adaptation during a structured lesson.
Validate the value of that interaction with a small topic lesson before expanding
into a full course platform.
