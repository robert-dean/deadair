---
title: 'List persona notes'
sidebar_label: 'List persona notes'
sidebar_position: 16
mdx:
    format: 'md'
---

Everything this character has accumulated, oldest first, in every state

**`GET`** `/personas/{id}/notes`

:::note
SDK method: `listPersonaNotes`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [PersonaNoteList](../models/personas/persona-note-list.md) object.
