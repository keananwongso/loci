# Setup and development

[Back to Loci](../README.md)

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

Open http://localhost:3000. Local copies go straight to your board; hosted deployments keep the public landing page. The board is also available at http://localhost:3000/demo. The board-name menu switches saved boards and renames them. New board keeps your previous board and conversation.

Your key goes in `.env.local`, which git ignores. It is read only by the local server route (`src/app/api/tutor/route.ts`) and is never sent to the browser.

### Learning a topic from multiple materials

Use the existing Upload control to choose PDFs/images, paste notes, or paste a public article or direct PDF URL. Set each material's role. After import, choose **Teach me a topic**, or type “teach me [topic]” in the question bar. Select the materials to use, build an outline, and edit titles, objectives and ordering before starting.

Each section uses the existing streamed whiteboard and voice tools. Ask a question to take a clarification detour; Continue advances the outline, Skip records a skipped section, and Try a problem asks for practice. The outline, current section, coverage and latest teaching checkpoint are saved inside the board snapshot, locally and through existing account sync. Completion tracks coverage, not mastery. Source buttons open the relevant page on the board; linked material also has a shortcut to its original URL.

Changing or removing a selected source invalidates the active plan and requires rebuilding it. Adding unrelated material does not invalidate a lesson using a different source set. PDF import currently includes the first **40 pages** per file. Scanned PDFs may have no extracted text; planning reports source gaps rather than inventing content. Image OCR may require waiting before planning.

The initial implementation uses text extraction and bounded keyword retrieval, with no vector database or new background service. Planning gets up to 120,000 source characters distributed across imported pages; teaching retrieves up to twelve pages under a 24,000-character text budget. Truncated pages are labelled for the model. Outlines support up to 16 sections, 50 materials and 800 imported pages in total.

On deployments with question limits, building an outline and each teaching turn consume one question; replays remain free of model calls. Links have a separate daily import allowance, a 10 MB download limit and a 20-second timeout. Downloads happen on the Next.js server; redirects and DNS addresses are checked to prevent internal-network access. Login-only pages, JavaScript-only sites and blocked downloads need an exported PDF or pasted text instead. Imported link content is saved as a snapshot, not continuously refreshed.

Approach the left edge, or click the board title, to open the sidebar. Create spaces and assign the current board with its Space selector. New boards inherit the current board's space. Local spaces save in this browser; account spaces use the existing Supabase tables and require the boards migration already described in the account setup.

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

**Models without vision work too.** Loci always sends a structured text description of the board: every object's id and position, graph contents, and the extracted text of your pdf with the position of each line. Images (the page, a region crop, a view screenshot) are extra. With `LOCI_VISION=auto` (the default) Loci sends images, and if the provider rejects them it retries without them and tells the model it is working from text only. A text-only model can still read your notes, highlight exact text and draw diagrams. Photos and screenshots have their text read in your browser (with tesseract.js) a few seconds after you add them, so their words can be read and highlighted too; anything that isn't text in them is invisible to a text-only model.

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

Click the speaker button in the top bar to turn on voice mode, then hold **Ctrl + Alt** (or the mic button) to ask out loud. The tutor speaks each sentence as it draws what that sentence is about, and the next sentence waits until the last one is finished. The written transcript is one click away (Show transcript). Completed answers have a Replay explanation button. Replay runs directly on the board with controls above the question bar: a timeline you can scrub, ±10-second jumps, 0.5×–2× playback and a clickable transcript. Replays preserve the actual canvas changes and original audio locally. No model or speech request is made when replaying; if the original voice was the browser voice, replay restarts that voice at the selected sentence. Answers given with voice off replay silently. Old answers saved before this feature do not have recordings.

