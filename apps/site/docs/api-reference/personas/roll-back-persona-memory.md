---
title: 'Roll back persona memory'
sidebar_label: 'Roll back persona memory'
sidebar_position: 37
mdx:
    format: 'md'
---

Undo it. Everything the station accrued after that moment goes; everything an operator wrote stays

**`POST`** `/personas/{id}/memory/rollback`

:::note
SDK method: `rollBackPersonaMemory`
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

Accepts a [PersonaMemoryRollback](../models/personas/persona-memory-rollback.md) object.

## Response

`200 OK` — Returns a [PersonaMemory](../models/personas/persona-memory.md) object.
