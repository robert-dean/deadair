---
title: 'Read script history'
sidebar_label: 'Read script history'
sidebar_position: 5
mdx:
    format: 'md'
---

What the station has written lately, newest first, one page at a time

**`GET`** `/scripts`

:::note
SDK method: `readScriptHistory`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type            | Required | Description                                                                                                                                                                   |
| ------------ | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before`     | `string`        | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously. Pass back whatever `nextBefore` said and nothing else |
| `kind`       | `string`        | No       |                                                                                                                                                                               |
| `limit`      | `number`        | No       |                                                                                                                                                                               |
| `outcome`    | `ScriptOutcome` | No       |                                                                                                                                                                               |
| `personaKey` | `string`        | No       | Everything ONE character has said. Absent is every character and none                                                                                                         |
| `segmentId`  | `string`        | No       | Every attempt made for ONE break, which is how a console reaches the words behind an item of the running order. Absent is the whole history                                   |
| `writer`     | `string`        | No       |                                                                                                                                                                               |

</details>

## Response

`200 OK` — Returns a [ScriptHistoryPage](../models/render/script-history-page.md) object.
