---
title: 'Preview persona memory rollback'
sidebar_label: 'Preview persona memory rollback'
sidebar_position: 36
mdx:
    format: 'md'
---

What rolling back to a moment would undo, without undoing it

**`GET`** `/personas/{id}/memory/preview`

:::note
SDK method: `previewPersonaMemoryRollback`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |
| `to`      | `string` | No       |                 |

</details>

## Response

`200 OK` — Returns a [PersonaMemoryChange](../models/personas/persona-memory-change.md) object.
