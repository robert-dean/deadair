---
title: 'EventDestinationCreate'
sidebar_position: 3
mdx:
    format: 'md'
---

> A new event destination

<details>
<summary>Attributes (4)</summary>

| Attribute | Type       | Required | Description                                                  |
| --------- | ---------- | -------- | ------------------------------------------------------------ |
| `name`    | `string`   | Yes      |                                                              |
| `url`     | `string`   | Yes      |                                                              |
| `enabled` | `boolean`  | No       | Defaults to on                                               |
| `events`  | `string[]` | No       | The event types to send it. Absent or empty means every type |

</details>
