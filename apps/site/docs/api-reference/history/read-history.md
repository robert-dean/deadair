---
title: 'Read history'
sidebar_label: 'Read history'
sidebar_position: 1
mdx:
    format: 'md'
---

What the station played, newest first, one page at a time

**`GET`** `/history`

:::note
SDK method: `readHistory`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                     |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before`  | `string` | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else |
| `limit`   | `number` | No       |                                                                                                                                                                                                                                                                 |

</details>

## Response

`200 OK` — Returns a [HistoryPage](../models/history/history-page.md) object.
