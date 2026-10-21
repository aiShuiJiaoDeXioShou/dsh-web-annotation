# Contributing

## Development

No build step and no runtime dependencies:

```sh
node --check index.js
node --check client.js
npm test          # offline runtime harness (26 checks)
npm run verify    # both of the above
```

Useful entry points:

| File | Role |
| --- | --- |
| `client.js` | Web client half: sidebar control, composer chip/bridge, injected page runtime, report merging, Host pending sync. |
| `index.js` | Host half: `/dsh-annotate/*` routes, report file writes, pending batch, `agent/pre-step` merge into the sent user message. |
| `cordis.patch.yml` | Bundle row inserted into the profile. |
| `tests/runtime-harness.cjs` | Extracts `runtimeMain()` from `client.js` and drives it against a DOM stub. |

## Guidelines

- Keep the plugin runnable without a build step: plain ESM/CJS-compatible JS,
  no new dependencies unless unavoidable.
- Do not add telemetry, external network requests, or writes outside
  `$DSH_HOME/annotations`.
- When changing the pre-step merge in `index.js`, test that the session still
  loads after a DSH restart: send one annotated message, restart, open the
  session. The plugin must not append session events itself.
- When changing the injected runtime, bump the runtime version in `client.js`
  (`RUNTIME_VERSION`) so pages with a stale runtime are re-injected, and extend
  `tests/runtime-harness.cjs` for the new behavior.
- Keep README claims aligned with what is actually verified; note the tested DSH
  version.

## Pull requests

Small, focused changes are preferred. Describe what was tested (commands and
manual steps) and which DSH version/environment was used. For UI changes,
include a screenshot of the light and dark theme where relevant.
