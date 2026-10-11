---
title: Add another music source
description: Give a station that already plays from one music source a second one, then bring in a playlist from either by pasting its link.
---

# Add another music source

By the end of this page the station takes records from two music sources at once, you know which
copy plays when a record is on both, and you have made a playlist of the station's own from a link
you pasted, including one your account does not list, such as a playlist a friend shared.

[The library](../features/library.md) explains every source in full: what each one needs before its
audio will play, which ones ship switched off and why, and how a playlist is taken in.

**You need** a station that already plays from one source, as [Your first hour on
air](./first-hour.md) leaves it, and an account or a server for the second.

## 1. Switch on the second source

Open **Settings → Plugins** and open the plugin for the source you are adding. Switch it on, fill in
its settings, and press **Save configuration**. Saving restarts the plugin, so there is nothing else
to restart. Then press **Test connection**: **You should see** "Connected."

Every field is described on the plugin's own page. In brief:

**Navidrome**, or another Subsonic server: **Server URL**, **Username** and **Password**. **Stream
format** and **Maximum bitrate (kbps)** are optional.

**Jellyfin**: **Server URL**, an **API key** made under API Keys in Jellyfin's dashboard, and the
**Username** to read the library as. That user's access decides what the station sees.

**Emby**: the same three fields. The key is made in Emby's server settings, under Advanced, then API
Keys.

**Plex**: **Server URL**, which is the server itself with its port (`http://your-server:32400`), not
app.plex.tv, and your **Plex token**.

**Spotify**: **Client ID** and **Redirect URI** from your app on Spotify's developer dashboard, then
both authorizations on the plugin's page, exactly as [Your first hour on air](./first-hour.md)
describes. The audio needs Spotify Premium.

**YouTube Music**: the **Cookie** header copied from a browser signed in to music.youtube.com (the
field's help says where to find it). Leave **Audio resolver URL** as it is in the station image. If
that browser is signed in to more than one Google account, **Google account** picks which one, and
**Test connection** names the account it reached. The cookie expires on Google's schedule, and you
paste a fresh one when the plugin says so.

**Pandora**: the **Email** and **Password** of the account. The audio needs Pandora Premium, the
plugin works only from the US, and an account plays one stream at a time.

**Apple Music**: a **Storefront**, the two-letter code of the country whose catalogue to read (`us`,
`gb`, `de`). With only that, the station can search Apple Music but brings in no playlists. **Team
ID**, **Key ID** and **MusicKit private key** add playlists, and need a paid Apple Developer
membership. The audio needs a subscription, one of the `-apple` image tags, and a one-time sign-in.

Deezer, MusicBrainz and Last.fm are not music sources. They tell the station about records and who
sounds like whom, and play nothing.

## 2. Let the library take it in

Open **Library → Playlists** and press **Refresh now**. The station would read the new source within
the hour on its own; this does it at once. The activity feed says when it is done.

**You should see** two groups on the page: **The station's own** at the top, if you have any, and
**From the music sources**, now with playlists from both. A media server adds a playlist called
**Everything** after your own, which is its whole library.

## 3. Check which copy plays

Open a record that both sources carry, from **Library → Tracks**. Under **Copies** there is one line
per source. A record is one entry in the library however many sources have it, so its rating, its
airings and what the sources say about it are shared by every copy.

Which copy airs depends on how the record got into the running order:

- **From one source's playlist**, put on air with **Air this playlist**: that source's copy.
- **Everything else**, from the station's own picks to a playlist of its own: first the copy that
  suits **Explicit content** under **Settings → Rotation**, where a record has an explicit and a clean
  version. A source that cannot fetch audio at all is passed over. Beyond that there is no setting
  that ranks one source above another, so either copy may play.

A copy that fails four times in a row is benched, and the record plays from another source's copy
while it is. The next walk of the library gives the benched copy another chance, if its source still
lists it.

## 4. Import a playlist from a link

Copy the playlist's address from the browser or the app's share button. Then:

1. On **Library → Playlists**, press **Import**.
2. Choose the **Link** tab and paste it into **Playlist link**.
3. Press **Preview**.

These are the links the station recognises, each only while that source is switched on:

| Source | The link looks like |
| --- | --- |
| Spotify | `open.spotify.com/playlist/…`, an embed link, or a `spotify:playlist:` URI |
| YouTube Music | `music.youtube.com/playlist?list=…`. A YouTube link with `list=` in it works too |
| Apple Music | `music.apple.com/…/playlist/…`, as the share button writes it |
| Pandora | `pandora.com/playlist/PL:…` |
| Navidrome | the address of a playlist's page in Navidrome's web app |
| Jellyfin, Emby | the address of a playlist's page in the server's web app |
| Plex | the address of a playlist's page in Plex Web, from app.plex.tv or the server itself |

A media server's link is recognised only when it points at the same server the plugin is set up
for, so open its web app at the address in **Server URL**. An Apple Music playlist is read in the
plugin's own storefront, whichever country the link names.

**You should see** a preview: how many of the playlist's records the library already holds, and how
many it will look up. Change **Name** if you like, then press **Import**. The button counts the
records.

The new playlist joins **The station's own** at the top of the page. A record the library does not
hold yet keeps its place and is drawn dimmed, and the station looks it up straight away, asking the
source the link came from first. The activity feed says how many it found.

## 5. Put it on

Open the new playlist and press **Air this playlist**. It plays in its own order, under your dislikes
and **Explicit content**, with each record from whichever source has a copy.

## If it goes wrong

- **Test connection fails.** The plugin's page shows the last error. On a media server, check
  **Server URL** opens in a browser on the station's own network; on YouTube Music, paste a fresh
  cookie.
- **The new source's playlists do not appear.** Press **Refresh now** again and wait for the activity
  feed. A source that is not answering is named at the top of **Library → Playlists**, with why.
- **The preview says none of the station's music sources recognises the link.** The source
  is switched off, the link is to an album or a song rather than a playlist, or a media server's link
  uses a different address from **Server URL** (a name where the plugin has a number, say).
- **An Apple Music link says a MusicKit key is needed.** Fill in **Team ID**, **Key ID** and
  **MusicKit private key**. Without them Apple Music lends no playlists.
- **The imported playlist stays dimmed.** Nothing is looked up while **Play records the station does
  not own yet** under **Settings → Rotation** is off. Turn it on, then press **Look up missing
  records** on the playlist's page.
- **Records from the new source are listed and skipped.** Its audio is missing a piece: Spotify's
  playback authorization, Pandora or Spotify Premium, or the `-apple` image for Apple Music.

## Next

- [The library](../features/library.md) for importing from a file or a pasted list, and for exporting
  a playlist to another station.
- [Make a show](./make-a-show.md) to give the new playlist a regular slot on the timetable.
