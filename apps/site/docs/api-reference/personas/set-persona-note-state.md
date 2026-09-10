---
title: 'Set persona note state'
sidebar_label: 'Set persona note state'
sidebar_position: 20
mdx:
    format: 'md'
---

Accepts a proposal, turns one down, or rests an active note. Mirrors the lexicon's own state route

**`PUT`** `/personas/{id}/notes/{noteId}/state`

:::note
SDK method: `setPersonaNoteState`
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

Accepts a [PersonaNoteState](../models/personas/persona-note-state.md) object.

## Response

`200 OK` — Returns a [PersonaNoteList](../models/personas/persona-note-list.md) object.
