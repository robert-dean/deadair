---
title: Breaks
sidebar_position: 3
description: How the station decides what to say between records, why a model can never make it go silent, and where every word it wrote is kept.
---

A break is anything the station says between records: a link, a welcome for somebody just tuned in, a news bulletin, the weather, a presenter's story. Every kind has more than one writer, and the last in line cannot fail. A slow or missing model costs the station a better sentence. It never costs it the break.

![What it said: every break written, and every one declined](/img/console/voice.said.webp)
*Fig. 1. What it said.*

## Two writers, and a floor

Each kind of break has a model writer in front and the station's own phrasings behind it. If the model declines, answers with nothing, fails or takes too long, the phrasings write the break. That floor needs no model and no network, so it cannot fail.

The model writer is off on a fresh install. Until you turn on "Let a model write the talk breaks" under Settings, Words, every break comes from the phrasings, instantly. The same switch covers welcomes, bulletins, weather and stories. Connecting a model is covered in [Models and voices](./models-and-voices.md).

The phrasings are yours: "What the station says" under Settings, Rotation, one per line, with placeholders such as `{{next.artist}}` and optional parts in `[[double brackets]]`. Empty the box and the station's own come back; to stop it talking, turn off "Let the station interrupt itself". The character on air can bring its own phrasings, which go first: see [Characters](./characters.md).

There is one model slot, and a break has priority on it over background work. A break that waits too long for it gives up and lets the floor write. Breaks are written as their slot nears, up to eight items ahead, and a station off the air writes nothing.

## What the model is asked for

The ceiling is forty words, about fifteen seconds, and it is a ceiling rather than a target: the median break on this station runs to twenty-eight. A talk break names a record, says what the presenter makes of it, and makes one point. The notes the station holds about each record are offered, never required.

A failed check sends the break to the floor rather than back for another draft:

- A talk break naming neither record it was shown is declined: it sounded like the character, and nobody knew what was playing.
- The model is told which part of the day it is, and "tonight" at nine in the morning is declined. This rests on "Station timezone" under Settings, Station; left empty, it is the container's clock, often UTC.
- When the station knows nothing about a record beyond its listing, the model is told so, and told to state no dates, labels or pressings. Before that rule the station invented catalogue numbers.
- A script that runs long is cut at the last whole sentence that fits.

A model can be given tools to search the library, the news and the web, though not while writing a break: no tool answer reaches air in one.

## Bulletins

"The feeds a bulletin reads" under Settings, Rotation is an ordered list. Empty, every feed is read. Filled in, only those feeds are, one story from each in turn, so a publisher posting twenty times a day cannot crowd out one posting three times.

A bulletin never repeats a story while it is fresh (twelve hours by default), and when everything fresh has been read it is skipped. It is not shown notes about the next record, because a bulletin finishing a note it half understood is how this station once aired false discography. It reports in its own words and keeps the facts, never reads a headline and then restates it, and stops when the stories stop. The floor under it reads the headlines as published.

News categories under Voice, Subjects let a band on the format clock ask for a subject; a bulletin whose category matches nothing is skipped rather than aired under the wrong name. A category marked off air is withheld everywhere, which is how a publisher's deals desk stays out of your news.

## The weather

Where the station is, and its units, are under Settings, Station. A weather break states only figures a service measured: no comparison with yesterday, no advice about coats. A model naming a temperature it was not given is declined, and a reading that will be older than "How old a reading may be" (two hours by default) when it airs is not used.

## The record of what was written

Every attempt to write a break is kept: the words or why there were none, the writer, the model, the character, the records either side. A model that declined and the floor that covered for it are two rows, because the second alone reads as a station that never had a model. Rows are kept for ninety days by default (Settings, Voice and audio). The prompt and the raw answer are kept only while "Keep the prompt and the raw answer" is on under Settings, Words, which is meant for an evening of tuning.

## In the console

Voice, What it said lists every attempt, newest first, filtered by outcome (written, declined, failed) and by writer (model or floor). Open a row for the detail; a break in the running order links to its own attempts. The format clock is under Programme, Today.
