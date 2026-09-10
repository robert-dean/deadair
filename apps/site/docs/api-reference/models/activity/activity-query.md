---
title: 'ActivityQuery'
sidebar_position: 4
mdx:
    format: 'md'
---

> One page of the feed, newest first

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type               | Required | Description                                                                                                                                                                                                                                          |
| ------------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`       | `number`           | No       |                                                                                                                                                                                                                                                      |
| `before`      | `string`           | No       | Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the feed grew under it. Pass back whatever `nextBefore` said and nothing else |
| `module`      | `ActivityModule`   | No       |                                                                                                                                                                                                                                                      |
| `minSeverity` | `ActivitySeverity` | No       | The floor, not the exact match: `warn` answers with warnings and faults. Absent is everything                                                                                                                                                        |

</details>
