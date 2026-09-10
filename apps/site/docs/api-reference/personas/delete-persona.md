---
title: 'Delete persona'
sidebar_label: 'Delete persona'
sidebar_position: 14
mdx:
    format: 'md'
---

Removes a persona, including the one on air, which leaves the station with none

**`DELETE`** `/personas/{id}`

:::note
SDK method: `deletePersona`
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
