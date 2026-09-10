---
title: 'Update persona note'
sidebar_label: 'Update persona note'
sidebar_position: 18
mdx:
    format: 'md'
---

Rewrites one note's words, whoever wrote it. Editing what the station proposed is most of the point of the panel

**`PUT`** `/personas/{id}/notes/{noteId}`

:::note
SDK method: `updatePersonaNote`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |
| `noteId`  | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PersonaNoteWrite](../models/personas/persona-note-write.md) object.

## Response

`200 OK` — Returns a [PersonaNoteList](../models/personas/persona-note-list.md) object.
