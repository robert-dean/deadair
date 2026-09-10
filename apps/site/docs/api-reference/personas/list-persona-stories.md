---
title: 'List persona stories'
sidebar_label: 'List persona stories'
sidebar_position: 21
mdx:
    format: 'md'
---

Every story this character holds, oldest first, in every state

**`GET`** `/personas/{id}/stories`

:::note
SDK method: `listPersonaStories`
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

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
