---
title: 'Stop cast'
sidebar_label: 'Stop cast'
sidebar_position: 4
mdx:
    format: 'md'
---

Stop the station on a speaker. Answers 204 when it was not playing too

**`DELETE`** `/outputs/casts/{pluginId}/{deviceId}`

:::note
SDK method: `stopCast`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `deviceId` | `string` | Yes      | Path parameter. |
| `pluginId` | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
