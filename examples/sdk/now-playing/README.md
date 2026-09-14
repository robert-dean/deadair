# Now playing: an example deadair SDK client

A few lines of TypeScript that ask a deadair station what it is playing and, given a token, what it
played before that. It is built the way a client from outside the deadair repository is built, with
plain `npm` against the published `@deadair/sdk`, and deadair's CI builds it against the SDK each
commit packs, with `skipLibCheck` off, to prove that the package's own types resolve.

```bash
npm install
npm run build
npm start -- http://localhost:8080/api
```

Set `DEADAIR_TOKEN` to an access token for the history as well. The
[API reference](https://deadair.radio/docs/api-reference) says how to get one, and the SDK's README
shows the same thing in code.

This directory is not part of the pnpm workspace, so none of the repository's own settings apply
here. Copy it somewhere else and it works the same.
