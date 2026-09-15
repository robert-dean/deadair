# deadair for Stream Deck

Your station on an Elgato Stream Deck: what is on air, Skip, and a Stop that asks twice.

## The keys

**Now playing** shows the record on air: its cover, its title and who it is by, and a bar along the
top that fills as the record plays, red while the station is on air. When nothing is playing it shows
the deadair mark, faint if the station is stopped or not answering, and says why in the console's
own words: _ready_ (waiting for a listener), _off air_ (somebody stopped it),
_warming up_, and so on. Press it to open the station's console.

Each Now playing key can leave out the bar, or the title and artist, from its settings, for a key
that is only the cover. It still says why when nothing is playing.

**Skip** ends the record or break on air and plays the next one. When there is nothing to skip it
shows the warning triangle and does nothing.

**Stop or start** is Stop while the station is on air. Press it once and it says _Confirm_; press it
again within five seconds and the station stops. Leave it and it forgets. Once the station is stopped
the same key is Start, which brings it back at once.

A key that cannot reach the station says so (_No station_, _Key refused_, _Set up_) and keeps showing
the last record it knew, faint and never in the on-air colour.

## Setting it up

1. Install the plugin: open the `.streamDeckPlugin` file from a
   [release](https://github.com/robert-dean/deadair/releases?q=streamdeck), or install it from the
   Elgato Marketplace. It needs the Stream Deck app 7.1 or later.
2. In the station's console, go to **Settings, Security, API keys** and issue a key. Choose **Read
   and manage** if you want Skip and Stop to work; **Read only** is enough for Now playing. Copy the
   key: the console shows it once.
3. Drag a deadair key onto your Stream Deck, open its settings, and enter the station's address (the
   one you open the console at, such as `radio.example.com`) and the key. **Test connection** says
   whether both work.

Every deadair key shares these settings, so you enter them once.

## Your key

The key is kept in the Stream Deck app's settings for this plugin on this computer. It is not saved
in your Stream Deck profiles, so exporting or sharing a profile does not share the key. The plugin's
log shows only the key's first eight characters, the same the console shows beside it. To stop a
Stream Deck using a key, revoke the key in the console.

The plugin asks the station what is on air every two seconds while a deadair key is showing, and
nothing while none is. It fetches covers from wherever the station says they are, without the key.

## When something is wrong

- **Set up**: no address or no key yet. Open any deadair key's settings.
- **No station**: nothing answered at the address. Check it, and that the station is running.
- **Key refused**: the station does not accept the key. It may be mistyped, revoked or expired.
- **Not allowed**: the account that issued the key may not read the station.
- **The warning triangle on Skip or Stop**: there was nothing to skip, the station was not answering,
  or the key is Read only. The log says which; for the last, issue a key with Read and manage.

The plugin's log is in its folder, under `logs/`: on a Mac,
`~/Library/Application Support/com.elgato.StreamDeck/Plugins/radio.deadair.streamdeck.sdPlugin/logs/`,
and on Windows, `%APPDATA%\Elgato\StreamDeck\Plugins\radio.deadair.streamdeck.sdPlugin\logs\`.

## Building it

See [`CLAUDE.md`](CLAUDE.md) for how it is put together and why.

```bash
pnpm --filter @deadair/streamdeck build
pnpm --filter @deadair/streamdeck run installer
```

The second writes `apps/streamdeck/artifacts/radio.deadair.streamdeck.streamDeckPlugin`.
