---
title: Writing plugins
sidebar_position: 0
description: What a deadair plugin is, what it can do for a station, what the station promises it, and how this section is laid out.
---

A plugin is how a station reaches anything outside itself: where the music comes from, what it knows about a record, the news, the weather, the voice, the model that writes its words, the program that measures its audio. Fourteen come with the station, and a station loads one you wrote beside them without being rebuilt.

It is a Node.js package and nothing more. You need Node and a running station; you do not need a checkout of the station's repository.

```bash
npm install     # in a copy of the example plugin
npm run build   # writes dist/index.js, which is the whole plugin
npm pack        # the tarball you import from Settings, Plugins
```

[Your first plugin](./getting-started.md) is that sequence in full, starting from a complete, working `charts` plugin that follows Apple Music's most-played songs, and ending with a chart the station can air.

The station imports a plugin into its own server process, hands it a host to reach the world through, and calls it when it needs what the plugin said it could do. It ships no user interface: it declares its settings, and the console draws the form. It talks to no database: the host keeps its settings, its secrets and anything it wants to remember.

## What a plugin can do

A plugin declares one or more capabilities, and implements the methods each one asks for.

- **`catalog`**: supply music, as playlists and their tracks.
- **`stream`**: get the station the audio for a track.
- **`steer`**: own the audio output, and let the station say what to play.
- **`enrichment`**: supply facts about a record, and the prose the station reads its facts out of.
- **`speech`**: say something out loud. Text in, audio out.
- **`llm`**: produce words. A conversation in, text out.
- **`analysis`**: measure a record's audio for its cue points and loudness.
- **`mixer`**: make one piece of audio out of several.
- **`charts`**: say what is popular, as a ranked list of names.
- **`similarity`**: say which artists and records sound like which.
- **`news`**: supply headlines, and the story behind each.
- **`podcast`**: say which shows the station subscribes to and what each has published, with the address of every episode's audio.
- **`narration`**: offer text the station reads out as a programme (a book by the chapter, a newsletter by the issue) as series, their instalments, and the words of one on request.
- **`search`**: search the open web.
- **`weather`**: say what it is like outside, as measurements.
- **`almanac`**: say what happened on a date, as entries somebody else published.
- **`scrobble`**: report what the station played to somebody else's service.
- **`oauth`**: hold an operator's tokens, obtained through the host's redirect.

A plugin that answers a question the station already asks is the usual shape: a second weather service, a chart from a country's own charts company, a Subsonic server that behaves differently from Navidrome. Every capability reaches the rest of the station through the same rules as the bundled plugins, so a chart from your plugin passes the same dislike veto and repeat rules as any other pick.

## A plugin is trusted code, and nothing about that is going to change

A plugin runs inside the station's server with the station's privileges. It can read and write files, open network connections and read the server's environment, including the database and encryption credentials. There is no sandbox, and none is planned. The first time an operator enables one, the console says so in those words and asks them to confirm.

What the station does is hold a well-behaved plugin to what it said. It reaches only the hosts it names, every call is bounded in time and size, its secrets are encrypted and never shown again, and a plugin that keeps failing is set aside. That protects an honest plugin from a hostile service, and an operator from a careless plugin. It does not protect anybody from a hostile plugin: the permissions in a manifest describe what a plugin says it needs, and they are not a limit on what it can do. The operator's side of this is on the [plugins](../features/plugins.md) page.

## How this section reads

1. [Your first plugin](./getting-started.md) takes the example from nothing to enabled on a station.
2. [Packaging and installing](./packaging.md) is what a plugin package has to look like, and where an operator puts it.
3. [Testing](./testing.md) covers the fake host the SDK ships, and the check that tells you whether a station would load what you built.
4. [Versioning and compatibility](./versioning.md) says which version numbers are enforced and which are advice.
5. [The example, file by file](./example.md) walks through a complete `charts` plugin.
6. [The contract](./contract.md) is the reference: every capability, the host, permissions and settings, in detail.
7. [Listing your plugin](./listing.md) puts it in the [community directory](/community/plugins), where operators will find it.

The SDK is `@deadair/plugin-sdk` on npm. Its source, the example, and the fourteen bundled plugins are all in [the repository](https://github.com/robert-dean/deadair), and the bundled plugins are the best examples of each capability there are. Working against a checkout of the station instead of a released image is [setting up a checkout](../develop/setup.md), which ends with how to link a plugin you are writing into one.
