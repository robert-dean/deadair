---
title: 'Update persona story detail'
sidebar_label: 'Update persona story detail'
sidebar_position: 27
mdx:
    format: 'md'
---

Rewrites one detail's words

**`PUT`** `/personas/{id}/stories/{storyId}/details/{detailId}`

:::note
SDK method: `updatePersonaStoryDetail`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `detailId` | `string` | Yes      | Path parameter. |
| `id`       | `string` | Yes      | Path parameter. |
| `storyId`  | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [PersonaStoryDetailWrite](../models/personas/persona-story-detail-write.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
