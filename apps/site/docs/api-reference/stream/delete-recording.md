---
title: 'Delete recording'
sidebar_label: 'Delete recording'
sidebar_position: 2
mdx:
    format: 'md'
---

Deletes a finished recording. One still being recorded is refused

**`DELETE`** `/archive/recordings/{id}`

:::note
SDK method: `deleteRecording`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>
