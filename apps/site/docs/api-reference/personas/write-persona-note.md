---
title: 'Write persona note'
sidebar_label: 'Write persona note'
sidebar_position: 17
mdx:
    format: 'md'
---

Writes a note by hand. An operator's own note is active from the moment it exists; only the distil pass proposes

**`POST`** `/personas/{id}/notes`

:::note
SDK method: `writePersonaNote`
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

Accepts a [PersonaNoteWrite](../models/personas/persona-note-write.md) object.

## Response

`201 Created` — Returns a [PersonaNoteList](../models/personas/persona-note-list.md) object.
