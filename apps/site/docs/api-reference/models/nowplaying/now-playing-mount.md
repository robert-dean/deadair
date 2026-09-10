---
title: 'NowPlayingMount'
sidebar_position: 2
mdx:
    format: 'md'
---

> One way to listen to this station right now

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type                                          | Required | Description                                                                                                                                                               |
| ------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`      | `'mp3' \| 'opus' \| 'aac' \| 'flac' \| 'hls'` | Yes      | `hls` is the master playlist rather than an Icecast mount, which is why this enum has an arm `PlayoutMount` does not                                                      |
| `path`        | `string`                                      | Yes      | Same-origin path, leading slash included. A path and not a URL: the station is reached through whatever edge served this answer, never at the address the app itself uses |
| `bitrateKbps` | `number`                                      | No       | Absent for FLAC, which is lossless and has no rate to set, and for HLS, whose rate is the AAC variant's                                                                   |

</details>
