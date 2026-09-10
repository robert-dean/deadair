---
title: 'Set persona story state'
sidebar_label: 'Set persona story state'
sidebar_position: 25
mdx:
    format: 'md'
---

Accepts a proposal, turns one down, or takes a story out of the rotation without losing it

**`PUT`** `/personas/{id}/stories/{storyId}/state`

:::note
SDK method: `setPersonaStoryState`
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

Accepts a [PersonaStoryState](../models/personas/persona-story-state.md) object.

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
