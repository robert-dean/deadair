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
