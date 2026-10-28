---
title: 'ListenerConnection'
sidebar_position: 4
mdx:
    format: 'md'
---

> One connection to the station's stream, as it stands at the moment of reading

<details>
<summary>Attributes (5)</summary>

| Attribute     | Type                 | Required | Description                                                                                                                                                                    |
| ------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `via`         | `'icecast' \| 'hls'` | Yes      | `icecast` is a player holding a connection open on a mount. `hls` is a player re-fetching a playlist, counted while it keeps asking                                            |
| `mount`       | `string`             | No       | The Icecast mount it is on, such as `/live.mp3`. Absent over HLS, whose players are counted across every playlist together                                                     |
| `address`     | `string`             | Yes      | The address the station recorded. A listener's own only where the edge in front of the station is trusted to say so; behind a tunnel without `REAL_IP_FROM` it is the tunnel's |
| `agent`       | `string`             | No       | What the player said it was, cut to 512 characters. Absent when it sent nothing                                                                                                |
| `connectedMs` | `number`             | Yes      | How long it has been connected, to the second. Over HLS, since the first playlist fetch of this stretch of listening                                                           |

</details>
