---
title: 'ScriptHistoryQuery'
sidebar_position: 14
mdx:
    format: 'md'
---

> One page of what the station has written, newest first

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type            | Required | Description                                                                                                                                                                   |
| ------------ | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`      | `number`        | No       |                                                                                                                                                                               |
| `before`     | `string`        | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else |
| `kind`       | `string`        | No       |                                                                                                                                                                               |
| `writer`     | `string`        | No       |                                                                                                                                                                               |
| `outcome`    | `ScriptOutcome` | No       |                                                                                                                                                                               |
| `personaKey` | `string`        | No       | Everything ONE character has said. Absent is every character and none                                                                                                         |
| `segmentId`  | `string`        | No       | Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history                                   |

</details>
