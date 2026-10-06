# Loci

An AI tutor that draws beside your notes.

When you’re stuck on a piece of math, it helps to have someone draw it out with you. That’s the idea behind Loci.

Drop in a PDF or screenshot, point at what confuses you, and ask. Loci highlights your notes, sketches graphs, and writes equations while talking you through the explanation. Everything stays on the whiteboard, so you can keep asking and build on it together.

If you like the idea, a star helps people find it.

## Try it

The demo starts with some calculus notes and one question: “What’s a gradient, and how does it relate to partial derivatives?” Loci answers live, then you can try a problem of your own.

Hold **Control + Option** on Mac, or **Ctrl + Alt** elsewhere, to talk. Release to send. Typing works too.

## Local setup

You’ll need Node.js 20.9+ and a model API key.

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

Then run `npm run dev` and open [localhost:3000](http://localhost:3000). Local copies open directly into your workspace. Create and switch boards from the board name in the top bar; your earlier boards stay saved.

Claude, OpenAI, Gemini, OpenRouter, and local models through Ollama work too. Fish Audio is optional for voice. Boards, conversations and explanation replays save in your browser. Replay a completed answer with pause, a seekable timeline, 10-second jumps, playback speed and a clickable transcript. When you ask, the relevant material goes to your configured model provider.

[Hosted accounts and subscriptions →](docs/subscriptions.md)

[More setup options, hosting, and how it works →](docs/guide.md)

Built with Next.js, tldraw, pdf.js, and KaTeX. [Contributions welcome](CONTRIBUTING.md). [MIT licensed](LICENSE); tldraw has its own licensing terms.

Built by [Keanan Wongso](https://keananwongso.com). [LinkedIn](https://linkedin.com/in/keananwongso).
