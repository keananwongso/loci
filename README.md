# Loci

Loci is a spatial AI tutor for math and STEM that runs on your own machine. You put your course material (a PDF, a photo of your notes, a screenshot) on an infinite canvas, select the part you don't understand, and ask. The tutor answers by teaching directly on the canvas beside your material: it highlights the exact symbol you asked about, builds a coordinate diagram next to the page, writes typeset equations, connects them with arrows, and then checks your understanding with a short question. Everything it draws stays on the board as normal, movable objects, so the next question can build on it.

The whiteboard is the interface. The chat is a narrow strip at the bottom.

## Demo

The workflow Loci is built around:

1. Click **Try sample calculus notes** (synthetic notes on directional derivatives, included in this repo).
2. The page is selected. Ask: *I understand the equation, but what is u geometrically?*
3. The tutor highlights `∇f · u` in the theorem box, draws a coordinate plane to the right of the page with the unit circle, the gradient and a unit vector `u`, marks the angle θ between them, writes `D_u f = ∇f · u = ‖∇f‖ cos θ` below the diagram, draws an arrow from the highlight to the diagram, and asks what happens if `u` points along the gradient. (The exact drawing varies with the model; `LOCI_PROVIDER=mock` replays this lesson exactly.)
4. Follow up: *Why does the answer become largest when they point in the same direction?* The tutor is instructed to extend the existing diagram (here, adding the projection of `∇f` onto `u`) rather than draw a new one.

To ask about just part of a page, press **Q** (or the dashed box tool) and drag a box around it.

## Features

* Infinite canvas (tldraw): pan, zoom, select, move, resize, draw, text, shapes, arrows, undo
* PDF pages and images as canvas objects, rendered and text extracted in the browser with pdf.js
* Ask about a selected page, any selected object, or a dragged region of a page
* The tutor sees structured board state (stable ids, positions, extracted text with positions) and images (the page or region, plus a view screenshot when it helps)
* The tutor draws through a typed, validated action protocol: text, KaTeX equations, highlights (marker, circle, box, underline) located by exact text match, arrows bound to objects or to points inside a graph, rectangles, ellipses, and coordinate planes with vectors, points, segments, function plots, circles, angle arcs and projections
* Semantic placement ("right of this page", "below that graph") with collision avoidance, so drawings land beside your material instead of on top of it
* Narration and drawing stream in together, with a cursor showing where the tutor is drawing
* Conversation history per board; the tutor can refer to anything it drew earlier by id
* Equations stay editable (double click to edit the LaTeX); undo removes a whole answer's drawing
* Push to talk and read aloud using the browser's speech APIs
* Board, files and conversation are stored locally in IndexedDB

## Local setup

Requirements: Node.js 20.9 or newer, and an Anthropic API key.

```bash
git clone https://github.com/keananwongso/loci.git
cd loci
npm install
cp .env.example .env.local
# open .env.local and set ANTHROPIC_API_KEY=...
npm run dev
```

Open http://localhost:3000.

Your API key goes in `.env.local`, which git ignores. It is read only by the local server route (`src/app/api/tutor/route.ts`) and is never sent to the browser.

Optional settings in `.env.local`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOCI_MODEL` | `claude-opus-5-5` | Model used by the tutor |
| `LOCI_EFFORT` | `medium` | `low` answers faster, `high` thinks longer |
| `LOCI_PROVIDER` | `anthropic` | `mock` replays a scripted lesson about the sample notes, for working on the UI without a key (type `/selftest` to draw one of everything) |

The Anthropic requests opt into the API's server side refusal fallback (`fallbacks: "default"`), so a request declined by a safety classifier is retried on a fallback model instead of failing.

Other commands: `npm test` (unit tests), `npm run lint` (type check), `npm run build`, `npm run sample` (regenerate the sample PDF; needs a Chromium, see the script).

## Privacy

* Your PDFs, images, board and conversation are stored in your browser's IndexedDB on your machine. There is no Loci server, database, account or cloud storage.
* When you ask a question, the local Next.js server sends the context for that one question to the AI provider you configured: your question, a description of the board (including the extracted text of the page in focus), recent conversation turns, and a few images (the selected page or region and sometimes a screenshot of your current view). Nothing is stored by the local server.
* Review your provider's privacy and data retention policy (for Anthropic: https://www.anthropic.com/legal/privacy) before uploading anything sensitive.
* No analytics, tracking or telemetry. Next.js's own anonymous telemetry is switched off by the npm scripts. Fonts and icons are bundled, so the app makes no requests to third party CDNs.
* Voice input uses the browser's speech recognition. In some browsers (Chrome, for example) that audio is processed by the browser vendor's servers. Read aloud uses voices installed on your device.

## Architecture

```
canvas (tldraw + custom shapes)
   │  selection, region, objects with stable ids
   ▼
serializer ── board state + page text + images ──► /api/tutor (local Next.js route)
                                                       │
                                                       ▼
                                              model provider (Anthropic)
                                                       │ tool calls
                                                       ▼
                                   action session: Zod schema + board checks
                                                       │ validated actions (NDJSON stream)
                                                       ▼
executor ◄──────────────────────────────────────────────┘
   │  placement, bindings, animation
   ▼
native canvas objects (meta.author = assistant)
```

| Path | What it does |
| --- | --- |
| `src/lib/actions/schema.ts` | The action protocol: one Zod schema per tool, also used to generate the tool definitions |
| `src/lib/tutor/session.ts` | Validates each tool call against the schema and the live board (ids exist, LaTeX compiles, quoted text is found) and returns precise errors to the model |
| `src/lib/tutor/prompt.ts` | System prompt and the text description of the board |
| `src/lib/providers/` | `TutorModelProvider` interface, the Anthropic implementation and the mock |
| `src/lib/canvas/executor.ts` | Turns validated actions into tldraw shapes |
| `src/lib/canvas/placement.ts` | Semantic placement and collision avoidance |
| `src/lib/canvas/serialize.ts` | Builds the structured board context and captures images |
| `src/lib/documents/` | pdf.js rendering, text extraction, phrase matching |
| `src/components/shapes/` | Custom shapes: material page, equation, graph, highlight, region |

The model never runs code in the browser. It can only call the declared tools; every call is validated before anything is drawn, and function plots are parsed by a small math expression parser rather than evaluated as JavaScript.

Adding another provider (OpenAI, Gemini, or a local model through Ollama) means implementing `TutorModelProvider.run` in `src/lib/providers/` and routing each tool call through `session.handle`. Nothing else changes.

tldraw is free to use in development and on localhost. Deploying Loci publicly in production requires a tldraw license key (https://tldraw.dev/pricing).

## Roadmap

* Better graphing: level curves and contour plots, 3D surfaces, parametric curves
* Local models through Ollama
* More providers (OpenAI, Gemini)
* Realtime voice conversation
* iPad and Apple Pencil: a shared canvas where the tutor can see handwritten work and circle the term that went wrong
