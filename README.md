# Loci

Loci is a spatial AI tutor for math and STEM that runs on your own machine. You put your course material (a PDF, a photo of your notes, a screenshot) on an infinite canvas, select the part you don't understand, and ask. The tutor answers by teaching directly on the canvas beside your material: it highlights the exact symbol you asked about, builds a coordinate diagram next to the page, writes the equations out by hand, connects them with arrows, and then checks your understanding with a short question. Everything it draws stays on the board as normal, movable objects, so the next question can build on it.

The whiteboard is the interface. The chat is a narrow strip at the bottom.

## Demo

The workflow Loci is built around:

1. Click **Try sample calculus notes** (synthetic notes on directional derivatives, included in this repo).
2. The page is selected. Ask: *I understand the equation, but what is u geometrically?*
3. The tutor highlights `∇f · u` in the theorem box, draws a coordinate plane to the right of the page with the unit circle, the gradient and a unit vector `u`, marks the angle θ between them, writes `D_u f = ∇f · u = ‖∇f‖ cos θ` below the diagram, draws an arrow from the highlight to the diagram, and asks what happens if `u` points along the gradient. (The exact drawing varies with the model; `LOCI_PROVIDER=mock` replays this lesson exactly.)
4. Follow up: *Why does the answer become largest when they point in the same direction?* The tutor is instructed to extend the existing diagram (here, adding the projection of `∇f` onto `u`) rather than draw a new one.

The fastest way to ask: hold **Ctrl + Alt** (**⌃ + ⌥** on a Mac) and talk. While the keys are down, drag over the part you mean to highlight it, or click an object; let go to ask. You can also press **Q** (or the dashed box tool) to drag a box, then type.

## Features

