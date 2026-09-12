---
title: Your first plugin
sidebar_position: 1
description: From a copy of the example plugin to a chart the station can air, in six steps.
---

The quickest way to a working plugin is to start from one. The example is a complete `charts` plugin that follows Apple Music's most-played songs in one country, and it is built the way any plugin from outside the deadair repository is built: with plain npm, against the published SDK. You need Node.js 24 or later and a running station.

## Copy the example and build it

The example lives in [`examples/plugins/apple-music-charts`](https://github.com/robert-dean/deadair/tree/main/examples/plugins/apple-music-charts). Copy that directory anywhere; it depends on nothing else in the repository.

```bash
npm install
npm test
npm run build
```

The build writes one file, `dist/index.js`, which is the whole plugin. It does not contain the SDK or zod: the station supplies its own copy of each.

Before going further, rename it. Change `name` in `package.json`, and `id` and `name` in `src/apple.charts.manifest.ts`. The `id` is how the station knows your plugin: it is reverse-DNS, something like `com.example.my-charts`, and it must never change once somebody has installed it, because the station keeps the plugin's settings under it.

## Install it on the station

Pack it, then hand the pack to the station:

```bash
npm pack
```

That writes `my-charts-1.0.0.tgz`, named after `name` and `version` in `package.json`, holding the package file and `dist/`. In the console, open **Settings → Plugins**, press **Import**, and drop that file in. The station unpacks it into its plugins directory and loads it to read its manifest, and if it would not load, the dialog says why in the same words the station would use for a plugin copied in by hand.

Or copy it in by hand, which is what Import does for you. An installed plugin is its `package.json` and its `dist/` directory, in a folder of their own inside the station's plugins directory. On a Docker install that is `plugins/` inside the directory you mounted at `/data`. [Packaging and installing](./packaging.md#where-the-plugins-directory-is) lists where it is on each kind of install.

```bash
mkdir -p /path/to/data/plugins/my-charts
cp -r package.json dist /path/to/data/plugins/my-charts/
```

Do not copy `node_modules`. The station links its own SDK and zod into the plugins directory, and a plugin that brings a copy of its own is handed that copy instead, which is a different class from the one the station checks against.

## Rescan and enable it

An imported plugin is on the list already. One you copied in appears when you press **Rescan** on **Settings → Plugins**. Either way it appears as a card marked **Installed**, in the Discovered state, which means the station loaded it and has not been told to use it. If it appears as Failed instead, its card and its page say why, including the directory the station read.

Switch it on. The first time, the console asks you to confirm that you trust it, because it is about to run inside the station with the station's privileges. Then open its page: pick a country, save, and press **Test connection**. The example answers with the song at number one.

The chart is now under **Library → Charts**, where it can be aired, and on the schedule, where a block can play it.

## Change it, and see the change

Rebuild after every change. Then either give it a new `version`, pack it and import it again, or copy `dist/` back and **restart the station**. A new version lands in a folder of its own, so the station reads its code at once and keeps its settings. The same files at the same path are not read again until a restart: Node keeps a module it has imported for as long as the process runs, which is also why Reload and Rescan, which re-run the plugin's setup with its current settings, never load new code. Importing the same version twice says so.

The same goes for a new version of somebody else's plugin: import it, or replace its files and restart. Removing a plugin is **Remove** on its page, or deleting its folder and pressing Rescan. Either way its settings are kept, so installing it again brings them back.

## Where to go next

- [Packaging and installing](./packaging.md), before you add a library of your own to the plugin.
- [Testing](./testing.md), for the fake host and the loader check.
- [The contract](./contract.md), for everything a capability can do, and the permissions and settings a manifest can declare.
