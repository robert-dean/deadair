---
title: 'HistoryQuery'
sidebar_position: 2
mdx:
    format: 'md'
---

> One page of the history, newest first

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                     |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`   | `number` | No       |                                                                                                                                                                                                                                                                 |
| `before`  | `string` | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else |

</details>
