---
title: 'Read slot playlist position'
sidebar_label: 'Read slot playlist position'
sidebar_position: 7
mdx:
    format: 'md'
---

The record a slot that resumes its playlist will open on next time, or nothing when it would start from the top

**`GET`** `/schedule/{id}/playlist-position`

:::note
SDK method: `readSlotPlaylistPosition`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [SlotPlaylistPosition](../models/schedule/slot-playlist-position.md) object.
