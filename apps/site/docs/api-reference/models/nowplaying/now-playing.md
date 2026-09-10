---
title: 'NowPlaying'
sidebar_position: 3
mdx:
    format: 'md'
---

> What the station is playing, for anything that wants to display it

<details>
<summary>Attributes (5)</summary>

| Attribute   | Type                | Required | Description                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `station`   | `string`            | Yes      | The station's on-air name                                                                                                                                                                                                                                                                                                                     |
| `onAir`     | `boolean`           | Yes      | False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error                                                                                                                                                                                                                      |
| `listeners` | `number`            | Yes      | How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it                                                                                                                                              |
| `mounts`    | `NowPlayingMount[]` | Yes      | Every way to listen, MP3 first. Never empty: MP3 has no switch. A format the operator has not switched on is ABSENT rather than present and disabled, because a client asking this wants the mounts that are actually there — and a client that had to find out by connecting to each one would put an audience-gated station on air to do it |
| `track`     | `NowPlayingTrack`   | No       |                                                                                                                                                                                                                                                                                                                                               |

</details>
