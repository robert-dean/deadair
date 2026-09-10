---
title: 'PlayoutStatus'
sidebar_position: 11
mdx:
    format: 'md'
---

> The station's transport, as one reading

<details>
<summary>Attributes (11)</summary>

| Attribute           | Type                    | Required | Description                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streamUp`          | `boolean`               | Yes      | Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds                                                                                                                                                                                                      |
| `onAir`             | `boolean`               | Yes      | Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence                                                                                           |
| `mountPath`         | `string`                | Yes      | Same-origin path of the Icecast MP3 mount, which is always published and is the one a console names when it can only name one. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses                                                      |
| `mounts`            | `PlayoutMount[]`        | Yes      | Every mount being published, MP3 first, so a console can offer the others rather than implying the station is only on one. Never empty: MP3 has no switch. A format the operator has not switched on is absent rather than present and disabled, because every consumer of this wants the mounts that are actually there |
| `nowPlaying`        | `PlayoutNowPlaying`     | No       |                                                                                                                                                                                                                                                                                                                          |
| `upNext`            | `PlayoutItem[]`         | Yes      | Waiting here, in order. Excludes what the player already holds                                                                                                                                                                                                                                                           |
| `queuedCount`       | `number`                | Yes      | How many items are waiting in total, of which `upNext` is the head                                                                                                                                                                                                                                                       |
| `listeners`         | `number`                | Yes      | How many clients Icecast has attached to the mount. Zero both for "nobody is listening" and for an Icecast that is not answering, which `audience` is where to tell apart                                                                                                                                                |
| `audience`          | `boolean`               | Yes      | Whether the station counts as having an audience, which lingers for a minute past the last listener so a reconnecting player does not cut the broadcast                                                                                                                                                                  |
| `staleStreamConfig` | `StreamConfigWarning[]` | Yes      | Containers running config the app has since replaced. Empty is the ordinary state, and so is empty for anything the app has no evidence about: a warning here has never been a guess                                                                                                                                     |
| `silence`           | `StationSilence`        | Yes      | Which gate is keeping the station quiet, composed from every one of them rather than inferred from the fields above. `streamUp`, `onAir`, `audience` and `queuedCount` each answer for one gate and a console reading them alone has to guess at the rest                                                                |

</details>
