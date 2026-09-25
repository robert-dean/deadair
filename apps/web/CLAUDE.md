# The console

The design language of `apps/web`, and it is enforced by structure rather than by discipline.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

**The console is a broadcast desk, and the design language is enforced by structure rather than by
discipline.** `apps/web` is Mantine v9 and nothing else — no CSS-in-JS, no utility framework. The
system has four parts and each exists because the alternative already went wrong once.
`src/theme.ts` is the whole palette and every component default: the neutral, accent and status
tuples all OVERRIDE Mantine's built-ins (`dark` and `gray` for carbon, `red`/`blue`/`yellow` for the
tally conventions, `teal`/`green` for phosphor, `grape` and `orange` for authored-by-the-station and
for the one deliberate half-step between `skipped` and `unavailable`), which is why a `color="red"`
written anywhere already means the retuned red and why **overriding `gray` alone is not enough** —
in dark mode Mantine draws every surface from `dark`. `src/tokens.css` holds the `--da-*` surfaces
the theme's `cssVariablesResolver` points at, plus the one keyframe (`da-lamp-pulse`, for genuinely
live things only) and the `da-scanlines` texture, which goes on CHROME and never on content.
`src/components/shared/status.ts` is the one status vocabulary — five tones, no surface names a
colour for itself — and `status.lamp.tsx` draws it two ways, a quiet dot on a busy card and a filled
chip for the one state worth seeing across the room. And `src/components/shared/` holds
`PageHeader`, `ErrorAlert`, `EmptyState`, `Eyebrow`, `PageSkeleton`: the console had these
hand-rolled 20, 44, 9, 5 and 12 times, which is how it ended up with three letter-spacings for one
label and six heights of skeleton. **Type is Mantine's own scale and stays that way** — it was set a
step smaller for one pass to buy density, which is a uniform scale-down, reads as the browser being
zoomed out, and costs legibility rather than earning rows; density belongs in `spacing`, table
`verticalSpacing` and card padding. **Do not hand-roll one of these again**, and put a `Card` or
`Table` convention in `theme.components` rather than in a wrapper. Two rules that are not cosmetic:
a nav or back link uses `renderRoot={(props: object) => <Link to="..." {...props} />}` and never
`component={Link}`, because the polymorphic form erases the router's typing and hid a `/lineups`
link pointing at a route that never existed; and columns of figures carry `.da-num`, because a
playhead in proportional digits makes the whole row twitch on every tick.

**The `: object` on that callback is the whole rule, not decoration.** Mantine types `renderRoot` as
`(props: any) => any`, and spreading an `any` into JSX makes TypeScript abandon every check on that
element: `to`, `params` and `search` all stop being verified. `renderRoot` was adopted to fix the
`/lineups` bug and, unannotated, it does not — the same bad route compiles today. Measured across
this console: every one of about twenty links was unchecked, which is how a `ScriptLink` carrying
`segment` to a `/voice` route that validated only `tab` shipped and sent every talk break to the
whole history instead of to itself. Annotating the parameter restores all three checks at once, and
it is what then forces a link to name a route's full search shape — hence `search={CATALOG_TRACK_DEFAULTS}`
on the back-links, which `stripSearchParams` takes straight back out of the URL. The same trap
applies to any `{...rest}` of an `any`; if a link's props come from a variable, type it
(`Pick<LinkProps, 'to' | 'params' | 'search'>` is what `attention.destination.ts` uses) rather than
as a `Record<string, string>`.

## Words

**No copy is written into a component.** Every word an operator reads comes from an i18next catalog
under `src/i18n/en/`, one namespace per folder under `src/components` (plus `common` for the shared
components, `routes` and `api`), read with `useTranslation('<ns>')`. English is the only locale and
the source language: it is bundled and installed synchronously in `i18n.setup.ts`, so there is no
loading frame, and `i18n.types.d.ts` types `t()` against it, so a key that does not exist fails `tsc`.
`tests/setup.ts` installs the same catalog, which is why the suite's `getByText('…')` queries are the
check that a string survived its move into a catalog. Change the English in the catalog, not the test.

**The console's language is not the station's.** `stream.language` is what the presenter speaks and
what goes out with the stream; it is a setting, and nothing in these catalogs follows it. The console
is in whatever language each operator chose, or else their browser prefers, among English and the
packs the station holds. A
German station can have an English console and the reverse, and the two must never be wired together.

- **A sentence is one key.** A value in the middle is a `{{placeholder}}`, never fragments joined with
  `+`. A count is `count` with `_one`/`_other` keys, never `n === 1 ? …`. A sentence with a `<Code>`
  or a link inside it is a `<Trans>` with named tags. Do not name a tag `link`, `track` or any other
  HTML void element: the parser closes it on the spot and the link renders empty
  (`tests/i18n/catalog.tags.test.ts` refuses them). Where the operator's own text goes inside markup,
  pass it as the tag's child rather than as a value, so a `<` in a name is not read as a tag.
