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

## What a player shows

A stream carries one line of text and one URL, and that is the whole display ceiling for anything that can only take a stream: a car head unit, a hardware radio, an amp with a screen.

The line is the record and its artist while music is playing. While the station is talking it is your station's name — a producer's label on an amp's screen is your paperwork in a listener's front room — except where the break knows a better way to say what it is: a forecast airs as `Your Station - Weather in Brooklyn` and a bulletin as `Your Station - Sport news`. Talk breaks, idents and anything an operator adds show the station's name, because nothing can tell from a label alone whether it was written for a listener or for you. Your listener apps show the same line.

The URL beside it is the artwork, and players that fetch it draw it in place of a cover. It carries the record's sleeve when your station holds a copy of one, the picture for a kind of break while the station is talking, and your station's logo the rest of the time — an uncached record, the bed, off air. The logo is also what a break of a kind with no picture of its own shows.

**The station ships a picture for a weather forecast and one for a news bulletin.** Replace either with your own, or put the shipped one back, under **Settings**, **Artwork**: jpeg, png, webp or gif, up to 4 MB, and a square one, since that is the shape everything draws it in. The address listeners reach you at has to be set for any of this to leave the station, because there is no base to make the URL absolute against otherwise; that is **Settings**, **Stream**, and it is the same setting the logo needs.

## The first few seconds

By default a station airs only while somebody is listening, so connecting is what puts it on air. The first seconds after pressing play are warm-up: the station takes the mount, hands over the first record and the encoder starts. A few seconds of nothing is the station starting, not failing. If the first records are still downloading, the station says so on air rather than leaving you in silence. When the last listener leaves, it stays on for five minutes in case they come back. [The check-up](./check-up.md) explains the rule, and how to set a station to air whenever it has something to play.

`GET /nowplaying` needs no sign-in, and a page on any other site may read it from the browser, so a widget of your own can show what is playing without a server of its own in between. If you write your own player, read the published mounts from it rather than connecting to each to see: a connection, however brief, is an audience for five minutes. And send one user agent from every request, because HLS listeners are counted by address and agent, and two agents count as two listeners.

## On Android

The Android app is a listener first: background playback, lock-screen controls, what is on air, and a choice of format. Give it your station's address, and it shows you the name of the station that answered before keeping it. The format picker greys out whatever your station does not publish. HLS is the one to choose on a phone that moves between wifi and mobile data. Listening needs no account. Now playing is the cover and little over it: left alone for a few seconds while a record plays, the words, the controls and the tabs fade away and the art fills the screen, and the first touch brings them back. A sleep timer sits under Settings, Listening while the station is playing; it stops the station after 15, 30, 45 or 60 minutes or at the end of the record that is on, fading out over the last ten seconds. It is careful with the battery: with the display dark, when nobody can see the answer, it asks the station every thirty seconds rather than every three, and a stream it has given up reconnecting to stops instead of sitting there looking like it is still playing.

Signed in with the operator's account, the same email and password the console takes, it adds what the station has played, what is coming up and what it said between records, with a page for every record, album and artist. It becomes the remote as well. **The desk**, reached from the Up next menu, is where everything that can take the station off air lives: whether it is on air and who it is going out to, Skip, Take off air, the hold against the schedule, what puts the station on air, and why it is or is not on. Elsewhere you can reorder and drop the running order, rate records, albums, artists and breaks, put a playlist or a chart on air, and add a record: **Add a record** on Up next searches the library by title, **Play next** puts one straight after what the station is already holding and **Add to the end** puts it last, and a record's own page offers the same two. Records the station has no audio for yet are listed but cannot be added, and a record the station declines (something you disliked, say) is refused with a sentence rather than a number. In a car, pause stops the stream, the next button is the operator's Skip and is offered to nobody else, and pressing play on the wheel starts the station even when the app is not running.

