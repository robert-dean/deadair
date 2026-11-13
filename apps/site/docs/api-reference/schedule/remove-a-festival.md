---
title: 'Remove a festival'
sidebar_label: 'Remove a festival'
sidebar_position: 4
mdx:
    format: 'md'
---

Removes a festival. A show that named it carries on as the show it otherwise is

**`DELETE`** `/festivals/{id}`

:::note
SDK method: `removeAFestival`
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

`200 OK` — Returns a [FestivalList](../models/schedule/festival-list.md) object.

`404 Not Found`
