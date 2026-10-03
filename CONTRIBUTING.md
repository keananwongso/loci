# Contributing to Loci

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Getting set up

Follow [Local setup](README.md#local-setup) in the README. You don't need an API key to work on the canvas or the UI: run with `LOCI_PROVIDER=mock` in `.env.local` and the tutor replays a scripted lesson through the real drawing pipeline. Type `/selftest` in mock mode to draw one of everything.

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run lint   # type check
npm test       # unit tests
npm run build
```

Keep each pull request to one change, and say in the description what it changes and how you checked it. For anything you can see, a screenshot or a short clip helps a lot.

## Where things live

The Architecture section of the README maps the code. Most changes to what the tutor can draw start in `src/lib/actions/schema.ts` (the action protocol), then `src/lib/tutor/session.ts` (validation) and `src/lib/canvas/executor.ts` (drawing).

## Reporting a bug

Open an issue with what you did, what you expected and what happened. The terminal running `npm run dev` logs each question's timing and any rejected drawing, which is usually the most useful thing to paste. Leave out your API keys and anything private from your notes.

## Security

If you find a way to spend a hosted demo's credits past its limits, or anything else that shouldn't be public, please email keananwongso7@gmail.com instead of opening an issue.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
