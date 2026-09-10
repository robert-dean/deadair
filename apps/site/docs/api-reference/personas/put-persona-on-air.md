---
title: 'Put persona on air'
sidebar_label: 'Put persona on air'
sidebar_position: 15
mdx:
    format: 'md'
---

Puts this persona on air and takes the previous one off

**`PUT`** `/personas/{id}/active`

:::note
SDK method: `putPersonaOnAir`
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
