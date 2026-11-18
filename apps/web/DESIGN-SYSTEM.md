# The console's design system

A reference for `apps/web`: the tokens, the three themes, and every component in
`src/components/shared/`. It says WHAT each piece is and how to use it. The reasons behind each rule
(the measured failure each one closes off) live in [`CLAUDE.md`](CLAUDE.md) and in the doc comment on
each file; read those before changing one.

The short version of the whole system:

- **Mantine v9 and nothing else.** No CSS-in-JS, no utility framework.
- **`src/theme.ts`** is the palette and every component default. **`src/tokens.css`** holds the
  `--da-*` surfaces those defaults point at. **`src/themes.ts`** registers the three consoles.
- **`src/components/shared/status.ts`** is the one vocabulary for state and severity. No surface
  names a colour for a status itself.
- **No copy in a component.** Every word comes from an i18next catalog under `src/i18n/en/`.
- **Do not hand-roll a shared component again**, and put a `Card` or `Table` convention in
  `theme.components` rather than in a wrapper.

---

## Tokens

### Surfaces and text (`tokens.css`)

Darkest first on the dark themes. Depth is layering, never a shadow: content sits on panels, panels
sit on the desk.

| Token | Carbon | Studio White | Neon | Use |
| --- | --- | --- | --- | --- |
| `--da-bg` | `#0c0e0d` | `#f4f1ea` | `#060a0c` | The page (the desk) |
| `--da-panel` | `#121514` | `#ffffff` | `#0d1316` | Cards, alerts, inputs |
| `--da-raised` | `#191d1b` | `#efebe1` | `#141c20` | Hover, notifications, disabled buttons |
| `--da-border` | `#242927` | `#ddd6c8` | `#20282c` | Default edges |
| `--da-border-strong` | `#313836` | `#c3b9a5` | `#333c41` | Emphasised edges, scrollbar thumb |
| `--da-text` | `#e8edea` | `#18160f` | `#eafcff` | Body text |
| `--da-text-secondary` | `#a7b2ac` | `#56504a` | `#a3b0b4` | Secondary lines |
| `--da-text-dimmed` | `#75817b` | `#6b6257` | `#7d8b90` | Dimmed text; every value clears 4.5:1 on bg and panel |

Mantine reads these through `cssVariablesResolver`: `--mantine-color-body` is `--da-bg`,
`--mantine-color-default` is `--da-panel`, `--mantine-color-dimmed` is `--da-text-dimmed`, and
`--mantine-color-anchor` is `--da-link`. So `c="dimmed"` and `variant="default"` already follow the theme.

### Accent, link and glows

| Token | Meaning |
| --- | --- |
| `--da-phosphor` | The accent: what you press or have selected. Mirrors `theme.ts`'s `phosphor[4]`. |
| `--da-link` | What an `Anchor` is drawn in. The accent on carbon and white, cyan on neon. |
| `--da-accent-light`, `-hover`, `-color` | Mantine's `light` variant for the accent, pinned per theme. |
| `--da-phosphor-glow`, `--da-tally-glow` | Alpha glows (selection, the live pulse). |
| `--da-series-a`, `--da-series-b` | The two series of a trend chart, checked per theme. |

### Chrome, motion and type

| Token | Value (carbon) | Use |
| --- | --- | --- |
| `--da-chrome`, `--da-chrome-blur` | `var(--da-bg)`, `none` | Header and the phone's tab bar. Glass on neon. |
| `--da-glow-panel` | `none` | Card shadow. Only neon sets one. |
| `--da-backdrop`, `--da-bg-glow` | one radial | The body background image. |
| `--da-texture` | 2.5% white | The scanline colour. |
| `--da-tracking-eyebrow` | `0.08em` (`0.2em` on neon) | Every uppercase label. |
| `--da-tracking-wordmark` | `0.12em` | The wordmark. |
| `--da-fast` | `120ms` | The only duration. There is no slow tier on purpose. |
| `--da-ease` | `cubic-bezier(0.2, 0, 0, 1)` | The only easing. |

