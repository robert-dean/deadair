---
title: What it does
sidebar_position: 0
description: The six things a deadair station does, why each is built the way it is, and where each is explained.
---

deadair is a radio station you run yourself. It picks the records, writes what the presenter says between them, speaks it in that presenter's voice, and streams the result. It plays your music, not its own: it programmes what your provider already gives you, a Spotify account or a Subsonic server such as Navidrome. There is one mount and one running order, so everybody hears the same thing at the same moment. There is no per-listener shuffle and no skip button. What is on is what is on, and the station decides.

## It keeps a running order, and one thing owns it

The station works from a forward lineup several hours deep, which you can read and edit, and every item in it carries its own state. It is not a queue topped up behind the listener. Exactly one part of the station writes it: the console, the schedule and the model all send it requests rather than editing it themselves. That is what makes an edit made at 3pm still true at 3.05. What the order is asked to play, hour by hour, is [the programme](./programme.md). See [the running order](./running-order.md).

## It talks between records, and a model cannot make it silent

A break is written by whoever is presenting. When a local or hosted model is configured, the model writes it. When none is, when the model is slow, or when what it wrote failed a check, the station falls back to its own phrasings, which you can edit. That floor cannot fail, which is the whole design: a station whose presenter went quiet because a graphics card was busy is not a station. See [breaks](./breaks.md).

## It says things that are true, or it says nothing

When the presenter mentions a fact about a record, that fact is a stored claim, kept with the sentence of source prose that supports it. A claim with no source cannot be stored at all. The alternative is a presenter saying something specific, checkable and untrue, in exactly the voice it uses for things that are true. See [claims](./claims.md).

## Who is presenting is a character, and it accumulates

A presenter carries a voice, a way of speaking, how much rope it is given and how brief it is. It keeps a notebook of what it has said and the traits it is growing into, and a set of anecdotes it can tell on air. It can also take a phone-in: a produced block in which a caller and the host trade turns, each turn written separately and spoken in its own voice, joined into one file before it airs. See [characters](./characters.md) and [phone-ins](./phone-ins.md).

## It measures what it plays

A measurement program running beside the station decodes each record and reports its cue points and its loudness. The silence at the head and tail of a record is trimmed before the player sees it, a quiet master and a loud one arrive at the same level, and the gaps between records are sized from what the music actually does. It is a separate program because the station itself decodes no audio. An unmeasured record still plays. Each record's measurements are on its page in [the library](./library.md).

## It says why it is quiet

Eleven gates, checked in the order the signal flows, answer "why is nothing playing" with one verdict and, where there is something to do, the remedy. Silence is often deliberate: by default the station airs only while somebody is listening. Every change of verdict is written to the station's own log, so "why was it silent at three in the morning" is a question with an answer. See [the check-up](./check-up.md).

## The rest

- [The library](./library.md): every record the station has taken in, the playlists, charts and news it can draw on, and its opinion of each record.
- [Plugins](./plugins.md): the music providers, fact sources, speech engines, model and measurement adapter the station is built from.
- [Models and voices](./models-and-voices.md): which model writes which words, and which voice speaks them.
- [The console](./console.md): the broadcast desk you run it from, which deliberately does not play the station.
- [Listening](./listening.md): the stream, its formats, and the Android and macOS apps.

To run one, start with [the install guide](../install.md), and read [the music licensing notes](../licensing.md) before you publish an address.
