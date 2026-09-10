---
title: 'Update topic'
sidebar_label: 'Update topic'
sidebar_position: 4
mdx:
    format: 'md'
---

Rewrites one subject. A break already written keeps the words it was given

**`PUT`** `/topics/{id}`

:::note
SDK method: `updateTopic`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [Topic](../models/topics/topic.md) object.

## Response

`200 OK` — Returns a [TopicList](../models/topics/topic-list.md) object.