### Palettes (`theme.ts`)

Every tuple overrides a Mantine built-in, so `color="red"` anywhere already means the retuned red.

| Mantine name | Console tuple | Means |
| --- | --- | --- |
| `phosphor` (primary, shade 4), `teal`, `green` | phosphor | The accent; `ok` |
| `dark` | carbon surfaces | Every dark-mode surface. Overriding `gray` alone is not enough. |
| `gray` | carbon | Neutral; `off` |
| `red` | tally | `live`, and the `failure` severity |
| `blue` | standby | `standby`, and the `notice` severity |
| `yellow` | fault | `fault`, and the `warning` severity |
| `grape` | authored | Work the station wrote (see `AuthoredBadge`) |
| `orange` | alarm | The half-step between skipped and unavailable |

### Spacing, radius, type

| Scale | xxxs | xxs | xs | sm | md | lg | xl |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spacing` | 2px | 4px | 8px | 12px | 16px | 22px | 30px |
| `radius` | | | 2px | theme (4px on carbon) | 8px | 16px | 32px |

Type is Mantine's own scale. Headings: h1 `1.875rem`, h2 `1.5rem`, h3 `1.25rem`, h4 `1.0625rem`,
weight 600, in the theme's display face. Density comes from `spacing`, table `verticalSpacing` and
card padding, never from shrinking the type.

### Utility classes (`tokens.css`)

| Class | Use |
| --- | --- |
| `.da-num` | Columns of figures: monospace, tabular. Any playhead, duration or count in a column. |
| `.da-scanlines` | The chrome texture. Header only, never content. |
| `.da-lamp-pulse` | The tally pulse. Genuinely live things only. Steady under reduced motion. |
| `.da-skip` | The skip link, visible only on keyboard focus. |

### Component defaults (`theme.components`)

`Card` has a border, `md` padding and the panel glow. `Table` uses `verticalSpacing: 6`,
`horizontalSpacing: 'sm'` and highlights on hover. `Alert` and `Notification` draw on a panel with a
2px left rule in their colour. A disabled `Button` goes to `--da-raised` with dimmed text.
`InputWrapper` caps a description at `70ch`. Title and button case and tracking come from each
theme's signage.

---

## Themes

| Id | Name | Scheme | Faces | Accent | Character |
| --- | --- | --- | --- | --- | --- |
| `carbon` (default) | Carbon | dark | Chakra Petch / IBM Plex | `#2fd98c` | A broadcast desk lit by one lamp |
| `white` | Studio White | light | Newsreader / Public Sans | `#0e7247` | Daylight and paper; accents darker, not lighter |
| `neon` | Neon Transmitter | dark | Chakra Petch / Archivo | `#fcee0a` | A night-city HUD; links cyan, glass chrome, glowing panels |

`[data-da-theme]` on `<html>` selects one, written by `theme.store.ts` and, a frame earlier, by
`public/theme.boot.js`. A theme differs from another only in tokens, palettes, faces and signage
(how a label is set). Layout conventions are the same in all three. A value that differs between
themes goes in a `--da-*` variable, never inline in the rule that uses it.

---

## The status vocabulary (`status.ts`)

Two vocabularies, because they disagree about red.

**`StatusTone`**: what state a thing is in.

| Tone | Colour | Means |
| --- | --- | --- |
| `live` | red | On air, running. The studio convention. |
| `ok` | teal (accent) | Working |
| `standby` | blue | Waiting, for a listener say. Not a fault. |
| `fault` | yellow | Broken. Amber, so it is never read as the transmitter. |
| `off` | gray | Stood down |

**`Severity`**: how badly something went.

| Severity | Colour | Means |
| --- | --- | --- |
| `failure` | red | The load that did not happen; an operator must act |
| `warning` | yellow | Failed while everything around it kept working |
| `notice` | blue | Not set up yet. Not a failure at all. |

Read the colour through `toneColor[tone]` or `severityColor[severity]`. Never write `color="red"` for
a status.

---

## Components

### Page structure

#### `PageHeader` (`page.header.tsx`)

