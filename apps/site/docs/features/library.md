---
title: The library
sidebar_position: 7
description: Where the station's music comes from, what it records about each record, how each one is measured, and why nothing airs until its audio is on the machine.
---

deadair holds no catalogue of its own. It programmes the music your provider already gives you, a Spotify account, a YouTube Music account or a Subsonic server such as Navidrome, and it grants you no rights to broadcast any of it: read [the music licensing notes](../licensing.md) before you publish an address. What it keeps is a library: an entry for every record it has met, and what it has learned about each.

![The library: every record the station has taken in, with its state and your rating](/img/console/catalog.tracks.webp)
*Fig. 1. The library's tracks.*

## Where the records come from

A music provider is a [plugin](./plugins.md). Three are bundled: **Spotify**, **YouTube Music**, and **Navidrome** or any other server that speaks the Subsonic API. The library fills from their playlists, because a playlist is the only list of records a provider will hand over, and the station walks them whenever a provider's settings are saved and again every hour. **Refresh now** on the Playlists page walks them at once, and **Refresh this playlist** in a card's menu reads just that one; the activity feed says when either is done. Under Settings, Housekeeping, you can make the automatic walk rarer or turn it off, which is worth doing on an account where reading every playlist is slow. A record taken out of a playlist is only retired by a walk of everything, never by refreshing one playlist. A Navidrome library with no playlists is still a complete setup: the plugin offers one extra playlist, Everything, which is the whole library.

When a model chooses a record no playlist carries, the station looks it up at your providers, and a strict match on title and lead artist becomes a real entry, marked "found". A near match is refused: it would air the wrong record under the right name.

**Spotify needs two authorizations, and you need both.** The connection lets the plugin read your library. The playback authorization, on the card below it, lets the station fetch the audio. With only the first, your playlists list perfectly and every record is dropped for want of audio. The card walks you through the second.

**YouTube Music signs in with a cookie you paste, and plays signed out.** There is no sign-in button to offer: Google withdrew that for this service, so the plugin's page asks for the Cookie header from a browser signed in to music.youtube.com, and says where to copy it from. It has no refresh and expires on the account's own schedule. When it does, the plugin's card says so rather than your library quietly thinning, because search goes on working signed out. If the browser is signed in to more than one Google account, **Google account** picks which one the playlists come from, and Test connection names the account it reached.

The cookie is for search and your library only. The audio is found by a small program bundled beside the station, which turns each record into an address the station downloads from itself, and it asks **without** your cookie, because YouTube currently serves a signed-in request nothing the station can download, Music Premium included. So a record that only an account may play, age-gated or members-only, is skipped rather than aired. The plugin ships switched off: read [the music licensing notes](../licensing.md) on what fetching this way means before you switch it on.

## What it records about each record

A record's page shows its title, artist, album, year and duration, and then:

- **Copies**: each provider's copy, whether it is on this machine, its format and size. A clean edit and the explicit original are one record with two copies, and the explicit label rides on the copy.
- **Measurement**: its cue points and loudness, when they were taken and by what.
- **Airings**: when it has played.
- **What the sources say**: genres, moods, label, and facts drawn from articles, each with the sentence that supports it. See [claims](./claims.md).
- **Your rating**: liked, neutral or disliked, which can also be set on the artist and the album. A dislike anywhere wins outright. See [the programme](./programme.md).

The tracks list filters by state: On this machine, Not fetched, Unmeasured, Failing and Benched. A zero under the last two is the answer you want.

## Measuring each record

Records rarely start and stop where the file does. A measurement program beside the station decodes each record and answers with four points (where the sound starts, where the intro ends, where the ending begins, where the sound stops) and its loudness to the EBU R128 standard. With them the station trims the silence at head and tail, knows how long a presenter may talk over an intro, sizes each blend from what both records do, and sets every record to one target loudness, so a quiet 1970s pressing and a loud modern master arrive level.

It is a separate program because the station's own server decodes no audio, and it is reached over HTTP, so moving it to a bigger machine is one address in the analyzer plugin's settings. A download that arrived cut short is reported as incomplete rather than measured, because a truncated file measures confidently and wrongly.

An unmeasured record still plays, untrimmed, left to the stream's live leveller. And one rule about blends has no exception: a record is never faded into speech.

## Nothing airs until its audio is here

A record is committed to the running order only once its audio is on this machine. Fetching from a provider at the moment the player needed the record once put two seconds of silence on air, so the station fetches several records ahead. A record whose audio has not arrived is held rather than skipped, so your sequence is never reordered by whichever download finished first. A copy that fails four times in a row is benched, a record with no copy left comes out of the order before its slot, and the next walk of the library gives a benched copy another chance if the provider still lists it. See [the running order](./running-order.md).

Every record fetched is kept, so a second airing costs no download. "Keep at most" under Settings → Playout caps the space; the least recently played go first, and never one about to air.

Records, cover art and the audio of everything the station has said are each stored as a file with a row in the database pointing at it. A crash between writing the one and the other can leave a file nothing points at, which nothing can reach again. Settings → Storage counts them, and **Delete media files nothing points at** under Settings → Housekeeping (off by default) removes them in a nightly sweep. A file is left alone until it has sat unclaimed for a day (an hour at the least), because a file being written this moment has no row yet either; a file two rows share is kept while either wants it. The activity feed notes each sweep that removes anything, under **Storage**.

## Playlists and charts

Two ways to put a whole list on air:

- **A playlist**: open it under Library → Playlists and press Air this playlist. The running order is rebuilt from it, in its order, and your dislikes and explicit-content policy still apply. A playlist none of whose records are in the library yet is refused, and the refusal says why: the library takes a playlist in when its provider is walked, so one added since the last walk needs **Refresh now** first. Aired anyway, it once put the station on air with nothing but the bed. The arrow beside the button offers **Air with similar records mixed in**, the way a smart shuffle does: every few records, a record by an artist who sounds like the one just played. The playlist still plays in full and in its own order around them. It needs a similarity plugin (Deezer needs no account; Last.fm needs a key), and **Play records the station does not own yet** on. With more than one enabled, **Which similarity source to ask first** under Settings, Rotation says whose suggestions the station reaches for before the others. To have every playlist do it, turn on **Mix similar records into a playlist** under Settings, Rotation, which also sets how many of the playlist's records play between mixed-in ones. A setlist never has anything mixed in.
- **A chart**, from a plugin that publishes one, such as Last.fm. Airing it puts the station on those records for a broadcast; when they run out it programmes itself again. Each entry goes through the same lookup and rules as any other pick.

Either can also be what the station plays when nothing is scheduled. See [the programme](./programme.md).

## In the console

**Library** in the rail, or the L key: Tracks, Artists, Playlists, Charts, News, [Podcasts](./podcasts.md) and [Readings](./narrations.md). A record's page opens from any list, or from its name typed into Jump to anything. A provider's connection, Spotify's playback authorization and YouTube Music's cookie are on its page under Settings → Plugins. Measurement has its own section in Settings.