For natural voices add `FISH_API_KEY` to `.env.local` ([Fish Audio](https://fish.audio), about $15 per million characters, so roughly a cent per answer). `FISH_VOICE_ID` picks a voice and `LOCI_TTS_MODEL` the model (default `s2-pro`). The voice matters most for how lively it sounds: try a few expressive voices from the Fish library. Delivery controls are omitted unless you configure them: Fish uses its own defaults. `LOCI_TTS_SPEED`, `LOCI_TTS_TEMPERATURE` and `LOCI_TTS_LATENCY` optionally override them. The demo's pre-rendered lines always use full quality. With a key, hold-to-talk also records your question from the moment you press and Fish Audio transcribes it when you let go. Without a key, the browser's built-in voice and speech recognition are used. Only the tutor's spoken sentences and your recorded question are sent to Fish Audio, never your files.

**Can I use a Claude or ChatGPT subscription instead of an API key?** No. Consumer subscriptions don't include API access, and routing an app through a subscription login (or through browser session cookies) goes against the providers' terms and can get the account suspended. For free or very cheap use, try Gemini's free tier, DeepSeek, or a local model through Ollama.

Other commands: `npm test` (unit tests), `npm run lint` (type check), `npm run build`, `npm run sample` (regenerate the sample PDF; needs a Chromium, see the script).

## The demo lesson

Everything the guided lesson uses lives in `public/demo/`, so changing it never touches code:

| File | What it is |
| --- | --- |
| `pack.json` | The materials and their roles, the greeting and outro, and the steps |
| your pdfs and images | Placed on the board in the pack's order |
| `takes/*.json` | Recorded answers: exactly what the tutor said and drew, with timing |
| `voice.json`, `voice/*.mp3` | Every line the lesson can say, pre-rendered with Fish Audio |

A step is something the visitor does. An **ask** step speaks an instruction, pulses the phrase to point at, and suggests a question; whatever the visitor asks goes to the live model. An **answer** step waits for the answer to the tutor's check question and picks a branch by matching words in it (for example *largest*, *steepest* for the right answer, and a catch-all that lets them try again), and the model responds live. Recorded takes remain available as admin reference files; visitor onboarding does not replay them.

To change it, run `npm run dev` and open **http://localhost:3000/admin**:

1. Drop in your materials (notes, syllabus, mark scheme, past paper) and set each one's role and order.
2. Write the greeting, the outro and the steps: instructions, suggested questions, the phrase to point at, and the answer branches.
3. Click **Record takes**. The lesson runs against your configured model; for each branch, ask, and keep the answer you like or redo it. Takes are recorded in order, each on the board the earlier ones left, so re-record later steps after changing an earlier one.
4. With `FISH_API_KEY` set, click **Render voice** to pre-render every line, including the tutor's short "let me look" phrases.
5. Click **Preview lesson**, then commit `public/demo/` and push. The admin exists only on a development server opened at localhost; a deployed site has none.

## Hosting a public demo

Loci can also run as a public website. Boards and files stay in the visitor’s browser; selected material is sent to the hosted server and model provider when they ask. Model and voice usage is bounded:

* **Live onboarding once.** Returning visitors resume their board. Replay demo creates a separate board so their work stays saved. The first question uses the configured model and counts against the daily allowance. Visitors can then paste or upload their own problems.
* **A few free questions on your key**, limited per device (a signed cookie), more loosely per network (so a campus Wi-Fi isn't locked out), and by a global daily cap that bounds your total spend whatever people do. IPs are stored only as salted hashes, and only counts are kept.
* **Voice under the same limits.** Fish Audio speech is counted in characters and transcription in requests, per device, per network and globally per day. Past a limit the tutor falls back to the browser's own voice instead of failing.
* **Bring your own key.** Visitors can paste a page-only API key, kept in memory and passed through the server per request. Signed-in users can opt into encrypted account storage; saved keys are decrypted only on the server, and the browser receives metadata only. Fish voice keys also cover microphone transcription; ElevenLabs keys cover spoken answers only. Credentials are never logged. Only the built-in providers are accepted, so the server can't be pointed at arbitrary URLs.

To deploy on Vercel: import the repo, then set your model key (e.g. `ANTHROPIC_API_KEY` or a cheaper provider with `LOCI_MODEL`), `LOCI_DEMO_LIMITS=on`, the `LOCI_LIMIT_*` values (including the `LOCI_LIMIT_SPEECH_*` and `LOCI_LIMIT_TRANSCRIBE_*` ones if you set `FISH_API_KEY`), `LOCI_COOKIE_SECRET`, and `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` from a free [Upstash](https://upstash.com) Redis database (serverless functions don't share memory, so counters need a store). Set a spending limit with your model provider too, as a backstop.

Limits default to on on Vercel; other hosts must set `LOCI_DEMO_LIMITS=on`. Production free usage requires Redis credentials and a stable `LOCI_COOKIE_SECRET`; missing configuration refuses paid requests. Redis reserves device, network, and global usage atomically so concurrent requests cannot exceed caps. Local development can use in-memory counters. Defaults: 5 questions/device/day, 20/network/day, 300 globally/day; speech and transcription have separate caps. All counters reset at midnight UTC.

The canvas uses MIT-licensed React Flow and perfect-freehand. No canvas license key is required.

### Seeing usage and spend

Set `LOCI_STATS_PASSWORD` and open `/admin/stats` on the deployed site (any username, that password). It shows, per day for the last 30 days: visitors (distinct browsers that opened the board), people who asked, questions, refusals at a limit, model tokens, speech characters and transcriptions, with an estimated cost. Without `LOCI_STATS_PASSWORD` the page doesn't exist.

Fish Audio speech is priced at $15 per million characters by default (`LOCI_PRICE_SPEECH`). For the model, set `LOCI_PRICE_INPUT`, `LOCI_PRICE_OUTPUT` and optionally `LOCI_PRICE_CACHED_INPUT` in USD per million tokens from your provider's pricing page; `LOCI_PRICE_TRANSCRIBE` prices each transcription. Only usage on your key is counted; visitors' own keys are not. Totals are kept in the same Redis for 400 days, and only on the production deployment, so local runs with production credentials don't count. They are estimates; your provider's billing page is the source of truth.

For page views, referrers and countries, enable Web Analytics in the Vercel project. Loci includes Vercel's cookie-free script only in builds on Vercel.

Visitors using the hosted demo send their questions and page images to that server and on to the model provider for inference. For private material, run Loci locally.

### Optional hosted subscriptions

[Account, Stripe, and Supabase setup →](subscriptions.md). Accounts and billing are optional; cloned copies need neither. Pro includes a configurable monthly allowance with separate daily spend caps. Anonymous demo caps still apply to free visitors.

## Privacy

* Your PDFs, images, boards, conversation and explanation replays are stored in your browser’s IndexedDB. The Next.js server forwards question context to the model provider; it does not store your files or conversation.
* If hosted accounts are enabled, Supabase stores your account and the Stripe customer/subscription mapping. Stripe handles payment information. Signing in does not upload or sync boards.
* When you ask a question, the local Next.js server sends the context for that one question to the AI provider you configured (nothing leaves your machine at all if you use a local model through Ollama): your question, a description of the board (including the extracted text of the page in focus), recent conversation turns, and a few images (the selected page or region and sometimes a screenshot of your current view). Nothing is stored by the local server.
* Review your provider's privacy and data retention policy before uploading anything sensitive. Policies differ a lot between providers.
* No analytics, tracking or telemetry when you run Loci yourself. A deployment on Vercel includes Vercel's cookie-free Web Analytics, and a hosted demo keeps daily usage counts (see Seeing usage and spend). Next.js's own anonymous telemetry is switched off by the npm scripts. Fonts and icons are bundled, so the app makes no requests to third party CDNs.
* Voice input uses the browser's speech recognition. In some browsers (Chrome, for example) that audio is processed by the browser vendor's servers. In voice mode the tutor's spoken sentences go to Fish Audio if you set `FISH_API_KEY`; otherwise speech uses voices installed on your device.

## Architecture

```
canvas (React Flow + Loci document store + custom shapes)
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
| `src/lib/canvas/executor.ts` | Turns validated actions into Loci canvas records |
| `src/lib/canvas/placement.ts` | Semantic placement and collision avoidance |
| `src/lib/canvas/serialize.ts` | Builds the structured board context and captures images |
| `src/lib/documents/` | pdf.js rendering, text extraction, OCR for images, phrase matching |
| `src/components/shapes/` | Custom shapes: material page, equation, graph, highlight, region |
| `src/lib/demo/` | The demo pack format (`pack.ts`) and loading it in the browser: placing its materials, finding what a step points at, loading takes |
| `src/app/admin/`, `src/app/api/admin/` | The local demo editor and its API (development server only) |
| `src/lib/voice/` | Voice mode: Fish Audio route helper, speech playback queue, spoken-text cleanup, voice and mic levels |

The model never runs code in the browser. It can only call the declared tools; every call is validated before anything is drawn, and function plots are parsed by a small math expression parser rather than evaluated as JavaScript.

Adding a provider with a different API format means implementing `TutorModelProvider.run` in `src/lib/providers/` and routing each tool call through `session.handle`. Nothing else changes.

Local boards use the versioned `loci-documents` IndexedDB store. Existing tldraw records and assets are read without modifying their original databases; saved explanations retain support for version-1 lessons. New explanations use version 2.

## Roadmap

* Better graphing: level curves and contour plots, 3D surfaces, parametric curves
* A text protocol fallback for models without tool calling
* Realtime voice conversation
* iPad and Apple Pencil: a shared canvas where the tutor can see handwritten work and circle the term that went wrong

## License

Loci is open source under the [MIT License](../LICENSE).

Its dependencies keep their own licenses. React Flow and perfect-freehand are MIT licensed. Shantell Sans is bundled under the SIL Open Font License.
