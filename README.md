# JEV Mail Intelligence

A production-oriented frontend workspace for Gmail email intelligence powered by JEV AI. The current build is dependency-free so it can be previewed immediately, with a realistic inbox, live-sync state, JEV result columns, filtering, sorting, search, and bulk selection.

## Preview

Open `index.html` in a browser, or serve the folder with any static web server:

```bash
npx serve .
```

`credentials.json` is intentionally not loaded by the browser. It contains an installed-app OAuth client secret and must remain server-side and uncommitted. The supplied credentials are suitable for the backend OAuth flow.

## Integration boundary

The UI expects a backend service to own:

- Gmail OAuth, token refresh, history/watch subscriptions, and incremental message sync.
- MIME parsing and normalized email records, including attachments metadata and thread context.
- JEV API key storage, question execution, retries, rate limiting, and a bounded worker pool.
- Server-sent events or WebSocket events for new messages and updated analysis results.

A normalized analysis result should include `answer`, `score`, `confidence`, `reasoning`, `priority`, `intent`, and `recommendation`. The three supported question modes map to `answer` as a choice, a 0-100 score, or a 0-100 yes/no probability.

For deployment, serve this page behind the authenticated API origin and inject only short-lived session credentials. Never expose `credentials.json` or the JEV API key to client JavaScript.