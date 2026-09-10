---
title: 'Delete topic'
sidebar_label: 'Delete topic'
sidebar_position: 5
mdx:
    format: 'md'
---

Removes a subject, and any band on the format clock that asked for it

**`DELETE`** `/topics/{id}`

:::note
SDK method: `deleteTopic`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [TopicList](../models/topics/topic-list.md) object.
