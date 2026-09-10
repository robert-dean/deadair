---
title: 'Delete persona note'
sidebar_label: 'Delete persona note'
sidebar_position: 19
mdx:
    format: 'md'
---

Removes a note outright. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again

**`DELETE`** `/personas/{id}/notes/{noteId}`

:::note
SDK method: `deletePersonaNote`
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

## Response

`200 OK` — Returns a [PersonaNoteList](../models/personas/persona-note-list.md) object.
