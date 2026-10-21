---
'@deadair/api': patch
'@deadair/plugin-discord': patch
'@deadair/plugin-slack': patch
'@deadair/plugin-telegram': patch
---

Sign-in is harder to race: `@maroonedsoftware/authentication` 6.7.0 consumes every one-time code, sign-in link and authorization code in a single step, so two requests arriving together can no longer both use one. Refreshing a session twice at once now gives exactly one new session, and "sign out everywhere" can no longer miss a session created at the same moment. Also `cache` 0.6.0, `mcp` 0.7.6, `telemetry` 0.3.0, `discord` 2.1.2, `slack` 3.3.2 and `telegram` 2.1.2. Sessions signed in before the upgrade stay signed in.
