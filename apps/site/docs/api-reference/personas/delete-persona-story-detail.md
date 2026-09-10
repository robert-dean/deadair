---
title: 'Delete persona story detail'
sidebar_label: 'Delete persona story detail'
sidebar_position: 28
mdx:
    format: 'md'
---

Removes one detail, leaving the story it was hung on alone

**`DELETE`** `/personas/{id}/stories/{storyId}/details/{detailId}`

:::note
SDK method: `deletePersonaStoryDetail`
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

## Response

`200 OK` — Returns a [PersonaStoryList](../models/personas/persona-story-list.md) object.