The top of a page: what it is and what can be done to it. Actions always sit on the title's line, to
the right.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `ReactNode` | required | The `<h1>` |
| `eyebrow` | `string` | | Mono legend above the title naming the kind of page |
| `description` | `ReactNode` | | One line of orientation |
| `actions` | `ReactNode` | | Buttons, pinned beside the title |
| `children` | `ReactNode` | | Under the description, such as a row of badges |

| State | Behaviour |
| --- | --- |
| Desk | Actions pinned right and shrink-proof; a long title gives way first |
| Phone (`usePhone`) | Actions drop under the title and wrap |
| Inside `EmbeddedPage` | Title is `VisuallyHidden` at `h2`, eyebrow dropped; description and actions share a wrapping row |
| Inside `EmbeddedPage`, phone | The actions wrap among themselves and, when the description fills the row, drop to a line of their own, as on a full page |

**`EmbeddedPage`** wraps a tab body so the `PageHeader` inside it stops drawing a second page title.
The destination says it once, by context, rather than every page taking a flag.

Accessibility: one `<h1>` per page; an embedded page keeps its title in the accessibility tree so a
screen reader still announces which tab it landed on.

#### `SectionHeading` (`section.heading.tsx`)

The heading that opens a section of a page or card: an `h2` drawn at `h4` size, with an optional
dimmed sentence. Draws no frame of its own.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `ReactNode` | required | Section name |
| `description` | `ReactNode` | | What the section is for, dimmed |
| `maw` | `number` | | Caps the width when the heading shares a row with a button |

#### `Eyebrow` (`eyebrow.tsx`)

The small uppercase mono label that names a group of things. `xs`, weight 600, dimmed, tracked by
`--da-tracking-eyebrow`. Extends `TextProps`, so any `Text` prop passes through.

#### `DestinationTabs` (`destination.tabs.tsx`)

The tab strip under a destination's heading. The router is the only state: `active` comes from a
search param and `onSelect` navigates.

| Prop | Type | Description |
| --- | --- | --- |
| `tabs` | `readonly DestinationTab<TKey>[]` | `{ key, label, group?, hint? }` |
| `active` | `TKey` | The selected key |
| `onSelect` | `(key: TKey) => void` | Navigate here |
| `label` | `string` | Accessible name; a page can have more than one strip |
| `attention` | `readonly (TabAttention \| undefined)[]` | In tab order: `{ count, severity }` draws a badge in the severity's colour |

Drawn on every width. `group` draws a heading before the first tab of each run, and `hint` is the
tab's tooltip. One row that scrolls when it overflows: the selected tab is scrolled into view and the
overflowing edge is faded, both only when the row actually overflows. Tabs are buttons, not anchors, so the key union
stays the thing that guarantees the set is complete.

### Loading, empty and failure

#### `QueryView` (`query.view.tsx`)

A query's four states in the order every page draws them: failure, skeleton, then empty or answer.
A failure and an answer can show together: a failed refetch keeps the cached list under the alert.

| Prop | Type | Description |
| --- | --- | --- |
| `query` | `{ data, error, isPending }` | Any query-shaped object |
| `skeleton` | `ReactNode` | Usually a `PageSkeleton` |
| `errorTitle` | `string` | Optional title for the alert |
| `errorFallback` | `string` | required; the sentence when the error has none |
| `isEmpty` | `(data) => boolean` | Without it every answer is drawn |
| `empty` | `ReactNode \| (data) => ReactNode` | Usually an `EmptyState` |
| `children` | `(data) => ReactNode` | The answer |

```tsx
<QueryView
    query={playlists}
    skeleton={<PageSkeleton variant="table" />}
    errorFallback={t('list.loadFailed')}
    isEmpty={data => data.items.length === 0}
    empty={<EmptyState title={t('list.empty.title')}>{t('list.empty.body')}</EmptyState>}
>
    {data => <PlaylistTable rows={data.items} />}
</QueryView>
```

#### `PageSkeleton` (`page.skeleton.tsx`)

The three fixed shapes anything loads into, sized to match what replaces them so the layout does not
jump.

