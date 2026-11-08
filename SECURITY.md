# Security

## Scope

`dsh-web-annotation` is a client-only DSH plugin. It adds an annotation overlay
to the right-Sidebar Browser `<webview>` and writes finished annotations into
the composer draft.

## Data flow

- Annotations and attached image data stay in the browser page runtime until the
  user finishes the batch.
- Finished text is inserted into the composer through DSH's public input actions;
  images are registered through DSH's Conversation attachment service, the same
  path as manually adding an image to the composer.
- The plugin has **no Host HTTP routes**, performs **no network requests**, has
  no telemetry, and writes no files.
- The annotation runtime is injected with `webview.executeJavaScript` only while
  annotation mode is active, and reads DOM geometry/text solely for the
  annotation the user selects.

## Reporting

Please report vulnerabilities through the repository's private security
advisory, not a public issue. Include the DSH version and reproduction steps.
