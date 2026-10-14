---
title: Tutorials
description: Step-by-step walkthroughs. Installing the station, then giving it a model, characters, shows and voices of your own.
---

# Tutorials

These pages are walkthroughs: numbered steps, what you should see after each one, and what to do if
you do not. They leave the reasons to the rest of the docs. Each step that has a reason behind it
links to the page that gives the reason, so read on from there when a step surprises you.

If you only want a station talking between records as fast as possible, [Quick start](../quick-start.md)
makes every choice for you and is shorter than any of these.

## Install it

1. [Before you install](./prerequisites.md): what to have ready, and how big a machine.
2. Install the station, either [on Unraid](./install-unraid.md) or [with Docker Compose](./install-compose.md).
3. [Your first hour on air](./first-hour.md): music, a name, a presenter, and something playing.

## Create with AI

The station's own model does some of this from buttons in the console, and Claude connected to the
station can do the rest by being asked. Each page shows both where both exist.

1. [Give the station a model](./connect-a-model.md): a provider, the jobs it does, and connecting
   Claude if you want it.
2. [Write a character](./write-a-character.md): one sentence in, a whole presenter out, auditioned
   before it airs.
3. [Make a show](./make-a-show.md): a block on the timetable with a host and a brief the model
   programmes against.
4. [Make a voice](./making-a-voice.md): design one in Claude with ElevenLabs, clone it, and give it to
   a character.

## Grow the station

Each of these adds one thing to a station that is already on air, and none depends on another.

- [Add a second music source](./another-music-source.md): a second provider beside the first, and a
  playlist brought in from either by its link.
- [News and weather in the breaks](./news-and-weather.md): headlines from your own feeds, a forecast
  for where the station is, and a bulletin at the top of the hour.
- [Carry a podcast](./carry-a-podcast.md): subscribe to a show and give its newest episode a time on
  the clock.
- [Play the station on a speaker](./speakers.md): a Chromecast, a Sonos, a BluOS player or a UPnP renderer, started
  from the Desk.
- [Put the station on a chat platform](./chat-platforms.md): a bot on Telegram, Discord or Slack that
  says what is playing, takes requests, and lets you run the station from a chat.
- [Light up an On Air sign with Home Assistant](./home-assistant.md): the station telling your own servers
  what goes on air, so a light can follow it, and Home Assistant driving the station back.

## More

- [Produce a segment](./produce-a-segment.md): a short programme the station writes and voices itself,
  a listener's call, and a guest in the studio.
- [Throw a party](./throw-a-party.md): a code on the TV, and guests asking for records from their
  phones with no account.
