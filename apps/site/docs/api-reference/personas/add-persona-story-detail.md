---
title: 'Add persona story detail'
sidebar_label: 'Add persona story detail'
sidebar_position: 26
mdx:
    format: 'md'
---

Adds one thing to a story that already exists

**`POST`** `/personas/{id}/stories/{storyId}/details`

:::note
SDK method: `addPersonaStoryDetail`
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

Accepts a [PersonaStoryDetailWrite](../models/personas/persona-story-detail-write.md) object.

## Response

`201 Created` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
