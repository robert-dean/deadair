---
title: 'Suspend track'
sidebar_label: 'Suspend track'
sidebar_position: 29
mdx:
    format: 'md'
---

Keep this record off the station for a number of days. Nothing already in the running order is taken out; a suspension stops it being chosen again, and lapses by itself

**`PUT`** `/catalog/tracks/{id}/suspension`

:::note
SDK method: `suspendTrack`
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

`200 OK` — Returns a [Track](../models/catalog/track.md) object.
