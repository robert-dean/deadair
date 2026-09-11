---
title: Versioning and compatibility
sidebar_position: 4
description: The one version number a station enforces, the ones it does not, and what each means for the ranges a plugin declares.
---

Three version numbers meet when a station loads a plugin, and only one of them decides whether it loads.

## The plugin API version is the one that is enforced

The SDK implements a numbered plugin API, `PLUGIN_API_VERSION`, which is `1.0.0` today. A manifest's `apiVersion` is a semver range, and a station refuses to load a plugin whose range does not include the API version the station implements. The refusal is a quarantine with a message naming both.

Write `^1.0.0`. The API version moves only when the contract does. A minor step adds something, such as a new capability or a new optional method, and a plugin written against an earlier minor keeps working. A major step is the only thing that can make a working plugin stop loading, and it is the only reason to publish a new version of a plugin that has not otherwise changed.

## The SDK's package version follows the station

`@deadair/plugin-sdk` is released with the station and carries the station's version. SDK `0.4.2` is exactly the SDK that station `0.4.2` runs, and a new station release publishes a new SDK whether or not anything in it changed.

So the version number of the package says which station it came from, and nothing about compatibility. That is the plugin API version's job.

## Peer ranges are floors

A plugin's `peerDependencies` entry for the SDK is not what decides which SDK it runs against: the station links its own copy, whatever the range says. The range is advice to npm, when you or somebody else installs the plugin's devDependencies to build it.

Make it a floor, `>=0.1.0`, rather than a caret. The SDK's version moves on every station release, and before 1.0 a caret range such as `^0.1.0` accepts no other minor, so it would call every station after the one you built against incompatible when nothing had changed. Put the floor at the first SDK version with everything your plugin uses.

zod is a peer for the same reason, and `^4.0.0` is the right range for it.

## Your plugin's own version

The manifest's `version` is yours. The console shows it on the plugin's card, and it has no effect on loading. Keep it in step with `package.json`, and change it whenever you publish a build, so an operator can tell which one they have.

The manifest's `id` must never change. A station keeps a plugin's settings, secrets, storage and the operator's decisions about it under its id, so a new id is a new plugin, and an operator who installs it starts again from nothing.