- **Words outside React** (a `describeX()` a test calls directly, a table built at import) read
  `i18n.t` from `i18n.setup.ts`, and a table's labels are getters, so they are looked up when drawn
  and not fixed in whichever language the console started in. Spreading such an object copies the
  words once; read the property instead.
- **A file another package imports takes no catalog.** `personas/template.vocabulary.ts` is imported by
  the API's own test, which holds its copy of the placeholder list against the station's, so it must
  import nothing: pulling in `i18n.setup.ts` broke the API's typecheck. It returns which fault a line
  has, and the editor words it.
- **A new folder under `src/components` gets its own namespace.** Create `src/i18n/en/<folder>.catalog.ts`
  as an `as const` object, then register it in `en.catalog.ts`, importing it WITH its `.ts` extension.
  Nest keys by component, then by meaning. The extension is not style: the release job writes the
  English language pack with plain `node`, which resolves nothing without it, and
  `tests/i18n/language.pack.test.ts` runs that script the same way to catch it.
- **Another namespace's key** needs both named: `useTranslation(['<ns>', 'common'])`, or `t` rejects
  `common:…` at the type level. `common.catalog.ts` is for words the shared components own, and for
  words several areas must say the same way (the access words an API key and a connected app share,
  through `shared/access.words.ts`). Duplicate a word into your own namespace rather than grow `common`
  with something only one area says.
- **Text from the API is not copy.** Setting labels and help, plugin descriptions and field text, and
  an error's `details.message` arrive in English and are shown as they come. Localizing those is the
  API's job and was deliberately left out.
- **Dates, times and numbers** go through `src/i18n/format.locale.ts`. The format locale is the
  browser's own tag in the language on screen (`en-GB`, not `en`), so a British operator still reads
  British dates. A station time is `formatClock` (24-hour whatever the locale), never `'en-GB'`, which
  settles the language as well as the clock.
- **The guard is a test, not the linter.** `eslint.i18n.js` holds a literal-string rule over `src/**`,
  but the shared lint config only warns and CI does not run lint, so
  `tests/i18n/literal.strings.test.ts` runs the rule and fails on a hit. It sees JSX text and the copy
  attributes listed there. It does not see a string handed to a helper outside JSX (`notifyDone('…')`,
  an `apiErrorMessage` fallback, a default parameter), so a review still has to.
- **A language pack** is the portable form of a catalog: `src/i18n/language.pack.ts` defines it (a
  header naming the language, its direction and the console version it was made for, around a
  catalog shaped like `en`). Settings, Languages exports the console's English as one, and each
  release attaches the same file as `deadair-console-en.json`. It imports only the English catalog,
  for the same plain-`node` reason.
- **A second language arrives as a pack at runtime**, never as a typed folder beside `en` (one good
  enough to ship with the console will be a pack file, loaded the same way).
  `languages.ts` holds the list of languages this console has: `installLanguagePack` runs
  `checkLanguagePack` (`language.check.ts`) against the bundled English, loads what fits into
  i18next and teaches dayjs the language from the browser's `Intl` (`dayjs.locale.ts`, rather than
  dayjs's 145 UMD locale files), and `showLanguage` switches to it. The check refuses a file only
  over its header. Inside the catalog, a key this console has not got, a plural form the language
  has not got (`Intl.PluralRules` says which), a placeholder the English does not fill or always
  fills, or markup that differs from the English costs that one string, which falls back to English.
  A pack for English is refused: English is what everything falls back to. `i18n.setup.ts` sets no
  `supportedLngs`, which would refuse every language installed after start-up, and
  `<DirectionProvider>` in `main.tsx` turns the layout round for a right-to-left language.
- **The station stores imported packs** at `/console/languages` (`apps/api/src/modules/languages`).
  Both reads are public, because the sign-in page loads its language before anybody signs in, and
  import and removal are `platform.manage`, which only an admin holds. The console does not know who
  is an admin, here as anywhere, so a 403 is reported in the console's own words. The API checks the
  header and the catalog's shape and nothing more, and the console's `LanguagePack` is the contract's
  `ConsoleLanguagePack` with the catalog narrowed. An import sends only the pack's own fields, because
  the contract refuses a key it does not know and a translator's tools may add one.
- **Which language shows** is `chooseLanguage` (`language.choice.ts`): the operator's choice, else the
  browser's preferences in order (English counts), else English. `startConsoleLanguage`, called from
  `main.tsx`, applies it at start-up from the choice remembered in `localStorage`, drawing English
  until the pack arrives rather than holding the first frame. After sign-in `useAccountLanguage` in
  `__root.tsx` applies the account's choice, kept at `/console/language` (a session, no role), and the
  picker in Settings, Languages writes both. The choice is not `ActorPreferences.locale`, which is
  still declared in the contracts and still unused. The operator-facing half is
  `apps/site/docs/features/languages.md`, which also tells a translator the rules `language.check.ts`
  enforces; keep the two saying the same thing.