**The station can sit outside the app, on three surfaces.** A **Quick Settings tile** starts and stops it from the shade without opening the app, showing Warming up for the seconds between the press and the first sound. A **home-screen widget** (**Settings**, **Home-screen widget**, **Add to the home screen**, or the launcher's own widget list) shows what is playing over its cover, or who is on the mic while the station talks, with a button that starts and stops it; signed in as the operator it carries Skip too, and that one arms on the first press and forgets itself after five seconds, so a press in a pocket costs nobody a record. And the station can be **the phone's wallpaper** (**Settings**, **Station wallpaper**, **Set as wallpaper**), which opens the system's own picker on it so you choose the lock screen, the home screen or both. It draws the cover at the top, the middle or the foot of the screen, so it sits where your icons are not, and it can colour the phone from the station's own colours, from the cover on screen, or from a colour you pick. Nothing is ever written over the wallpaper you already had, and choosing another wallpaper is how it comes off again.

Each of those decides for itself when it is worth asking the station anything, because a surface that exists for as long as the phone is on must not poll for as long as the phone is on. The widget and the wallpaper both default to showing what is on **while this phone is playing**, which asks your station nothing at all the rest of the time. Set either to follow the station instead and the widget checks every half hour, and whenever you tap the time it shows, and says how old that answer is once it is more than two minutes.

**`deadair://` links open the app.** A link names a station and fills in the setup screen with it: nothing changes until you check the address and choose to listen, and **Keep the station I have** turns it down. The console has one under the mounts on **Check-up**, **Machinery**, beside a code to scan, which is the shortest way to hand a phone a station on your own network. The macOS app reads the same links.

It is on [Google Play](https://play.google.com/store/apps/details?id=com.maroonedsoftware.deadair). To build it yourself instead, you need a JDK and the Android SDK, and the instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/android).

## On an iPhone

The iPhone app is a listener: background playback, the lock screen and Control Center, what is on air with its artwork, and a choice of format, read from what your station publishes. Give it your station's address and it shows you the name of the station that answered before keeping it. A station on your own network makes iOS ask for Local Network access the first time, which is expected. Pause and stop both drop the connection, and a phone call stops the stream rather than holding it, because a held connection still counts as a listener. Listening needs no account.

It can sign in with the operator's account, the same email and password the console takes, and answer an authenticator code. The remote the Android app has is not in it yet.

It is built from source with Xcode 16 or later. The build instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/ios).

## On a Mac

The desktop app is a listener with a proper player and the operator's desk in one window. The first release is for macOS on Apple Silicon and nothing else.

It plays through the system's own player, so the stream shows up in the system's Now Playing display and answers the media keys. The next key is the operator's Skip and is registered only while you are signed in as the operator; pause and stop both drop the connection, because a paused connection still counts as a listener. It can also send the station to a BluOS network speaker. Changing where it plays is a transfer rather than an addition: the local player stops and disconnects before the speaker is asked to play, so the station never counts two listeners for one person.

Listening needs no account. Signed in, it shows the running order, which it can reorder and drop from, the timetable, the library, who is presenting and what they have said, and the check-up, and it can change the station's settings.

It is built from source with .NET 10. The bundle it produces is not notarised, so macOS refuses the first launch. On macOS 15 and later a right-click and **Open** no longer gets past that: open it once, let it refuse, then press **Open Anyway** in System Settings › Privacy & Security, or run `xattr -dr com.apple.quarantine` on the app. The build instructions are in [the app's directory](https://github.com/robert-dean/deadair/tree/main/apps/desktop).

Apart from your station, the one thing the desktop app talks to is GitHub: at launch it asks once whether there is a newer desktop release, sending nothing but its own name and version, and offers a link if there is. Turn it off under **Settings**, **Updates**.

## In the console

The console does not play the station, deliberately: it is the desk, and the listening surfaces are the mount and the three apps. Which formats are published, and whether HLS is on, are under **Settings**, **Stream**. What puts the station on air is under **Settings**, **Playout**, and on the **Desk** under **Why is it not on air?**. The listener count and the published mounts are on **Check-up**, **Machinery**.
