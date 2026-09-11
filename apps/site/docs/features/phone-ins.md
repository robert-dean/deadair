---
title: Phone-ins
sidebar_position: 6
description: 'How a caller rings in: a short programme your host and a caller trade turns in, each in its own voice, joined into one piece before it airs.'
---

A phone-in is not a break, which is one script in one voice. A call is a short programme: your host puts a caller on, the caller answers, the host comes back, and each turn is its own model call spoken in its own voice. The turns are joined into one piece of audio and go into the running order as a single item. Everything about a call that can be arithmetic (who speaks when, how long a turn is, how many people ring in) is decided by the station, not by the model.

![Productions: phone-ins and anything with more than one voice](/img/console/voice.productions.webp)
*Fig. 1. Productions.*

## Callers

A caller is a [character](./characters.md) with a different job. It can never present, and it has no phrasings of its own: phrasings are the station's floor under a break, and a phone-in whose caller was written from a template has nobody on the phone. Two callers ship with the station, each with a voice no host uses, since the two are in one programme talking to each other. Add more with "New caller" on Voice, Characters.

Who rings in is a rotation: the caller heard from least recently goes first. A station with no callers makes the programme with the host alone.

## Three ways to take a call

- **Take a call** on the Desk puts somebody on the phone now, about what the broadcast is playing unless you type another subject. It lands a few minutes later, because the turns are written and spoken one at a time.
- **A broadcast that takes calls.** "Take calls" under Settings, Rotation (off by default), or "Take calls during this broadcast" on a single block. "Minutes between calls" (thirty by default) counts from when the last call aired. A setlist or a feature never takes calls.
- **A clock band** naming `callin` on the format clock commissions one ahead of its slot.

All three inherit the show: its brief is the subject and its host presents. Otherwise a call would be about nothing in particular, presented by the station's default host rather than by whoever's programme it interrupts.

## How a call is shaped

A call runs two to three minutes by default. The host speaks first and last, so the number of turns is always odd. Turns are short and uneven on purpose: the host asks and hands over in about twenty-three words, the caller answers in about forty-three, and a three-minute call comes to around fifteen turns. At seventy words a turn, as they once were, a call was two people reading paragraphs at each other.

A short call gets one caller. A second is cast only when there are turns enough for both, and never more than three, because past that a listener meets somebody new every thirty seconds and none of them is a character.

The host puts the caller on air and takes them off: the opening turn introduces somebody holding, the caller's first turn is the one place a greeting belongs, and the last turn closes the call. A caller whose sheet gives them room may be wrong. They say what they think, never about a real named person and never anything shaped like news, and the host's next turn takes it as their view rather than confirming it.

## Written, spoken, joined

"How much to write a production" sets the passes: quick (one draft per turn), outlined (plan, then write; the default), or polished (plan, write, then check and fix). Once every turn has been spoken, each is trimmed to where its speech starts and stops, and they are joined with "Pause between turns" between them: 200 milliseconds by default, anywhere from 0 to 2,000. The result airs as one item with one title on the stream.

Joining needs decoded audio, which never happens inside the station itself, so it goes to the plugin set under "Join audio with"; the bundled measurement sidecar does it. With none available, or if a join fails, the turns go in as a block, and the activity feed says which.

A change of presenter does not rewrite a programme's turns. A production needs a model, since there is no floor under a phone-in. One that cannot be written is marked failed on the Productions tab, with the reason.

## A caller remembers

Every turn is recorded with its speaker, in the same history as the station's breaks, so callers take part in the nightly notebook and story passes exactly as hosts do. A caller is offered a story on their first turn only. Offered every turn, it becomes somebody telling the same anecdote three times in four minutes.

## Other productions

The same machinery makes longer programmes in one voice. A clock band naming `podcast`, or "Ask for one" on the Productions tab, commissions one: a title, a brief in your own words, a length (eight to twelve minutes by default), how much to write it, and a presenter. The brief matters most, because the planning pass works from it. "Which productions have callers" decides which kinds are conversations; by default, only `callin`.

## In the console

Voice, Productions lists what the station is making and has made: its state (queued, planning it, writing it, checking it, speaking it, joining it up, ready, in the running order), its length, how many turns are written, who is on it, and a Stop button while one can still be stopped. The words are on Voice, What it said. Call spacing is under Settings, Rotation; length, passes, pause and joiner under Settings, Voice and audio.
