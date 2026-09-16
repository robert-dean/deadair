---
title: 'Set the station host'
sidebar_label: 'Set the station host'
sidebar_position: 15
mdx:
    format: 'md'
---

Makes this persona the station's own host, and the previous one no longer is

**`PUT`** `/personas/{id}/default-host`

:::note
SDK method: `setTheStationHost`
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

`200 OK` — Returns a [PersonaList](../models/personas/persona-list.md) object.
