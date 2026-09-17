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
> Now playing shows what is on air: the cover, the title and who it is by, and a bar that fills as the
> record plays. When the station is quiet it says why, in the console's own words: ready, off air,
> warming up. Press it to open the station's console. The bar, and the title and artist, can each be
> turned off per key.
>
> Skip ends the record or break on air and plays the next one.
>
> Like and Dislike set what the station thinks of the record playing, the same opinion you would
> set from the running order in the console: a like plays it more often, a dislike means never
> again. The heart fills with colour when the station already agrees; press the lit one to take it
> back.
>
> Stop or start stops the station on the second press within five seconds, so a stray press never
> takes it off air, and once it is stopped the same key starts it again.
>
> You enter your station's address and an API key once, in any deadair key's settings, and every
> key shares them. The key is issued in the station's console under Settings, Security, API keys:
> Read only is enough for Now playing, and for seeing what the station thinks of a record; Skip,
> Stop and voting need Read and manage. It stays on your computer and never goes into a Stream Deck
> profile you export.
>
> The plugin needs a deadair station to talk to. deadair is free and open source:
> https://deadair.radio

## Release notes (0.1.0)

The first release: Now playing, Skip, and Stop or start.

## Release notes (next)

Like and Dislike: rate the record on air from the deck, and press the lit key again to take it back.

## Links

- Support: https://github.com/robert-dean/deadair/issues
- Website: https://deadair.radio

## Tags

Stream Deck, Stream Deck XL, Stream Deck MK.2, Stream Deck Mini, Stream Deck +, Stream Deck Neo; macOS and
Windows. Keys only: none of the actions uses a dial.