| Variant | Height | Use |
| --- | --- | --- |
| `rows` | 28px × `count` (default 3) | A list of lines |
| `table` | 260px | Where a table will be |
| `card` | 196px | One panel in a grid |

#### `EmptyState` (`empty.state.tsx`)

A place with nothing in it yet, which is not a place that is broken. A `Card` with `xl` padding, the
sentence capped at 520px.

| Prop | Type | Description |
| --- | --- | --- |
| `title` | `string` | Optional; some states are one sentence |
| `children` | `ReactNode` | required; why it is empty and what would fill it |
| `action` | `ReactNode` | A way out, when there is one |

| ✅ Do | ❌ Don't |
| --- | --- |
| Say what would fill it | Stop at the fact ("no plugins are mounted") |
| Use `notice`-level calm | Draw an empty list as an error |

#### `ErrorAlert` (`error.alert.tsx`)

Something went wrong, said the same way everywhere: a title the console wrote, then the detail the
server wrote (or the fallback when it wrote none).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | | What failed, in the console's words |
| `error` | `unknown` | | Whatever was thrown; read through `apiErrorMessage` |
| `fallback` | `string` | | The sentence when the error carries no message |
| `tone` | `Severity` | `'failure'` | `warning` when the page survived it |
| `onDismiss` | `() => void` | | Adds a close button; only for a failure whose page still works |
| `children` | `ReactNode` | | A finished sentence or list in place of `error` |

#### `ApiStatusBanner` (`api.status.banner.tsx`)

The one place the console says the server is gone, drawn across the top of the shell so the pages
underneath stay readable. A `warning`, because the console is stale and already retrying. No props.

#### `RouteError` (`route.error.tsx`)

The router's default error boundary: what a page shows when its loader threw. The shell stays
mounted around it. Offers a retry, a way back, and a disclosure with the detail.

### Status and labels

#### `StatusLamp` (`status.lamp.tsx`)

One thing's state, drawn in one of two emphases over the tone vocabulary.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tone` | `StatusTone` | required | See the vocabulary above |
| `label` | `string` | required | The state word, from a catalog |
| `emphasis` | `'lamp' \| 'chip'` | `'lamp'` | Dot and word, or a filled badge |
| `size` | `'sm' \| 'md'` | `'sm'` | Dot 8px or 10px; text `xs` or `sm` |
| `pulse` | `boolean` | `false` | The tally pulse. Live things only. |

| Variant | Use when |
| --- | --- |
| `lamp` | A state sitting quietly on a busy card |
| `chip` | The one state on a page worth seeing across the room |

Accessibility: the lamp form carries `aria-label` from `common:statusLamp.label`, so the dot is not
the only carrier of the state. The pulse stops (steady on) under `prefers-reduced-motion`.

| ✅ Do | ❌ Don't |
| --- | --- |
| One `chip` per page at most | A page of chips |
| `pulse` on the stream light and live things | Pulse anything that is merely busy |

#### `AuthoredBadge` (`authored.badge.tsx`)

The label on something the station wrote: a break, a talk-over, a model's writing. `grape` in the
`light` variant. `authored={false}` draws the neutral grey a person's work gets. Every other `Badge`
prop passes through except `color` and `variant`.

### Actions and dialogs

#### `ConfirmModal` (`confirm.modal.tsx`)

Asking before something that cannot be taken back. Declarative: the page holds the `opened` state.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `opened`, `onClose`, `onConfirm` | | required | Dialog control |
| `title` | `string` | required | The question, as a question |
| `children` | `ReactNode` | required | What goes, what stays, what it costs |
| `confirmLabel` | `string` | required | The verb, never "OK" |
| `confirming` | `boolean` | `false` | Loading state on the confirm button |
| `error` | `unknown` | | Reported inside the dialog |
| `errorTitle`, `errorFallback` | `string` | catalog defaults | Words for that failure |
| `errorMessage` | `(error) => ReactNode` | | The dialog's own words for a refusal (a 403) |
| `errorTone` | `Severity` | `failure` | `warning` for a refusal that is the station working as meant |
| `lockWhileConfirming` | `boolean` | `false` | Disable Cancel while it runs |

