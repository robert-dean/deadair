---
title: 'Set persona story detail state'
sidebar_label: 'Set persona story detail state'
sidebar_position: 29
mdx:
    format: 'md'
---

Accepts a proposed detail or turns it down, which has to outlive the pass that proposed it

**`PUT`** `/personas/{id}/stories/{storyId}/details/{detailId}/state`

:::note
SDK method: `setPersonaStoryDetailState`
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

Accepts a [PersonaStoryState](../models/personas/persona-story-state.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
