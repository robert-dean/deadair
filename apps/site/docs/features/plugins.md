---
title: Plugins
sidebar_position: 9
description: The twelve bundled plugins that bring the station its music, facts, voice, words and measurements, and how trust and permissions work.
---

Almost everything the station reaches outside itself is a plugin: where the music comes from, what it knows about a record, how it speaks, which model writes its words, and the program that measures its audio. Twelve are bundled in the image, and each is switched on and configured from its own page. A plugin somebody else wrote is installed by copying it into the plugins folder on the station's data volume, and is then held to exactly the same rules.

![The plugin catalogue: a card per plugin and its state](/img/console/plugins.webp)
*Fig. 1. The plugins.*

## A missing plugin degrades the station

With no model the station writes its own breaks from its phrasings. With no voice it plays records. With no analyzer every record plays, unmeasured. The one it cannot do without is a music provider: there is nothing to programme until there are records.

## The bundled twelve

**Music**

- **Spotify.** Search, your playlists and the audio. It needs two authorizations: see [the library](./library.md).
- **Navidrome**, or any Subsonic server. Your own library and playlists. It also reads the facts in your files' tags, the only description that exists for a bootleg or a local band.

**Facts about records**

- **MusicBrainz.** Canonical identity for artists, releases and recordings, with genres, label, cover art and artist background. A free ListenBrainz token, or your own mirror, gets past the public service's one request a second.
- **Last.fm.** Community tags as genres and moods, artist background, the charts, who sounds like whom, and scrobbling, which is off by default. Its terms are non-commercial.
- **Wikipedia.** Articles about the songs, records and artists in the library, in the language you choose. The station draws its facts from this prose and keeps the sentence behind each. See [claims](./claims.md).

**The world outside**

- **Web search.** SearXNG, self-hosted with no account, or Brave or Tavily, which need a key. Give it sites worth quoting and it reads those, and only those, for background on records.
- **RSS.** The feeds you point it at, for news bulletins, and optionally the story behind each headline.
- **Weather.** Open-Meteo, which needs no account and covers the world; the US National Weather Service, free and United States only; or OpenWeatherMap, which needs a key.

**Voice and words**

- **Kokoro.** Any OpenAI-compatible speech server, pointed by default at the Kokoro voice the `latest` and `full` images bundle.
- **Chatterbox.** A voice read from reference clips, with the model on the graphics card managed by the plugin.
- **Language model.** As many providers at once as you add: OpenAI-compatible servers, Anthropic and Gemini. See [models and voices](./models-and-voices.md).

**Measurement**

- **Audio analyzer.** Measures each record's cue points and loudness, and joins several pieces of audio into one, so a [phone-in](./phone-ins.md) airs as a single item.

## Plugins are trusted code

A plugin runs inside the station's server process with its privileges. It can read and write files, open network connections, and read the server's environment, including the database and encryption credentials. The first time you enable one, the console says so and asks you to confirm. Enable a plugin as you would add a dependency to a project: because you trust who wrote it. There is no sandbox, and none is planned.

What the station does is hold a well-behaved plugin to what it said:

- **It reaches only the hosts it names**, or the address you gave it in a setting. Anything else is refused, every redirect is checked again, and each service is paced at its published rate limit.
- **Every call is bounded** in time, and the answer in size.
- **Secrets are write-only**: encrypted at rest, never shown again, never returned by the API.
- **A failing plugin is set aside.** Three failures in a row mark it Failed, so calls stop piling up behind it. If the fault can clear, the station probes it and restores it when it answers; if not, as with a rejected key, saving its settings brings it back.

That protects an honest plugin from a hostile service, and you from a careless plugin. It does not protect you from a hostile one. The permissions a plugin declares describe what it says it needs; they are not a limit on what it can do.

## What a plugin asks you for

A few capabilities are too wide to allow by default, so a plugin must ask and you must answer. There is one today: the open web, meaning any public address rather than only those its manifest names or you supplied. RSS asks for it, because the stories behind the headlines are on whatever sites your feeds link to, and only the feeds know which.

Even allowed, private and loopback addresses stay refused, including behind a public name, so the open web never means your router. Each new host the plugin reaches is logged the first time.

A request shows the plugin's reason, quoted, beside what allowing it actually does, in the station's own words. The answer is Allow or Deny; an unanswered request reads as Denied, and a decision takes effect on the plugin's next request. A refused request makes a plugin look misconfigured (RSS reads headlines with no stories behind them), so it is shown at the top of that plugin's page too.

## In the console

**Settings → Plugins**: a card per plugin with its state (Active, Disabled, Misconfigured, Failed or Discovered), and Rescan, which picks up a plugin added to the plugins folder on the station's data volume. A plugin you installed yourself is marked Installed, and one that failed to load names the folder the station read. A new version of an installed plugin takes effect when the station restarts. A plugin's page holds its settings, Test connection, anything it has asked for, and its log. **Settings → Waiting on you** lists every request from every plugin, and is empty when nothing has asked, which is the ordinary state. Where several plugins could do one job, the Words, Voice and audio, and Measurement sections of Settings say which does it.

## Installing one, or writing one

A plugin is a folder holding its `package.json` and its built code. Copy it into `plugins/` inside the station's data volume, press Rescan, and enable it. Where that folder is on each kind of install, and everything about writing a plugin of your own, is in [writing plugins](../plugin-development/index.md).
