---
title: Podcasts
sidebar_position: 6.5
description: "How the station carries somebody else's programme, and makes shows of its own: subscribe to a podcast and put it on the format clock, or keep a show the station writes and speaks an episode of whenever you ask."
---

The station can carry a programme it did not make. Subscribe to a podcast, put a `syndicated` rule on the format clock about that show, and at that time the station airs the show's newest episode, whole, with your presenter handing over to it. It is the opposite of a [production](./phone-ins.md#other-productions), which the station writes and speaks itself; a `podcast` rule on the clock still means one of those. Between the two sits a [reading](./narrations.md): somebody else's words, in the station's own voice.

The same tab also keeps [shows of your own](#shows-the-station-makes): a podcast the station writes and speaks, an episode at a time, whenever you ask for one.

## Subscribing

The bundled Podcasts plugin reads the podcast feeds you give it, one row per show on its settings page. The address is the feed a podcast app would subscribe to, not the show's web page. The name is optional; leave it empty and the show's own title is used.

The Podcasts tab in the Library can find a feed for you. Search by a show's name, its publisher or its subject, and Subscribe adds the show to the plugin's list. The search asks Apple's public podcast directory, so what you type is sent to Apple; turn "Search Apple Podcasts for shows" off on the plugin's page and the station reads only the feeds you listed. "Directory country" picks which country's directory is searched.

The station reads every feed every half hour and remembers the newest episodes of each show. "Read the feeds now" on the Podcasts tab does it straight away.

## Putting a show on the clock

1. Add the show under **Voice**, **Subjects**, as a **show**. Pick the subscription it means; the name you give it is what your presenter calls it.
2. Under **Programme**, **Today**, add a rule to the format clock of kind `syndicated`, at the time you want it, about that show. A rule about no show carries the newest episode of any show you subscribe to.

Three hours before the rule's time, the station fetches that episode's audio into its own store. At the rule's time it puts the episode into the running order as one item, with a talk break in front of it where your station talks, so your presenter introduces it. The talk break is shown the show, the episode and what the publisher says it is about.

A rule carries the show's **newest** episode, and only if the station has not aired it already. On a night the show has published nothing new, the rule is passed over and the station goes on with its ordinary programming. It never reaches back for an older episode, and never airs a different show in its place.

A programme is still carried when the station's breaks are switched off. Turning breaks off stops the station talking; it says nothing about a programme you scheduled.

## On air

An episode airs whole. Players and listener apps show the episode's title and the show's name, as they would for a record, and its artwork where it has some. It is levelled as spoken word, a little under the music, from the loudness a mastered podcast usually has. It is never faded into, and it is not counted as a record: it does not affect what the station plays next, and it is not scrobbled.

The station's clock counts the episode's length, so a bulletin at the top of the next hour lands after the programme rather than inside it. A rule due while a programme is playing has no boundary near its time and is passed over, as it would be behind any long item.

## The Podcasts tab

The Podcasts tab lists the episodes the station knows about, newest first, and what it has done with each: not fetched, fetching, ready to air, aired, or could not fetch, with the reason. "Fetch now" asks for an episode's audio ahead of the clock, and "Try again" retries one that failed. The station tries a failed fetch three times on its own before it waits for you.

## Shows the station makes

**Your shows**, at the top of the Podcasts tab, are podcasts the station makes for itself: something to fall asleep to, or the day's news taken slowly. A show is a recipe, and every episode of it is a [production](./phone-ins.md#other-productions), written and spoken by the station and listed on the Productions tab like any other.

**New show** starts one, from a blank form or a template (**Wind-down** or **News in depth**). A show has:

- a name, and a description for you that is never read out;
- **What it is about**: the subject an episode is planned from when you ask for one without a topic of its own;
- **News it reads**: news feeds, for a show about the day's stories, and **Hours back** (a day when left empty);
- **Research each episode on your trusted sites**, which sends an episode handed nothing to read to the sites you trust in the web search plugin;
- a presenter, a length in minutes and how much to write it, each the station's default when left empty.

**Make an episode** asks for one. Give it a topic, or leave that empty for the show's own subject. Give it something to read first, either the address of a page or pasted text such as an article, a chapter or your own notes, and the episode states as fact only what it can find in that. Give it an **Air at** time and it waits, ready, for the first gap in the running order at or after that time; leave it empty and it airs as soon as it is made. An episode is written and spoken over the next few minutes, and appears under its show as it goes.

What an episode may state as fact depends on what it was given. A page or pasted text wins over everything else. Otherwise a show that reads the news reads the newest stories on its feeds within its window (at most six), and an episode is refused when those feeds have nothing that recent. Otherwise, with research on, it searches your trusted sites for its subject and fails, saying so, when none of them has anything. A production given something to read and finding nothing in it fails rather than being written from general knowledge, because that would be a different programme from the one you asked for. A story you keep off the air is kept out of an episode too.

An episode airs at the time it was given, not through the format clock: a show of your own needs no `syndicated` rule. **Delete** removes the show and keeps its episodes on the Productions page, and any still being made carry on.

## What it will not carry

- **Video.** An episode whose attachment is a video is not listed.
- **A feed that needs a login for its audio.** The station fetches the audio itself, with nothing but the address, so the address has to be enough.
- **An episode larger than 256 MB**, which is well over three hours of ordinary podcast audio.
- **Audio on your own network**, when the address comes from a feed. The station refuses to fetch from an address that resolves to its own machine or your local network, because a feed is somebody else's file and could point anywhere.
- **Raw AAC.** MP3, M4A, Ogg, FLAC and WAV are carried; a file in a format the station cannot play is refused with a reason rather than aired as silence.
