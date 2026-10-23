---
title: 'Suspend album'
sidebar_label: 'Suspend album'
sidebar_position: 27
mdx:
    format: 'md'
---

Keep this release, and every record on it, off the station for a number of days. Nothing already in the running order is taken out; a suspension stops it being chosen again, and lapses by itself

**`PUT`** `/catalog/albums/{id}/suspension`

:::note
SDK method: `suspendAlbum`
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

`200 OK` — Returns a [Album](../models/catalog/album.md) object.
