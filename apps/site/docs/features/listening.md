---
title: Listening
sidebar_position: 12
description: The stream and its formats, why the first seconds after pressing play are quiet, and the Android, iPhone and macOS apps.
---

A deadair station is heard through one address. Everybody who connects hears the same broadcast at the same moment: there is no per-listener shuffle and no skip button. It is served from the same port as the console, so whatever already fronts that port carries the station too.

## The mount

The stream is `/live.mp3` on your station's address. MP3 is always on, with no switch, because it is the compatibility floor: a Sonos, a car head unit or a hardware radio takes MP3, AAC or nothing.

Three more mounts can be switched on beside it, each off by default because each is another encoder running around the clock whether or not anybody is listening to it:

- `/live.opus`
- `/live.aac`
- `/live.flac`, which is only worth anything when your sources are lossless too.

There is also an HLS stream at `/live.m3u8`, carrying AAC. An ordinary mount is one long-lived connection, which dies when a phone moves between wifi and mobile data. HLS is a series of ordinary web requests that a player simply retries, so it survives the handover, at the cost of a few more seconds of delay and one more encoder. Any web page may embed it, including players that fetch it from script.

The mount is not authenticated. Anybody who can reach the address can listen, which for a radio station is usually the point. It is still your music under somebody else's licence, so read [the licensing notes](../licensing.md) before you publish an address.

## The first few seconds

By default a station airs only while somebody is listening, so connecting is what puts it on air. The first seconds after pressing play are warm-up: the station takes the mount, hands over the first record and the encoder starts. A few seconds of nothing is the station starting, not failing. If the first records are still downloading, the station says so on air rather than leaving you in silence. When the last listener leaves, it stays on for five minutes in case they come back. [The check-up](./check-up.md) explains the rule, and how to set a station to air whenever it has something to play.

If you write your own player, read the published mounts from `GET /nowplaying` rather than connecting to each to see: a connection, however brief, is an audience for five minutes. And send one user agent from every request, because HLS listeners are counted by address and agent, and two agents count as two listeners.

## On Android

The Android app is a listener first: background playback, lock-screen controls, what is on air, and a choice of format. Give it your station's address, and it shows you the name of the station that answered before keeping it. The format picker greys out whatever your station does not publish. HLS is the one to choose on a phone that moves between wifi and mobile data. Listening needs no account.

Signed in with the operator's account, the same email and password the console takes, it adds what the station has played, what is coming up and what it said between records, with a page for every record, album and artist. It becomes the remote as well: skip, stop and start the station, hold a broadcast against the schedule, set what puts the station on air, read why it is or is not on air, reorder and drop the running order, rate records, albums, artists and breaks, and put a playlist or a chart on air. In a car, pause stops the stream, the next button is the operator's Skip and is offered to nobody else, and pressing play on the wheel starts the station even when the app is not running.

It is built from source with a JDK and the Android SDK. A Google Play listing exists but is limited to invited testers for now. The build instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/android).

## On an iPhone

The iPhone app is a listener: background playback, the lock screen and Control Center, what is on air with its artwork, and a choice of format, read from what your station publishes. Give it your station's address and it shows you the name of the station that answered before keeping it. A station on your own network makes iOS ask for Local Network access the first time, which is expected. Pause and stop both drop the connection, and a phone call stops the stream rather than holding it, because a held connection still counts as a listener. Listening needs no account.

It can sign in with the operator's account, the same email and password the console takes, and answer an authenticator code. The remote the Android app has is not in it yet.

It is built from source with Xcode 16 or later. The build instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/ios).

## On a Mac

The desktop app is a listener with a proper player and the operator's desk in one window. The first release is for macOS on Apple Silicon and nothing else.

It plays through the system's own player, so the stream shows up in the system's Now Playing display and answers the media keys. The next key is the operator's Skip and is registered only while you are signed in as the operator; pause and stop both drop the connection, because a paused connection still counts as a listener. It can also send the station to a BluOS network speaker. Changing where it plays is a transfer rather than an addition: the local player stops and disconnects before the speaker is asked to play, so the station never counts two listeners for one person.

Listening needs no account. Signed in, it shows the running order, which it can reorder and drop from, the timetable, the library, who is presenting and what they have said, and the check-up, and it can change the station's settings.

It is built from source with .NET 10. The bundle it produces is unsigned, so the first launch needs a right-click and **Open**, and macOS will otherwise refuse it without saying why. The build instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/desktop).

## In the console

The console does not play the station, deliberately: it is the desk, and the listening surfaces are the mount and the three apps. Which formats are published, and whether HLS is on, are under **Settings**, **Stream**. What puts the station on air is under **Settings**, **Playout**, and on the **Desk** under **Why is it not on air?**. The listener count and the published mounts are on **Check-up**, **Machinery**.
