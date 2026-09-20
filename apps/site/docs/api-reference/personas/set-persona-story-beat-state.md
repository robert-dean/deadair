---
title: 'Set persona story beat state'
sidebar_label: 'Set persona story beat state'
sidebar_position: 34
mdx:
    format: 'md'
---

Accepts a proposed part, or turns it down without losing that it was turned down

**`PUT`** `/personas/{id}/stories/{storyId}/beats/{beatId}/state`

:::note
SDK method: `setPersonaStoryBeatState`
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

Accepts a [PersonaStoryState](../models/personas/persona-story-state.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
