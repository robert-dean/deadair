# The station on a Stream Deck

`apps/streamdeck` is an Elgato Stream Deck plugin: a Now Playing key (the cover, the title, a moving
playhead), Skip, and one key that is Stop while the station is on air and Start once it is stood
down. It is the operator's desk in hardware, and only the desk: it never plays the station.

Every paragraph records a decision or a measured failure and the reason for it. The always-loaded
index is [`CLAUDE.md`](../../CLAUDE.md); the operator-facing half is [`README.md`](README.md).

## Where it sits

**A workspace member for real, unlike the three listener apps.** It is TypeScript on the station's
own SDK, so turbo builds it, the root `vitest.config.ts` runs its tests, and `changes.sh` puts it in
the `node` flag. It also has a `streamdeck` flag and a `build.yml` job of its own, which checks the
one thing nothing else does: that the bundle stands alone (no import left that is not Node's own),
that Elgato's validator accepts the plugin folder, and that it packs.

**Every dependency is a devDependency**, because everything is inlined into one file and nothing is
installed beside it. That is also what keeps it out of the image: `.dockerignore` keeps only the
manifest, as for the listener apps, and the image's prod prune removes what the frozen install
fetched for it.

**Its own release unit.** `@deadair/streamdeck` has its own changelog and `streamdeck-v*` tags, and
`pnpm release:version` mirrors `package.json`'s version into the manifest's four-part `Version`
(`0.1.0` becomes `0.1.0.0`; the fourth part is left alone). The build job's `--check` fails when the
two disagree, so edit the package's version and never the manifest's.

**A release cuts itself, by the station's rule.** `release.yml`'s `streamdeck-version` job asks the API
whether `streamdeck-v<version>` exists; on the push to main where it does not (the merge of the
version pull request that moved the plugin's version), the `streamdeck` job calls
`streamdeck-release.yml` after that push's build and tests, and publishes the installer on a GitHub
release. A typo moves no version and releases nothing. The tag is made first and the release on it
with `--verify-tag`, with the release App's token when it is configured, exactly as the station's
`publish` does and for its reason: the workflow token is refused a tag on a commit main has moved past
with a workflow change. A tag made for a release that then failed is deleted, so the next push
retries. The same workflow runs by hand, from main only, to retry or to draft. So releasing the plugin
is: a changeset naming `@deadair/streamdeck`, then merging the version pull request.

The Marketplace is the one step left by hand: the same `.streamDeckPlugin`, uploaded in Elgato's Maker
Console, whose documentation describes no API.

**The Marketplace listing is in `marketplace/`**: the text typed into the Maker Console
(`listing.md`) and the thumbnail and three gallery images it takes, 1920 × 960. The pictures are drawn
by `tools/marketplace.media.mjs` from the plugin's own `nowPlayingSvg`, so the listing shows what a
key actually draws, and rasterised by macOS's `sips`; run it by hand when a key changes and commit
what it writes, as the desktop commits its generated icons. The covers in them are abstract shapes
and the records made up, because a listing is no place for somebody else's album art. Two things it
cost a render each to learn: that renderer ignores SVG 2's `paint-order`, so an outlined title came
out black and the titles are white over a shadow copy instead; and Node runs the renderer's `.ts`
straight through its type stripping, which works only because `key.image.ts` imports types alone.

Elgato's guidelines, checked on 2026-09-15: the plugin UUID in `{domain}.{product}` form and every
action's under it, never changed after publishing; the plugin icon a 256 and 512 PNG; category and
action icons white and monochrome on transparent (SVG preferred); key images that change with state,
at most ten updates a second; settings that save on change with validation feedback and no Save
button. The product's name cannot be changed in the Maker Console once submitted.

## The bundle

**One ES module at `radio.deadair.streamdeck.sdPlugin/bin/plugin.js`, with `bin/package.json` saying
`"type": "module"` beside it.** The Stream Deck app runs `CodePath` with its own Node (the manifest
asks for 24) and no `node_modules`, so tsup inlines everything, the station SDK and its luxon
included, and `noExternal` says so whatever section a dependency is listed in. `bin/` is git-ignored
and rebuilt from nothing, which is why the build writes the `package.json` rather than the tree
holding one.

**The bundle gives itself a `require`.** `ws`, which the Elgato SDK talks to the app through, is
CommonJS and calls `require('events')`, which an ES module does not have, and esbuild leaves those
calls in place. The banner in `tsup.config.ts` is `createRequire(import.meta.url)`. `bufferutil` and
`utf-8-validate` are left external on purpose: `ws` reaches for them inside a `try` and runs without.

**Decorators are OFF in this package's tsconfig, and that is not a style choice.** The SDK's
`@action` is a standard (TC39) decorator, and the base config's `experimentalDecorators` types it as
the legacy kind. Turning both off is what lets `tsc` accept it and esbuild lower it.

**`pnpm pack` is pnpm's tarball command and wins over a script of that name**, which is why the
script that builds the installer is called `installer`. It packs a COPY of the plugin folder,
because `streamdeck pack` rewrites the manifest it packs in its own formatting (every `Controllers`
array exploded, the trailing newline gone), and a local pack should not leave the tree dirty.
`--dry-run` does not write.

**`streamdeck validate` fetches the manifest's `URL` and `SupportURL`**, so in a sandboxed session it
fails with "URL must be resolvable" on a manifest that is fine. CI has the network; so does a laptop.

## One poller for every key

**The keys never ask the station anything themselves.** They subscribe to one `StatusPoller`, because
the station rate-limits by caller address (a hundred points in five seconds) and that bucket is shared
with whatever else is on the operator's network. It polls `GET /playout/status` every two seconds, the
console's interval and the station's own reconcile tick, and only while some key holds it: a deck on
another page asks nothing.

**A failure backs off, doubling to thirty seconds**, and a 429 waits at least as long as it asks. A
station that is down for an hour is asked about eight times a minute, and a revoked key does not
knock every two seconds. A command, or the settings changing, starts over.

**A failed poll keeps the last reading and marks it stale**, as on the desktop and the phone: blanking
a key throws away something true. A stale reading is never drawn in a live colour, and Skip and Stop
refuse a press on one.

**Stood down is read from the `stoodDown` GATE in `silence.checks`, never from the cause.** The gates
are judged in order and an unreachable stream comes first, so a station that is stood down and
unreachable names the second as its cause. The diagnosis builds every gate on every reading, so the
check is always there, and a fixture test holds the plugin to it: if it ever stopped being there,
Start would turn back into Stop.

**This is where a push channel would go.** The station has none. `subscribe` is the whole of what a
key sees, so a feed replaces the poller's timer and nothing else. Whether the station should have one
is a question for every client, not for this one, and belongs in an Ideas discussion first: the
API's "no event bus" rule is about the aired edge, which is exactly where a feed would listen.

## What the keys do

**Skip and Stop go through the same request as the console's and the desktop app's**, so the station
alone decides who may use them, as `apps/desktop/CLAUDE.md` says of the macOS media key. A key issued
Read only is refused there; this key shows the warning triangle and logs why. Where the console
DISABLES Skip (no stream, nothing on it), a key cannot be disabled, so it refuses the press and asks
nothing.

**Stop arms, then fires, and forgets.** The console's arrangement (`on.air.now.tsx`): the first press
arms and the key says "Confirm", the second inside five seconds stops the station. On a deck it
matters more than on a screen, because it is pressed without looking. Each key arms on its own, and
an armed key disarms when the station stands down by another hand or stops answering, because a
second press would no longer be the Stop it was arming. Start fires at once; the station answers 409
when there is nothing to resume, and the log says so.

**Pressing Now Playing opens the console** at the station's address.

## What the Now Playing key draws

**The cover is embedded in an SVG the app rasterises**, so no image decoder ships: a native one cannot
go in a packed plugin and a JavaScript one is a megabyte to produce 72 pixels the app scales anyway.
`xlink:href`, not the bare `href`, because the app's renderer is Qt's and SVG 1.1 is the spelling it
is sure to know; drawn that way, the cover shows on a Stream Deck+ (measured, below). The data URI is
`data:image/svg+xml,` plus `encodeURIComponent`, which is Elgato's documented form.

**It is redrawn only when what it shows changes**: another cover, another step of the bar, another
tone. The bar has 36 steps, a redraw every five to eight seconds on an ordinary record, because every
redraw carries the whole cover again.

**With no cover to show, the key draws the station's mark**: nothing on air, a break, a cover that
could not be had. It replaced a drawn record whose label carried the tone in its colour; the mark is
the station's own colours and cannot, so it says the tone by weight: full while airing or ready for a
listener, faint (0.4) when stood down, failing or stale, with the words under it saying which.
A cover follows the same rule: when the station stops answering, the key keeps the last cover, since
one missed reading must not blank it, but faint, so it reads as the last thing known rather than as
what is on air now. (Swapping it for the faint mark was the other choice, and was not taken because a
single timeout would flip the key to the mark and back.)
`imgs/plugin/mark.png` is the console's `logo-mark.png` at 144 pixels, read off the plugin folder at
start (`new URL('../imgs/plugin/mark.png', import.meta.url)`, from `bin/`) rather than bundled; a
plugin that cannot read it logs so and draws the old record instead. The manifest's own Now Playing
picture is the same quiet face, written by `tools/default.key.mjs` from the renderer, so the key does
not change picture the moment the plugin first draws.

**Each Now Playing key can leave out the bar, or the title and artist, or both.** Those are the
key's own action settings, not global ones: two keys can want different things, and a display choice
is exactly what should travel in an exported profile. Absent means shown, so an unconfigured key
draws everything. Turning the title off takes away the record's title and artist and the shade under
them, and never the station's own words ("ready", "off air") or a failure's ("No station"), because
a bare placeholder or a silently old cover would say nothing true. Turning the bar off also means
fewer redraws, since the image then changes only with the cover. The settings panel shows the two
checkboxes only when it is opened on a Now Playing key, saves on every tick (Elgato's rule for a
checkbox) with `setSettings`, and the plugin redraws that key alone from `didReceiveSettings`.

**The playhead refuses to guess**, as everywhere else in this tree: no duration or no countdown, no
bar. It counts ticks rather than reading a clock, so a suspended process stalls the bar instead of
jumping it.

**A cover is fetched once per record, WITHOUT the station's key.** The station serves its own covers
(`art/<uuid>`, under the API root) to anybody, and a provider's CDN must never see the key. A cover
that could not be had is remembered as such, so a 404 is asked once. JPEG, PNG and WebP only; a type
the app cannot decode would draw nothing rather than the placeholder.

## The settings

**Global settings, never action settings.** Elgato keeps an action's settings in plain text in every
profile somebody exports, and an API key acts as the account that issued it. The address is the
console's own, read by the listener apps' rules plus one forgiveness: a pasted `/api` is taken off.

**The key reaches a log only as its first eight characters and an ellipsis** (`redact`), which is the
hint the station itself stores and the console shows beside the key. The plugin's log is
`logs/` inside the plugin folder, written by the SDK; a failure is logged when it starts and when it
ends, not on every poll.

**The settings panel is written here, not taken from sdpi-components.** Elgato suggests that library,
but its npm package of the same name is not its author's, the protocol is six messages, and a
TypeScript panel shares the address parser and the message types with the plugin that answers it.
`src/inspector/` is built by tsup into `ui/station.js` beside the committed page.

**The panel never sends the settings to the plugin.** It writes global settings, the app hands them
over, and the plugin checks what it was handed and answers the open panel, so what the panel says is
about the settings the keys are actually using. The check asks `GET /nowplaying` first, with no key,
so a refusal after an answer there can only be the key. It cannot tell whether the key may ACT,
because finding out means skipping a record, and it says so.

## Running it

```bash
pnpm --filter @deadair/streamdeck build
pnpm --filter @deadair/streamdeck test
pnpm --filter @deadair/streamdeck validate
pnpm --filter @deadair/streamdeck run installer
```

**On a Stream Deck, a linked plugin runs only in developer mode.** `streamdeck link` puts a symlink
in the app's `Plugins` folder; `streamdeck restart radio.deadair.streamdeck` is refused with "Feature
only enabled in developer mode" (measured, Stream Deck 7.5.1) until `streamdeck dev` has turned that
on. Installing the packed `.streamDeckPlugin` needs neither.

**After a build, restart the plugin, or the settings panel and the plugin disagree.** The app reads
`ui/station.html` and its script from disk every time a panel opens, but runs `bin/plugin.js` from
the moment it last started it. So a rebuilt linked plugin shows the new panel at once while the old
plugin answers it. Measured on the first day: the Now Playing options were ticked off in the new
panel and saved on the key (the profile's `manifest.json` said so), and the keys ignored them,
because the plugin running was from before the options existed. `pnpm --filter @deadair/streamdeck
run restart` from the checkout that has the plugin; the app's log
(`~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`) says `Reloaded plugin` when it has. The same is
why `logs/` in the plugin folder is not to be deleted under a running plugin: it goes on writing to
the unlinked file, and the next log appears only after a restart.

**The bundle can be driven without the app**, and that is how it was checked. The app launches it
as `node bin/plugin.js -port <p> -pluginUUID radio.deadair.streamdeck -registerEvent registerPlugin
-info <json>`, with `info.devices` holding the device every `willAppear` names; a WebSocket server
on that port can then send `willAppear`, `keyDown` and `didReceiveGlobalSettings` and read back
`setImage`, `setTitle`, `setState`, `showOk`, `showAlert` and `openUrl`. The settings panel is the
same with `connectElgatoStreamDeckSocket(port, uuid, 'registerPropertyInspector', info, actionInfo)`
called on the page.

## What is verified, and what is not

Against the built bundle, with a fake Stream Deck socket and a fake station: registration, the
settings round trip, polling with the bearer and the plugin's User-Agent, the title and the cover
drawn and the bar stepping, the cover fetched with no `Authorization` header, a press opening the
console, a skip, an armed and fired Stop, a Start, and the settings panel in a browser saying in turn
that it needs an address, a key, that a wrong key was refused by a station it found, and that the
right one connects. Two Now Playing keys with different settings, one drawing the cover alone, and
a settings change redrawing only its own key; the panel's checkboxes opened on a key's own settings
and sending each tick. The embedded cover, the bar and the shade render in macOS's own SVG renderer.

On a Stream Deck: Robert ran it linked, in developer mode, on a Stream Deck+ with the Stream Deck app
7.5.1 against his own station on 2026-09-15, and it works. The Now Playing key shows the cover, which
settles the one thing the harness could not: the app's Qt renderer draws a raster `<image>` embedded
in the key's SVG through `xlink:href`. The Now Playing options work on the device too, a key with
both turned off drawing the cover alone, once the plugin was restarted onto the build that has them.

Skip, Stop (armed, then fired) and Start work on the device too, pressed against the live station
with a key issued Read and manage.

And the packed `.streamDeckPlugin`, built by the `installer` script and installed by double-click
over an unlinked dev copy, works the same: the ES module survives packing and the keys kept their
settings, which the app stores against the plugin's id rather than its folder.
