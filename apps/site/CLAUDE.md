# The website

`apps/site` is the public site at `deadair.radio`: a Docusaurus build whose front page is a custom
React page (`src/pages/index.tsx`) and whose docs live under `/docs`. It is not part of the station.
Nothing here ships in the image and nothing in the station reads it.

`pnpm --filter @deadair/site start` serves it on a dev server; `build` writes `dist/`. It is not a
`dev` script on purpose, so `pnpm dev` does not start a docs server beside the station.

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

**The operator docs are copied in, never edited here.** `scripts/docs.sync.mjs` copies
`deploy/README.md` and `docs/licensing.md` into `docs/` on every `start` and `build`, and the copies
are gitignored. Edit the source files. Neither carries a relative link, which is the only reason a
plain copy is safe: add one and the site's build fails on it until the script learns to rewrite it.
`turbo.json` lists both sources as inputs of this package's `build`, since they live outside it.

**The colours are the console's carbon theme, copied.** `src/css/custom.css` restates the surfaces,
the phosphor accent and the faces from `apps/web/src/tokens.css` and `theme.ts`, because the console
publishes them through Mantine and this site does not load Mantine. The brand images are served
straight from `apps/web/public` through `staticDirectories`, so there is one copy of the logo.
