---
title: Develop
sidebar_position: 0
description: Three ways to build on deadair. Contribute to the station, write a plugin, or call the API.
---

# Develop

Three different things are called developing on deadair, and they need different amounts of this
repository.

## Write a plugin

**You need a running station and Node. You do not need a checkout.** A plugin is built with plain
npm against the published SDK, packed with `npm pack`, and imported from the console's Plugins page.
Music providers, enrichment sources, charts, speech engines, models and news are all plugins, and so
is everything bundled with the station.

Start at [Your first plugin](../plugin-development/getting-started.md), which copies a real, working
example and has it on the air in six steps.

## Build on the API

**You need a station and an API key.** Every station serves the same HTTP API: the console is built
on it, and so are the Android, desktop and iOS listeners. Anything that reads what is playing,
drives the desk from a keypad, or puts a now-playing widget on a web page is an API client.

Start at [Build on the API](./api.md) for a key and a first request, and go to the
[API reference](../api-reference/index.md) for every route.

## Contribute to the station

**You need a checkout, Docker and about ten minutes.** The station is a pnpm and Turborepo
monorepo: a Koa API, a React console, the plugin SDK and the bundled plugins, with Liquidsoap,
Icecast, PostgreSQL, Redis and the measurement sidecar running beside it in containers.

- [Setting up a checkout](./setup.md) is the walkthrough, from clone to the console asking you to
  create an administrator.
- [How it fits together](./architecture.md) is what owns what, and where to read more before
  changing any of it.
- [Contributing](./contributing.md) is the rules a pull request is measured against, and how a
  release is cut.

## Where the arguments are

Long-form reasoning lives with the code rather than on this site: `CLAUDE.md` at the root of the
repository is an index of scoped files, and `docs/internals/` holds one file per subsystem. Most of
those paragraphs exist because the obvious fix was shipped first and was wrong, so they are worth
reading before changing the thing they describe.

Work that was designed against the real tree and then deliberately deferred is in the
[Ideas discussions](https://github.com/robert-dean/deadair/discussions/categories/ideas), labelled by
subsystem. Read it before designing a feature from scratch: the call may already have been made.
