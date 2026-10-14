---
title: 'EventDestinationUpdate'
sidebar_position: 4
mdx:
    format: 'md'
---

> Changes to an event destination. Only what is sent changes

<details>
<summary>Attributes (4)</summary>

| Attribute | Type       | Required | Description                                                                                        |
| --------- | ---------- | -------- | -------------------------------------------------------------------------------------------------- |
| `name`    | `string`   | No       |                                                                                                    |
| `url`     | `string`   | No       |                                                                                                    |
| `enabled` | `boolean`  | No       | Turning a destination back on also clears why the station turned it off, and its count of failures |
| `events`  | `string[]` | No       | Empty means every type                                                                             |

</details>
