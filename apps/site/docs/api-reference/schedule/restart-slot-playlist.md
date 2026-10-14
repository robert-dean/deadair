---
title: 'Restart slot playlist'
sidebar_label: 'Restart slot playlist'
sidebar_position: 8
mdx:
    format: 'md'
---

Forgets where a slot got to in its playlist, so it starts from the top the next time it opens

**`DELETE`** `/schedule/{id}/playlist-position`

:::note
SDK method: `restartSlotPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>
