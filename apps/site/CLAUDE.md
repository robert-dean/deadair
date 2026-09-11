# The website

`apps/site` is the public site at `deadair.radio`: a Docusaurus build whose front page is a custom
React page (`src/pages/index.tsx`) and whose docs live under `/docs`. It is not part of the station.
Nothing here ships in the image and nothing in the station reads it.

`pnpm --filter @deadair/site start` serves it on a dev server; `build` writes `dist/`. It is not a
`dev` script on purpose, so `pnpm dev` does not start a docs server beside the station.

**A push to `main` is the deploy.** `.github/workflows/site.yml` builds `dist/` and publishes it to
GitHub Pages whenever a push touches the site or one of the files it reads from outside the package.
The custom domain is set in the repository's Pages settings, not in a `CNAME` file: a Pages site
deployed by an Actions workflow ignores that file, so adding one changes nothing.

Every paragraph below is a failure that happened while setting it up, and each looks harmless to
undo.

**Every dependency is a devDependency.** The image installs every workspace member and then prunes to
production dependencies, so anything under `dependencies` here would ride into the station's image
with nothing to use it. `.dockerignore` keeps everything but `package.json` out of the build context
for the same reason, so editing a page does not invalidate the workspace copy and rebuild the API.

**No `"type": "module"`.** Docusaurus generates `.docusaurus/*.js` modules that call
`require.resolveWeak`, which the bundler only translates when it parses those files as CommonJS. Mark
the package as ESM and the build fails at static generation with `require.resolveWeak is not a
function`, on webpack and Rspack alike. The ESLint config is `.mjs` for this reason.

**The `browserslist` block is load-bearing.** `future.v4` puts Infima and the theme in CSS cascade
layers. With no `browserslist`, `postcss-preset-env` targets browsers without `@layer` and polyfills
the layers into `:not(#\#)` specificity hacks, and those outrank every override in
`src/css/custom.css`: the site comes out in Infima's default blue and system fonts. The block is the
one Docusaurus's own template ships.

**Four pages are copied in, never edited here.** `scripts/docs.sync.mjs` copies `deploy/README.md`,
`docs/licensing.md` and `packages/plugin-sdk/README.md` (as `plugin-development/contract.md`) into
`docs/` on every `start` and `build`, and `apps/android/PRIVACY.md` into `src/pages/privacy/android.md`,
a page rather than a doc because Google Play and the app's settings screen link to
`/privacy/android` and it wants no sidebar. The copies are gitignored, and that URL is a promise:
moving it breaks the Play listing and every installed app's link. Edit the source files. A relative
link in a source is written for the repository and would break the site's build, so the script rewrites
every one outside a code fence to that file on GitHub, resolved against the source's own directory;
an in-page anchor is left alone. That rewrite is why the SDK's README could join the other two, since
it links into its own `src/`. `turbo.json` lists all four sources as inputs of this package's `build`,
and `site.yml` and `changes.sh` list them as paths that deploy and check it, since they live outside it.

**The "Writing plugins" section is hand-written, and the example it walks through is real code.**
`docs/plugin-development/` explains `examples/plugins/apple-music-charts`, which CI builds from outside
the workspace and loads with the station's own loader. A page there that quotes the example has to
change with it, and a claim about what the station does with a plugin (the peers link, restart versus
Rescan, the plugins directory on each install) is a claim about `apps/api` that has to stay true.

**The API reference is generated, and committed.** Everything under `docs/api-reference/`, and
`static/openapi.yaml` beside it, is written
by `pnpm build:contracts` (`@contractkit/plugin-docs`, configured in `apps/api/contractkit.config.json`)
and is covered by the generated-output rule: never edit it, and CI's `generated` job fails if it
disagrees with the contracts. The one exception is `docs/api-reference/index.md`, which the plugin
writes once and never touches again, so it is ours. That is also why `editUrl` in
`docusaurus.config.ts` sends a generated page's "Edit this page" to the contracts for its area rather
than to a file the next regeneration would overwrite.

**The colours are the console's carbon theme, copied.** `src/css/custom.css` restates the surfaces,
the phosphor accent and the faces from `apps/web/src/tokens.css` and `theme.ts`, because the console
publishes them through Mantine and this site does not load Mantine. The brand images are served
straight from `apps/web/public` through `staticDirectories`, so there is one copy of the logo.

**The screenshots are of a real station, and taking them spends a session.** `scripts/console.capture.mjs`
(`pnpm --filter @deadair/site capture login`, then `capture shoot`) drives a browser signed in to a
running console and writes `static/img/console/*.webp`, which is committed. Signing in is done by a
person in the window `login` opens: nothing here holds a password. The saved state under `.capture/`
is gitignored and goes stale on every use, because the console's refresh token is single-use and
presenting a spent one revokes its whole family, so `shoot` writes the new cookie back as soon as the
first page is up and again on the way out. Never run two at once and never copy the file. Look at
every image before committing it: cover art and news headlines are other people's, and `--blur-art`
is there for the first. `unraid/deadair.xml` links five of them by raw GitHub URL as its
`<Screenshot>`s, so renaming or deleting one breaks the Unraid listing with nothing here failing.
