---
title: 'Suspend artist'
sidebar_label: 'Suspend artist'
sidebar_position: 25
mdx:
    format: 'md'
---

Keep this artist, and every record they are credited on, off the station for a number of days. Nothing already in the running order is taken out; a suspension stops it being chosen again, and lapses by itself

**`PUT`** `/catalog/artists/{id}/suspension`

:::note
SDK method: `suspendArtist`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [SuspendInput](../models/catalog/suspend-input.md) object.

## Response

`200 OK` — Returns a [Artist](../models/catalog/artist.md) object.
