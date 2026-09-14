---
'@deadair/sdk': minor
---

The typed client for the station's API is published to npm as `@deadair/sdk`, beside the plugin SDK, carrying the station's version, so the SDK that shares a station's version number is the client for that station. It is the client the console is built on, with Luxon's types now among its dependencies so a TypeScript project gets typed dates without installing them itself. The repository has a small example client in `examples/sdk/now-playing`, which CI builds against the SDK as it would be published.
