---
title: Facts and claims
sidebar_position: 4
description: How the station knows what it says about a record, how it checks what a break promises, and how your opinion of a record reaches the rotation.
---

When the presenter says something specific about a record, it is repeating a claim the station holds, stored with the words it came from. A claim with no source cannot be stored at all. The alternative is a presenter saying something specific, checkable and untrue in exactly the voice it uses for the things that are true, and a listener cannot tell the two apart.

![One record: the station's opinion of it, its airings, its claims](/img/console/catalog.track.webp)
*Fig. 1. One record in the library.*

## Where a claim comes from

A plugin fetches and the station thinks. The MusicBrainz plugin identifies a record. The Wikipedia plugin takes that identity, finds the matching article through Wikidata, and hands the article over as it stands, writing no sentence of its own, because only the station can check a claim against the text it came from. Each claim is one sentence, stored with the article's address and the exact words that support it.

## Two ways to read an article

The first needs no model. An article's opening sentence is already a sourced claim, with itself as its quote, so a station running the Wikipedia plugin collects these whether or not it has a model.

The second is off by default: "Let a model find trivia in the articles" under Settings, Words. A model reads further in for what an opening line cannot carry: a film the record was used in, who played on it, what it was banned for. It must quote the words that state each claim, and a claim whose quote is not in the article is dropped. A second call then checks each claim against its quote alone, having never seen the article, and is told to answer no when in doubt. It is a separate conversation on purpose: a model asked to check its own list in the same breath approves it. The pass runs at the lowest priority and takes days to get through a library, so it is the place for a slower, more careful model.

## How a claim reaches air

Only a model speaks a claim; the station's own phrasings never carry a fact. When a break is written, the sourced claims about the records either side are offered first, and the enrichment plugins' own notes fill any room left. A claim that has been used rests for a week, so a listener does not hear the same line every evening. Nothing retires: a fact said fifty times is still true. When the station knows nothing about a record, the model is told so: see [Breaks](./breaks.md).

## What a break promises

Some things a break says can stop being true before it airs. Each is checked while the break can still be rewritten, and again at hand-over, where a broken one is dropped.

- **The next record.** "Coming up, X" is recorded against the running-order line it named. If an edit means X no longer plays next, the break goes. The next record is offered to a writer only when nothing sits between the break and it.
- **The time.** "Just after nine" is wrong at ten to nine as well as at half past, so a break naming the time carries a window at both ends.
- **A measurement.** A weather reading carries an expiry, and a break reporting one does not outlive it.

Silence on one boundary beats a wrong promise.

## The station's opinion

Artists, albums and records each take a rating: liked, no opinion, or disliked. A dislike anywhere wins outright, so a disliked artist's records do not play whatever you think of any one of them. It is an instruction, and nothing routes around it: the library's draw, a model's choices, a playlist put on air and a record found at a provider all pass the same check.

Otherwise the strongest like carries. Liking an artist means play more of them; liking one song means play that song more. In the library's own draw a liked record is twice as likely to be picked.

## Explicit content

Explicit or clean is a label on a copy, as the provider marks it. Nothing reads lyrics. "Explicit content" under Settings, Rotation has three positions:

- **Play the original version**, the default.
- **Prefer a clean version where there is one.** A lean, not a promise: the original plays when it is all there is.
- **Only play records marked clean.** Strict on purpose. Most providers never mark anything, so a library from one of them plays nothing, and the station says so on the activity feed rather than looking empty.

Either of the last two also keeps the presenter's own words clean, even for a character given extra room. The policy outranks your preference between providers: one is a rule about content, the other a preference about delivery.

## In the console

Library, Tracks, then any record: its rating, where its copies come from, its measurement, when it has played, and what the station believes about it. Each claim shows its category, and "Show the source" opens the quoted words and a link to the article, which is where to go when something sounded wrong on air. Opening-line claims and model-read claims are marked apart, because the first can only be wrong if the article was. Beneath them are the providers' own notes, and when each was asked. Artists and albums carry the same rating control. More in [Library](./library.md).
