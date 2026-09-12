---
title: Packaging and installing
sidebar_position: 2
description: What a plugin package has to look like, which dependencies it carries and which it must not, and where an operator puts it.
---

A station finds a plugin by looking at folders, not by installing packages. Every folder inside its plugins directory that holds a `package.json` naming a plugin entry is a candidate, and the station imports that entry. So a plugin is packaged for a station by building it into files that need nothing else, and installed by importing the tarball `npm pack` makes of them, or by copying the files in.

## The package

```json
{
    "name": "my-deadair-charts",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/index.js",
    "deadair": {
        "plugin": "./dist/index.js"
    },
    "peerDependencies": {
        "@deadair/plugin-sdk": ">=0.1.0",
        "zod": "^4.0.0"
    }
}
```

Three parts of it are load-bearing.

- **`deadair.plugin`** is the file the station imports, relative to the folder. Without it the folder is not a plugin, and the station skips it without a word. When it names a file that is not there, the plugin is quarantined with a message saying it has not been built.
- **`"type": "module"`**, because the station imports the entry as an ES module.
- **The SDK and zod are peers**, which is the next section.

The entry's default export must be `definePlugin(manifest, factory)`. The station validates the manifest when it loads the plugin, and a manifest that does not validate is a quarantined plugin with every problem listed.

## Peers, and everything else

The station hands every plugin its own copy of `@deadair/plugin-sdk` and `zod`. That is not a convenience. A plugin that extends the SDK's `Plugin` class, or throws its `PluginError`, has to be using the class the station checks against, and the only way to be sure of that is for there to be one copy. So both are `peerDependencies`, and both are left out of your build.

Anything else your plugin uses, it carries. Bundle it into `dist/` with a bundler. With tsup, which the example uses, that takes no configuration at all:

- A name under `peerDependencies` or `dependencies` is left out of the bundle automatically.
- A name you import and list under `devDependencies` is bundled in.
- `noExternal` beats `external` when a name is in both, so use it only to force a library in, and never for the SDK or zod.

The rule that follows is simple: the SDK and zod are peers, every library is a devDependency, and `dependencies` stays empty. The station does not install dependencies for a plugin, so a library left as an import is a plugin that fails to load.

## Ship no node_modules

An installed plugin is `package.json` and `dist/` and nothing else. Copying a `node_modules` in beside them does harm rather than good: npm installs peer dependencies by default, so a plugin's own `node_modules` holds a second copy of the SDK, and Node finds that one first.

The station keeps a `node_modules` of its own in the plugins directory, holding links to its SDK and zod, and remakes the links on every start and every Rescan. It belongs to the station: leave it alone, and do not name a plugin folder `node_modules`.

## Packing it

`npm pack` in the plugin's folder writes `<name>-<version>.tgz`: every file `files` names, plus `package.json` and a README or licence if there is one, under a `package/` prefix. That file is what **Import**, on **Settings → Plugins**, takes. Let `files` name `dist`, so the source and the tests stay out of it.

The station unpacks it into a folder of its own, `<name>-<version>` inside the plugins directory, and loads it there before it keeps it, so a plugin that would be quarantined is refused instead, with the same reason. It also refuses a tarball that is not one `npm pack` could have written, and anything that could reach outside the folder:

- a link of either kind, or anything that is not a plain file or directory
- a path outside `package/`, or one that climbs out with `..`
- a `node_modules`, for the reason in the next section
- more than 64 MB as uploaded, or more than 256 MB unpacked
- an `id` that belongs to a plugin bundled with the station

An imported plugin arrives switched off. A plugin whose `id` is already installed is replaced, whatever its package is called, and keeps its settings.

## Where the plugins directory is

| Install | Plugins directory |
| --- | --- |
| Docker, from the published image | `plugins/` inside what you mounted at `/data`: `./data/plugins` beside the compose file, by default |
| Unraid | `plugins/` inside the Data path, `/mnt/user/appdata/deadair/plugins` by default |
| A checkout of the repository | `apps/api/data/plugins`, which is gitignored. Create it by hand |

The `PLUGINS_DIR` environment variable moves it. Inside the container the station runs as uid 99, group 100, and takes ownership of the directory itself at every start, so it can write its links there. It does not take ownership of what is inside, so a plugin you copied in has to be readable by that user.

If the station cannot write to the directory, it says so in its log when it starts, every installed plugin is quarantined with an error naming the package it could not find, and Import fails. The station keeps work in progress in a `.staging` folder there, and never treats a folder whose name starts with a dot as a plugin.

## Developing against a running station

On a checkout of the repository, link your plugin's folder into the plugins directory instead of copying it, so a rebuild is all a change needs before a restart. The station follows links for exactly this.

```bash
ln -s /path/to/my-plugin apps/api/data/plugins/my-plugin
```

A linked folder brings its own `node_modules` with it, and your plugin then loads the SDK your `npm install` put there rather than the station's. That is fine while the versions match. When something is wrong only on the station, copy `package.json` and `dist/` in instead, which is what an operator does.

## Reload, Rescan and restart

- **Reload**, on a plugin's page, runs its setup again with its current settings. Saving its settings does the same.
- **Rescan**, on the Plugins page, finds folders that were added or removed.
- **Import** a new version to load changed code without a restart. It lands in a folder named after the new version, and a module at a path the station has never imported is read fresh.
- **Restart the station** to load changed code any other way. Neither Reload nor Rescan does, and nor does importing the same version again: Node keeps every module it has imported for the life of the process, so a new build at a path that is already loaded is not read until the next start. Import says when that is the case.

## Removing one

**Remove**, on an installed plugin's page, stops it and deletes its folder. Deleting the folder by hand and pressing Rescan does the same. Its settings, and what it was allowed, are kept either way, so installing it again brings them back. A folder you linked in is unlinked, never followed, so removing it leaves your checkout alone.

## When it does not load

A plugin that fails to load is shown as Failed, with the reason, and its page names the directory the station read. The reasons are the loader's own, so they are specific: a missing `deadair.plugin`, an entry that was never built, a module that threw while it was imported, a manifest that did not validate, an `apiVersion` range the station does not cover, or an `id` another plugin already took. The first plugin to claim an id keeps it, and the bundled plugins are loaded first.

To see the same answer without a station, use [the loader check](./testing.md#will-the-station-load-it).
