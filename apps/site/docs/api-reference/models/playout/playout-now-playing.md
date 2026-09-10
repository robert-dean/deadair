---
title: 'PlayoutNowPlaying'
sidebar_position: 4
mdx:
    format: 'md'
---

> What the PLAYER says is airing, which is not the same as what was last handed to it

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type          | Required | Description                                                                                                     |
| ------------- | ------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `item`        | `PlayoutItem` | Yes      |                                                                                                                 |
| `startedAt`   | `number`      | Yes      | Unix epoch millis, as observed when the player reported it                                                      |
| `remainingMs` | `number`      | No       | The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers |

</details>