Layout: Cancel (`default`) then the confirm button (`red`), right-aligned.

| ✅ Do | ❌ Don't |
| --- | --- |
| Use this for anything irreversible | `window.confirm` |
| Use `notifyUndoable` instead when the action happens many times an hour | Put a dialog in front of a frequent, undoable action |

#### `SaveFooter` (`save.footer.tsx`)

The foot of a settings form: the Save button (`type="submit"`) with "Saved." beside it until the
form is touched again.

| Prop | Type | Description |
| --- | --- | --- |
| `saving` | `boolean` | Save in flight |
| `saved` | `boolean` | Last save went through and the form is not dirty |

#### Notifications (`notify.tsx`)

Toasts are success-only; failures go in an `ErrorAlert` where the operator is.

| Function | Colour | Auto-close | Use |
| --- | --- | --- | --- |
| `notifySaved(what)` | ok | 3s | A row is now on disk. `what` names the thing. |
| `notifyDone(message)` | ok | 3s | Any other completed action, in the caller's sentence |
| `notifyQueued(message)` | standby | 4s | Accepted, not yet happened |
| `notifyUndoable(message, { label, onUndo })` | ok | 6s | Done, and one click takes it back |

#### `CopyButton` (`copy.button.tsx`) and `CopyableCode` (`copyable.code.tsx`)

`CopyButton` copies `value` through `copyText`, which falls back to a selection copy where
`navigator.clipboard` is missing (a station over plain HTTP). When both fail it reads "Copy failed"
and opens a popover with the value already selected, as a `warning`. `value` may differ from what is
on screen.

`CopyableCode` is a value shown whole beside its `CopyButton`: a token shown once, a client id, an
invite link. It wraps rather than truncates, so the value can be checked. `Group` props pass through.

### Tables, feeds and rows

#### `SortableTh` (`sortable.th.tsx`)

A column heading that orders the table by its column. Two states, no "unsorted". The arrow is drawn
only on the active column. A new column starts ascending; a second click reverses.

| Prop | Type | Description |
| --- | --- | --- |
| `sortBy` | `TSort` | This column's key |
| `active` | `string` | What the list is ordered by now |
| `direction` | `'asc' \| 'desc'` | |
| `onSort` | `(sortBy: TSort, direction) => void` | Asked for both together |
| `w` | `number` | Passed to `Table.Th` |

Accessibility: a real button inside the `th`, so it is keyboard-reachable; `aria-sort` carries the
state.

#### `RowOpener` (`row.opener.tsx`)

The name in a clickable row, as a button a keyboard can reach. No handler of its own: Enter clicks
it and the click bubbles to the row's `onClick`.

#### `PhoneCard` (`phone.card.tsx`)

One row of a data table on a phone. A different selection of the row, not the same row narrower.

| Prop | Type | Description |
| --- | --- | --- |
| `leading` | `ReactNode` | Art, a rank, a moment; shrink-proof |
| `title`, `subtitle` | `ReactNode` | Two truncating lines (caller adds `truncate`) |
| `figure` | `ReactNode` | Right-hand figure; caller adds `.da-num` |
| `action` | `ReactNode` | Trailing touch target, 44px precedent |
| `below` | `ReactNode` | Full-width content under the main line |
| `onClick`, `aria-label` | | Whole-card tap with button role and keyboard reach |
| `accent` | `string` | Raised surface with an inset bar, for the card happening now |
| `opacity` | `number` | History at half weight |
| `depth` | `number` | Tree indent, 12px a step |

#### `DatedFeed` and `FeedMoment` (`dated.feed.tsx`), `FeedPage` (`feed.page.tsx`)

