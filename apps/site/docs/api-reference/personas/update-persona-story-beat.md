---
title: 'Update persona story beat'
sidebar_label: 'Update persona story beat'
sidebar_position: 32
mdx:
    format: 'md'
---

Rewrites one part's words, or moves it in the order

**`PUT`** `/personas/{id}/stories/{storyId}/beats/{beatId}`

:::note
SDK method: `updatePersonaStoryBeat`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `beatId`  | `string` | Yes      | Path parameter. |
| `id`      | `string` | Yes      | Path parameter. |
| `storyId` | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PersonaStoryBeatWrite](../models/personas/persona-story-beat-write.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
