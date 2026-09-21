---
title: 'Add persona story beat'
sidebar_label: 'Add persona story beat'
sidebar_position: 31
mdx:
    format: 'md'
---

Adds one part to an arc. A script rather than a summary: the floor speaks it as it stands

**`POST`** `/personas/{id}/stories/{storyId}/beats`

:::note
SDK method: `addPersonaStoryBeat`
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

Accepts a [PersonaStoryBeatWrite](../models/personas/persona-story-beat-write.md) object.

## Response

`201 Created` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
