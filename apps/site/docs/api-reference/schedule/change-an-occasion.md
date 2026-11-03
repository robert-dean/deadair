---
title: 'Change an occasion'
sidebar_label: 'Change an occasion'
sidebar_position: 7
mdx:
    format: 'md'
---

Replaces an occasion, keeping its place in the list

**`PUT`** `/occasions/{id}`

:::note
SDK method: `changeAnOccasion`
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

Accepts a [Occasion](../models/schedule/occasion.md) object.

## Response

`200 OK` — Returns a [OccasionList](../models/schedule/occasion-list.md) object.

`404 Not Found`
