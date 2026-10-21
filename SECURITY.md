# Security

## Reporting

Please report vulnerabilities privately through this repository's GitHub
Security Advisories ("Report a vulnerability"). Do not open a public issue for
security problems.

## Security model

This is a local desktop plugin. While it is enabled it runs with the same
privileges as the DSH process and the user account that started it.

- **Page access.** The plugin injects a small annotation runtime into the
  `<webview>` that the DSH right-Sidebar Browser uses for the current page. That
  runtime reads DOM information (tag, selector, text, computed styles, geometry)
  and captures cropped screenshots of annotated elements. It only runs while the
  user has annotation mode enabled.
- **Data written.** Reports and screenshots are written only under
  `$DSH_HOME/annotations/<sessionId>/<timestamp>/` (`$DSH_HOME` defaults to
  `~/.dsh`). No other files are modified.
- **Network.** The plugin makes no external network requests and contains no
  telemetry. Its HTTP routes (`/dsh-annotate/*`) are served by the local DSH
  Host and only receive annotation payloads from the DSH page.
- **Conversation data.** Annotation text and report paths become part of the
  user message that is sent to the model, exactly like text the user typed.
  Screenshots stay local unless the user attaches them separately.
- **Clipboard.** If the Host routes are unavailable (for example after a
  restart mismatch), the plugin falls back to inserting the report text into
  the composer and, only if that fails, to the system clipboard. The clipboard
  fallback is a last-resort path for the text the user just produced.
- **DOM coupling.** The plugin injects a control into the right-Sidebar control
  strip and renders a composer chip, both via documented UI slots plus measured
  DOM manipulation. These are not security boundaries; a compromised page
  cannot reach DSH host APIs through the plugin runtime.

## Supported versions

Security fixes target the latest released version. The plugin is developed and
verified against DSH `0.2.1-rc.2`; compatibility with newer DSH releases depends
on the DOM/slot contracts documented in the README.
