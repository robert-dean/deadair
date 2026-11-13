---
title: 'Remove an occasion'
sidebar_label: 'Remove an occasion'
sidebar_position: 13
mdx:
    format: 'md'
---

Removes an occasion

**`DELETE`** `/occasions/{id}`

:::note
SDK method: `removeAnOccasion`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [OccasionList](../models/schedule/occasion-list.md) object.

`404 Not Found`
