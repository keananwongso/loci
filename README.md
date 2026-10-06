# Loci

A spatial canvas for learning. Loci explains by drawing beside your own notes.

**[learnwithloci.com](https://learnwithloci.com)**

When you’re stuck, whether it’s a proof, a circuit, a sorting algorithm or a journal entry, it helps to have someone work it through with you, right next to your notes. Most AI answers live in a chat that scrolls away. Loci puts them on the board instead, so every explanation stays where you asked it.

Drop in a PDF or screenshot, point at what confuses you, and ask. Loci highlights the exact lines in your notes, sketches graphs and diagrams, builds tables and writes out the working while talking you through it. Keep asking and the board builds up around your material.

If you like the idea, a star helps people find it.

## What it does

- **Teaches on your material.** Explanations are drawn beside the page they’re about, with highlights pointing at the exact words or symbols.
- **Any course.** Math, physics, chemistry, computer science, economics, accounting, anything where seeing the work helps.
- **Knows what each file is for.** Mark uploads as notes, exercises, a syllabus or a mark scheme. Loci teaches from notes, works through exercises with you, keeps to the syllabus and marks against the mark scheme, even when they’re off screen.
- **Talk or type.** Hold **Control + Option** on Mac, or **Ctrl + Alt** elsewhere, to ask out loud. Answers can be spoken back.
- **Replay any answer.** Every explanation is recorded with its drawing and audio: pause, seek, change speed or jump through a clickable transcript.
- **Boards that follow you.** On learnwithloci.com, signing in saves your boards, uploads and replays to your account so they open on any device. Boards you made before signing in come with you.

## Try it

Open [learnwithloci.com](https://learnwithloci.com) and press **Try Loci**. The demo starts with some calculus notes and one question, then you can bring a problem of your own. The demo needs no account and keeps everything in your browser; a free account saves your boards. Loci Pro, with more questions, natural voice and room to study, is coming soon.

## Run it yourself

Loci is open source and runs entirely on your machine with your own model key. You’ll need Node.js 20.9+.

```bash
git clone https://github.com/keananwongso/loci.git
cd loci
npm install
cp .env.example .env.local
```

Add a key to `.env.local`, for example:

```env
DEEPSEEK_API_KEY=your_key_here
```

Then run `npm run dev` and open [localhost:3000](http://localhost:3000). Claude, OpenAI, Gemini, OpenRouter and local models through Ollama work too, and Fish Audio is optional for a natural voice. A local copy needs no accounts: boards, conversations and replays save in your browser, and when you ask, only the relevant material goes to the model provider you configured.

- [Setup options, hosting your own copy, and how it works →](docs/guide.md)
- [Hosted accounts and subscriptions (Supabase, Google sign-in, Stripe) →](docs/subscriptions.md)

## Built with

Next.js, React Flow, perfect-freehand, pdf.js and KaTeX, with Supabase and Stripe for hosted accounts. [Contributions welcome](CONTRIBUTING.md). [MIT licensed](LICENSE). The canvas dependencies are MIT licensed; the bundled handwriting font is OFL licensed.

Built by [Keanan Wongso](https://keananwongso.com). [LinkedIn](https://linkedin.com/in/keananwongso).
