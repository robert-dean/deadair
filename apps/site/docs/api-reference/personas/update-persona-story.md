---
title: 'Update persona story'
sidebar_label: 'Update persona story'
sidebar_position: 23
mdx:
    format: 'md'
---

Rewrites one story's handle and telling, whoever wrote it

**`PUT`** `/personas/{id}/stories/{storyId}`

:::note
SDK method: `updatePersonaStory`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |
| `storyId` | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PersonaStoryWrite](../models/personas/persona-story-write.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
