---
title: 'Write persona story'
sidebar_label: 'Write persona story'
sidebar_position: 22
mdx:
    format: 'md'
---

Writes a story by hand. An operator's own is tellable from the moment it exists; only the enrichment pass proposes

**`POST`** `/personas/{id}/stories`

:::note
SDK method: `writePersonaStory`
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

Accepts a [PersonaStoryWrite](../models/personas/persona-story-write.md) object.

## Response

`201 Created` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
