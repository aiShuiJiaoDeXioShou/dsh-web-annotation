# Contributing

## Development

```sh
npm ci
npm run check   # typecheck + build + tests
npm test        # tests only (tsx --test tests/*.test.ts)
npm run typecheck
```

The browser bundle is built by `build.mjs` from `src/client/index.tsx` into
`client/client.js`. Commit the rebuilt bundle together with source changes,
because `link:` and GitHub installs read the built file.

## Structure

- `src/shared/` — pure data contract and formatting; no DOM/Node APIs so both
  halves and tests can import it.
- `src/client/runtime.ts` — self-contained function injected into the annotated
  page. Keep it free of module imports; its `toString()` is the executeJavaScript
  source.
- `src/client/controller.ts` — the per-session state machine; keep the toggle
  transition serialised and re-arm the runtime on every open.
- `src/client/target.ts` — right-sidebar DOM discovery and runtime bridge.
- `src/client/ui.tsx` — React surfaces for the sidebar toggle and dock row.
- `index.js` — no-op Host entry; the plugin is client-only.

## Tests

Add a `tests/*.test.ts` file for every behaviour change. `tests/runtime.test.ts`
runs the injected runtime against a hand-rolled DOM stub; `tests/controller.test.ts`
drives the open/finish/reopen lifecycle through a fake webview. No network and no
real browser are required.
