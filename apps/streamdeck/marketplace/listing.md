# The Marketplace listing

What is typed into Elgato's Maker Console for the plugin, kept here so the listing and the plugin
change together. The pictures beside this file are uploaded with it: `thumbnail.png` as the
thumbnail, and the three `gallery-*.png` as the gallery, all 1920 × 960 as the console asks. They are
drawn by `tools/marketplace.media.mjs` from the plugin's own key renderer; run it again when a key
changes. The app icon is the plugin's own, `radio.deadair.streamdeck.sdPlugin/imgs/plugin/icon@2x.png`.

The product's NAME cannot be changed in the Maker Console after it is submitted.

## Name

deadair

## Description

Under the console's 1,500 characters.

> deadair is an AI radio station you run yourself: it picks the records, writes what the presenter
> says between them, speaks it and streams it. This plugin puts its desk on your Stream Deck.
>
> Now playing shows the cover, the title and artist, and a bar that fills as the record plays. When
> the station is quiet it says why: ready, off air, warming up. Press it to open the console. The bar
> and the title can each be turned off per key.
>
> Skip ends the record or break on air.
>
> Like and Dislike set what the station thinks of the record playing: a like plays it more often, a
> dislike means never again. The heart fills when the station already agrees; press it again to take
> it back.
>
> Stop or start stops the station on the second press within five seconds, so a stray press never
> takes it off air, and then starts it again.
>
> Request asks the station for a record, as a listener would: pick one in the key's settings, or
> leave it unpicked and a press opens the console's request dialog. Grant request counts the requests
> waiting for approval and lets the longest-waiting one through.
>
> Enter your station's address and an API key once, in any deadair key's settings. Issue the key in
> the console under Settings, Sign-in and security: Read only is enough for Now playing and Request,
> and the other keys need Read and manage. It stays on your computer and never goes into a profile
> you export.
>
> The plugin needs a deadair station, which is free and open source: https://deadair.radio

## Release notes (0.1.0)

The first release: Now playing, Skip, and Stop or start.

## Release notes (0.3.0)

Two new keys. Request asks the station for a record you pick in its settings, or opens the console's
request dialog when none is picked. Grant request shows how many requests are waiting for approval
and lets the longest-waiting one through.

## Links

- Support: https://github.com/robert-dean/deadair/issues
- Website: https://deadair.radio

## Tags

Stream Deck, Stream Deck XL, Stream Deck MK.2, Stream Deck Mini, Stream Deck +, Stream Deck Neo; macOS and
Windows. Keys only: none of the actions uses a dial.
