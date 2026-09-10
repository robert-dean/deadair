---
title: 'Read activity'
sidebar_label: 'Read activity'
sidebar_position: 1
mdx:
    format: 'md'
---

The feed, newest first, one page at a time

**`GET`** `/activity`

:::note
SDK method: `readActivity`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type               | Required | Description                                                                                                                                                                                                                                          |
| ------------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `before`      | `string`           | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the feed grew under it. Pass back whatever `nextBefore` said and nothing else |
| `limit`       | `number`           | No       |                                                                                                                                                                                                                                                      |
| `minSeverity` | `ActivitySeverity` | No       | The floor, not the exact match: `warn` answers with warnings and faults. Absent is everything                                                                                                                                                        |
| `module`      | `ActivityModule`   | No       |                                                                                                                                                                                                                                                      |

</details>

## Response

`200 OK` — Returns a [ActivityPage](../models/activity/activity-page.md) object.
