# Apple Music charts: an example deadair plugin

A complete `charts` plugin: Apple Music's most-played songs in one country, which a deadair station
can programme an hour from. It is built the way a plugin from outside the deadair repository is
built, with plain `npm` against the published `@deadair/plugin-sdk`, and deadair's CI builds and
loads it on every change to prove that path still works.

```bash
npm install
npm test
npm run build
```

Then `npm pack`, press Import on the console's Plugins page, drop in the `.tgz` it wrote, and enable
the plugin. Or copy `package.json` and `dist/` into a folder of their own under the station's plugins
directory and press Rescan instead.

This directory is not part of the pnpm workspace, so none of the repository's own settings apply
here. Copy it somewhere else and it works the same.

The walkthrough, and everything else about writing a plugin, is at
https://deadair.radio/docs/plugin-development.
