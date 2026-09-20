---
'@deadair/plugin-deezer': minor
---

A Deezer similarity source, so discovery works without an API key

The station already reaches past its own library: it programmes part of every
hour from artists who resemble what has recently aired, mixes neighbours into a
playlist on request, and fetches a record it does not own when something picks
one. All of that needed a similarity plugin, and there was exactly one —
Last.fm, which needs an API key you have to go and register for. Until you had,
the settings said discovery was on and nothing came of it.

Enable Deezer and it works. There is no account, no key and nothing to fill in:
Deezer's catalogue answers who resembles an artist, and what to play by them, to
anyone who asks.

It sits alongside Last.fm rather than replacing it. Two sources disagreeing
about who sounds like Portishead are not in conflict, so the station keeps every
name both of them offer and has a wider pool to programme from than either gives
on its own.

One thing worth knowing: Deezer's search is fuzzy and ranks by popularity, so
this plugin takes an exact name match or nothing. An artist Deezer does not
carry under the spelling your library uses is passed over quietly rather than
answered with the nearest famous act, which would fill an hour with the wrong
scene and look perfectly healthy while doing it.
