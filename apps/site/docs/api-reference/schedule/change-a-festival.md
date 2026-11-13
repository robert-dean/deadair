---
title: 'Change a festival'
sidebar_label: 'Change a festival'
sidebar_position: 4
mdx:
    format: 'md'
---

Replaces a festival and its whole bill. A show naming it plays and talks about the new one from its next refill and its next break

**`PUT`** `/festivals/{id}`

:::note
SDK method: `changeAFestival`
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

Accepts a [Festival](../models/schedule/festival.md) object.

## Response

`200 OK` — Returns a [FestivalList](../models/schedule/festival-list.md) object.

`404 Not Found`