`DatedFeed` is a list of things that happened, newest first: a padless `Card` with a rule between
rows. It owns the separators; the caller owns what a row says. `FeedMoment` is the left-hand time
column (date and time in the operator's zone, `.da-num`, full date in a tooltip).

`FeedPage` is the whole shell of an infinite feed: children (filters), a failure, rows, then more
rows. The query is passed in so each page keeps its own filter hook; `failure` and `emptyMessage`
arrive already resolved to sentences.

### Media and content

#### `Artwork` (`artwork.tsx`)

A square of cover art, or a quiet placeholder (the initial of `alt`) where it would be. A URL that
fails to load falls back to the same placeholder.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | | Any spelling of an API art URL |
| `alt` | `string` | required | What the art is of; also the placeholder initial |
| `size` | `number` | required | Pixels, square |
| `radius` | `string` | `'sm'` | |

#### Catalog links (`catalog.links.tsx`)

`TrackLink`, `ArtistLink`, `AlbumLink` and `ScriptLink` take an optional `id` and `TextProps`. An
absent id draws plain text instead of a link that would 404.

#### `MarkdownView` (`markdown.view.tsx`)

Markdown in the console's own type, from the safe subset in `markdown.parse.ts` (no HTML path). Every
heading is drawn at the same small size, since it sits inside a card with its own title.

### Inputs and files

#### `OneTimeCodeInput` (`one.time.code.input.tsx`)

A six-digit code in one field, so a pasted code is never split. `autoComplete="one-time-code"` and
`inputMode="numeric"`. `onComplete` fires once when the last digit lands. Props: `value`, `onChange`,
`onComplete?`, `label?`, `error?`, `disabled?`, `autoFocus` (default `true`).

#### `UploadDropzone` (`upload.dropzone.tsx`)

Somewhere to drop a file: the page's `icon` at rest, an upload arrow for a file that fits, a cross
for one that does not. Takes `prompt`, `hint?`, `iconSize` (32), `minHeight` (90); every other
Mantine `Dropzone` prop (`accept`, `maxSize`, `loading`, `onDrop`) passes through. The checks are a
courtesy; the server refuses the same files.

#### `PackImportModal` (`pack.import.modal.tsx`), `ImportNotices`, `useImportFlow`

Importing authored rows from a file: choose, see the station's own preview, then add exactly what
was previewed. The caller supplies only the words that name the rows (`title`, `intro`,
`addingLine`), a `read` parser (`packFieldsIn` keeps only the named fields) and the `preview` and
`write` mutations. `ImportNotices` lists what to know about a file, dimmed, with `alarming` picking
out the exceptions.

### Hooks and helpers

| Export | File | Use |
| --- | --- | --- |
| `usePhone()` | `use.phone.ts` | Below the `sm` breakpoint. Answers on the first render. Never write the media query by hand. |
| `useDisclosureIds(open)` | `disclosure.ts` | Trigger and panel ids for a show/hide pair |
| `copyText(value)` | `clipboard.ts` | Clipboard with the selection fallback; resolves `false` on failure |
| `saveDownload`, `saveJsonDownload`, `downloadFilename` | `download.ts` | Hand the operator a file |
| `formatDuration`, `formatBytes`, `formatSpent`, `formatDate` | `format.*.ts` | Figures in the console's own form |
| `formatMomentStamp`, `formatMomentFull`, `formatMomentMinute`, `formatTimeOfDay` | `feed.moment.ts` | Times in the operator's zone |
| `ACCESS_CHOICES`, `accessWord` | `access.words.ts` | The view/manage scope words |

---

## Rules that are not cosmetic

- **Links**: `renderRoot={(props: object) => <Link to="..." {...props} />}`, never
  `component={Link}`. The `: object` annotation is what keeps `to`, `params` and `search` type-checked.
- **Figures in a column** carry `.da-num`, or the row twitches on every tick.
- **A truncating `Anchor`** needs `truncate` to actually clip; `a[data-truncate]` is made `block` in
  `tokens.css` for that reason.
- **Texture goes on chrome, the pulse on live things**, and neither anywhere else.
- **No wrapper for a convention**: a default for `Card`, `Table` and friends belongs in
  `theme.components`.
- **Words** come from `src/i18n/en/<folder>.catalog.ts`; shared components read `common`.
