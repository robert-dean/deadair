---
title: 'Delete persona story beat'
sidebar_label: 'Delete persona story beat'
sidebar_position: 33
mdx:
    format: 'md'
---

Removes one part outright, leaving the arc standing. Turning down a PROPOSAL is a state instead

**`DELETE`** `/personas/{id}/stories/{storyId}/beats/{beatId}`

:::note
SDK method: `deletePersonaStoryBeat`
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

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
