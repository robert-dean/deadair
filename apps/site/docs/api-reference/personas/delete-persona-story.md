---
title: 'Delete persona story'
sidebar_label: 'Delete persona story'
sidebar_position: 24
mdx:
    format: 'md'
---

Removes a story outright, details and all. Turning down a PROPOSAL is a state rather than this, or the next pass writes it again

**`DELETE`** `/personas/{id}/stories/{storyId}`

:::note
SDK method: `deletePersonaStory`
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

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
