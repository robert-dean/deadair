---
title: 'Update persona'
sidebar_label: 'Update persona'
sidebar_position: 13
mdx:
    format: 'md'
---

Rewrites one persona. An edit to the one on air is heard on the next break

**`PUT`** `/personas/{id}`

:::note
SDK method: `updatePersona`
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

Accepts a [Persona](../models/personas/persona.md) object.

## Response

`200 OK` — Returns a [PersonaList](../models/personas/persona-list.md) object.