* Infinite canvas (tldraw): pan, zoom, select, move, resize, draw, text, shapes, arrows, undo
* PDF pages and images as canvas objects, rendered and text extracted in the browser with pdf.js
* Ask about a selected page, any selected object, or a dragged region of a page
* The tutor sees structured board state (stable ids, positions, extracted text with positions) and images (the page or region, plus a view screenshot when it helps)
* The tutor draws through a typed, validated action protocol: text, KaTeX equations, highlights (marker, circle, box, underline) located by exact text match, arrows bound to objects or to points inside a graph, rectangles, ellipses, and coordinate planes with vectors, points, segments, function plots, circles, angle arcs and projections
* Semantic placement ("right of this page", "below that graph") with collision avoidance, so drawings land beside your material instead of on top of it
* Narration and drawing stream in together: the tutor writes equations and notes by hand (in tldraw's handwriting font), revealed left to right as its pen moves, while it speaks
* The tutor is a small particle orb that rests beside your cursor, flies to wherever it draws, and pulses with its voice
* Conversation history per board; the tutor can refer to anything it drew earlier by id
* Equations stay editable (double click to edit the LaTeX); undo removes a whole answer's drawing
* Voice mode: hold to talk, and the tutor speaks each sentence while it draws the marks that sentence is about. Its words are written to be heard (no symbols or formulas read aloud; the math stays on the board). Uses Fish Audio when `FISH_API_KEY` is set, otherwise the browser's built-in voice
* Board, files and conversation are stored locally in IndexedDB, so a refresh brings everything back. To start over, click the new board button in the top bar, or open `http://localhost:3000/?reset`

## Local setup

Requirements: Node.js 20.9 or newer, and an API key for any supported model provider (or a local model through Ollama).

```bash
git clone https://github.com/keananwongso/loci.git
cd loci
npm install
cp .env.example .env.local
# open .env.local and paste ONE key, e.g. ANTHROPIC_API_KEY=... or DEEPSEEK_API_KEY=...
npm run dev
```

Open http://localhost:3000.

Your key goes in `.env.local`, which git ignores. It is read only by the local server route (`src/app/api/tutor/route.ts`) and is never sent to the browser.

### Choosing a model

Loci picks the provider from whichever key you set. Anthropic uses its own API; everything else goes through one OpenAI-compatible provider, so any service that speaks that format with tool calling works.

| Provider | Key in `.env.local` | Model |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | defaults to `claude-opus-5-5` |
| DeepSeek | `DEEPSEEK_API_KEY` | defaults to `deepseek-flash` |
| OpenRouter (hundreds of models) | `OPENROUTER_API_KEY` | set `LOCI_MODEL`, e.g. `anthropic/claude-opus-5-5` |
| Google Gemini (free tier available) | `GEMINI_API_KEY` | set `LOCI_MODEL` |
| OpenAI | `OPENAI_API_KEY` | set `LOCI_MODEL` |
| Groq | `GROQ_API_KEY` | set `LOCI_MODEL` |
| Ollama (local, free) | none; `LOCI_PROVIDER=ollama` | set `LOCI_MODEL` |
| Anything else OpenAI-compatible | `LOCI_PROVIDER=custom`, `LOCI_BASE_URL`, `LOCI_API_KEY` | set `LOCI_MODEL` |

The model must support tool calling, since that is how it draws. Bigger models are noticeably better at composing clean diagrams.

**Models without vision work too.** Loci always sends a structured text description of the board: every object's id and position, graph contents, and the extracted text of your pdf with the position of each line. Images (the page, a region crop, a view screenshot) are extra. With `LOCI_VISION=auto` (the default) Loci sends images, and if the provider rejects them it retries without them and tells the model it is working from text only. A text-only model can still read your notes, highlight exact text and draw diagrams; it cannot read uploaded photos or screenshots, which have no text layer.

Optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOCI_PROVIDER` | detected from your key | Force a provider (see table) |
| `LOCI_MODEL` | provider default | Model id |
| `LOCI_VISION` | `auto` | `on`, `off`, or `auto` |
| `LOCI_EFFORT` | `medium` | Anthropic only: `low` answers faster, `high` thinks longer |
| `LOCI_THINKING` | `off` | DeepSeek only: `on` turns the model's thinking mode back on (better reasoning, several times slower) |
| `LOCI_PROVIDER=mock` | | Replays a scripted lesson about the sample notes, for working on the UI without a key (type `/selftest` to draw one of everything) |

With Anthropic, requests opt into the API's server side refusal fallback (`fallbacks: "default"`), so a request declined by a safety classifier is retried on a fallback model instead of failing.

### Voice

Click the speaker button in the top bar to turn on voice mode, then hold **Ctrl + Alt** (or the mic button) to ask out loud. The tutor speaks each sentence as it draws what that sentence is about, and the next sentence waits until the last one is finished. The written transcript is one click away (Show transcript).

For natural voices add `FISH_API_KEY` to `.env.local` ([Fish Audio](https://fish.audio), about $15 per million characters, so roughly a cent per answer). `FISH_VOICE_ID` picks a voice and `LOCI_TTS_MODEL` the model (default `s2-pro`). Without a key, the browser's built-in voice is used. Only the tutor's spoken sentences are sent to Fish Audio, never your files.

**Can I use a Claude or ChatGPT subscription instead of an API key?** No. Consumer subscriptions don't include API access, and routing an app through a subscription login (or through browser session cookies) goes against the providers' terms and can get the account suspended. For free or very cheap use, try Gemini's free tier, DeepSeek, or a local model through Ollama.

Other commands: `npm test` (unit tests), `npm run lint` (type check), `npm run build`, `npm run sample` (regenerate the sample PDF; needs a Chromium, see the script).

## Hosting a public demo

Loci can also run as a public website, for example to share it. Boards and files still live only in each visitor's browser; the only cost is model calls, and three things keep that bounded:

* **Free scripted demo.** On the sample notes, the suggested questions replay the directional-derivatives lesson without calling a model, for everyone, at no cost.
* **A few free questions on your key**, limited per device (a signed cookie), more loosely per network (so a campus Wi-Fi isn't locked out), and by a global daily cap that bounds your total spend whatever people do. IPs are stored only as salted hashes, and only counts are kept.
* **Bring your own key.** Visitors can paste their own API key for unlimited use. It is kept in their browser and passed through the server per request, never stored or logged. Only the built-in providers are accepted, so the server can't be pointed at arbitrary URLs.

To deploy on Vercel: import the repo, then set your model key (e.g. `ANTHROPIC_API_KEY` or a cheaper provider with `LOCI_MODEL`), `LOCI_DEMO_LIMITS=on`, the `LOCI_LIMIT_*` values, `LOCI_COOKIE_SECRET`, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` from a free [Upstash](https://upstash.com) Redis database (serverless functions don't share memory, so counters need a store). Set a spending limit with your model provider too, as a backstop.

tldraw requires a license key on a public domain: request a free [hobby license](https://tldraw.dev/get-a-license/hobby) for non-commercial use and set it as `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`.

Visitors using the hosted demo send their questions and page images to that server and on to the model provider for inference. For private material, run Loci locally.

## Privacy

* Your PDFs, images, board and conversation are stored in your browser's IndexedDB on your machine. There is no Loci server, database, account or cloud storage.
* When you ask a question, the local Next.js server sends the context for that one question to the AI provider you configured (nothing leaves your machine at all if you use a local model through Ollama): your question, a description of the board (including the extracted text of the page in focus), recent conversation turns, and a few images (the selected page or region and sometimes a screenshot of your current view). Nothing is stored by the local server.
* Review your provider's privacy and data retention policy before uploading anything sensitive. Policies differ a lot between providers.
* No analytics, tracking or telemetry. Next.js's own anonymous telemetry is switched off by the npm scripts. Fonts and icons are bundled, so the app makes no requests to third party CDNs.
* Voice input uses the browser's speech recognition. In some browsers (Chrome, for example) that audio is processed by the browser vendor's servers. In voice mode the tutor's spoken sentences go to Fish Audio if you set `FISH_API_KEY`; otherwise speech uses voices installed on your device.

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
| `src/lib/providers/` | `TutorModelProvider` interface, the Anthropic provider, one OpenAI-compatible provider for everything else, and the mock |
| `src/lib/canvas/executor.ts` | Turns validated actions into tldraw shapes |
| `src/lib/canvas/placement.ts` | Semantic placement and collision avoidance |
| `src/lib/canvas/serialize.ts` | Builds the structured board context and captures images |
| `src/lib/documents/` | pdf.js rendering, text extraction, phrase matching |
| `src/components/shapes/` | Custom shapes: material page, equation, graph, highlight, region |
| `src/lib/voice/` | Voice mode: Fish Audio route helper, speech playback queue, spoken-text cleanup, voice and mic levels |

The model never runs code in the browser. It can only call the declared tools; every call is validated before anything is drawn, and function plots are parsed by a small math expression parser rather than evaluated as JavaScript.

Adding a provider with a different API format means implementing `TutorModelProvider.run` in `src/lib/providers/` and routing each tool call through `session.handle`. Nothing else changes.

tldraw is free to use in development and on localhost. Deploying Loci publicly in production requires a tldraw license key (https://tldraw.dev/pricing).

## Roadmap

* Better graphing: level curves and contour plots, 3D surfaces, parametric curves
* A text protocol fallback for models without tool calling
* OCR for photos and screenshots, so text-only models can read them
* Realtime voice conversation
* iPad and Apple Pencil: a shared canvas where the tutor can see handwritten work and circle the term that went wrong
