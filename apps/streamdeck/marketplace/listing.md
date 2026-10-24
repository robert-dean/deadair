# The Marketplace listing

What is in Elgato's Maker Console for the plugin, kept here so the listing and the plugin change
together. Last checked against the console, and brought up to date there, on 2026-10-24 with 0.3.0;
before that the console had drifted from this file (it was still on 0.2.2, with a description
listing three actions and gallery images from before Like and Dislike), so check the console
before trusting this as a record of it.

The pictures beside this file are uploaded with it, all 1920 × 960: `thumbnail.png` as the
thumbnail, and in the gallery, in order, `thumbnail.png` again, `gallery-2-transport.png`,
`gallery-1-now-playing.png` and `gallery-3-states.png`. They are drawn by
`tools/marketplace.media.mjs` from the plugin's own key renderer; run it again when a key changes.
The gallery takes at least five (an empty fifth slot showed beside four) and needs three. It
cannot be reordered by dragging, so a new image goes in by uploading it and deleting what it
replaces, and the order is the order of upload. The app icon is the plugin's own,
`radio.deadair.streamdeck.sdPlugin/imgs/plugin/icon@2x.png`.

The product's NAME cannot be changed in the Maker Console after it is submitted.

## Name

deadair

## Description

The console's limit is 4,000 characters (it counts them below the editor). The editor has a
Markdown view, which is how this was pasted: each `\-` is a literal dash at the start of a
paragraph, which is how the live text has always set out its lists.

> deadair is a self-hosted AI radio station: it picks the records, writes what the presenter says between them, speaks it and streams it. This plugin puts the station's desk on your Stream Deck, so you can see what is on air and run the station without opening its console.
>
> The keys:
>
> \- Now playing: the cover, title and artist of the record on air, and a bar that fills as it plays. When nothing is playing it says why: ready, off air, warming up. Press it to open the station's console. The bar and the text can each be turned off, per key.
>
> \- Skip: ends the record or break on air and plays the next one.
>
> \- Stop or start: the first press asks to confirm, and a second within five seconds stops the station, so a stray press never takes it off air. Once stopped, the same key starts it again.
>
> \- Like and Dislike: set what the station thinks of the record on air. A like plays it more often; a dislike means never again. The heart fills when the station already agrees; press the lit one to take it back.
>
> \- Request: asks the station for a record, as a listener would. Pick one in the key's settings, or leave it unpicked and a press opens the console's request dialog in your browser.
>
> \- Grant request: for a station that approves requests by hand. A badge counts what is waiting, and a press lets the longest-waiting one through.
>
> The keys ask your station what is on air every five seconds while one is showing, and nothing while none is. A key that cannot reach the station says so, and dims the last record it knew rather than showing it as live.
>
> What you need:
>
> \- A running deadair station. deadair is free and open source: https://deadair.radio
>
> \- Stream Deck app 7.1 or later, on macOS 12+ or Windows 10+
>
> \- An address and an API key, entered once in any deadair key's settings and shared by them all. Issue the key in the station's console under Settings, Sign-in and security, API keys: Read only drives Now playing and Request; Read and manage adds Skip, Stop, Like, Dislike and Grant request. The key stays on your computer and never travels in an exported profile.

## Release notes (0.1.0)

The first release: Now playing, Skip, and Stop or start.

## Release notes (0.3.0)

As submitted on 2026-10-24. The second paragraph is there because the Marketplace went from 0.2.2
to 0.3.0, so the 0.2.3 to 0.2.5 fixes arrived with it.

> Two new keys. Request asks the station for a record you pick in its settings, or opens the
> console's request dialog when none is picked. Grant request counts the requests waiting for
> approval on a badge, and a press lets the longest-waiting one through.
>
> Also since 0.2.2: Skip names the record it was showing, so a press that lands just after that
> record ended skips nothing; the keys wait properly when the station asks them to slow down; and
> the settings point to Settings, Sign-in and security for the API key.

## Links

- Support: https://github.com/robert-dean/deadair/issues
- Website: https://deadair.radio

## Tags

Stream Deck, Stream Deck XL, Stream Deck MK.2, Stream Deck Mini, Stream Deck +, Stream Deck Neo; macOS and
Windows. Keys only: none of the actions uses a dial.
