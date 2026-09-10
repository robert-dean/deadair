---
title: 'List topics'
sidebar_label: 'List topics'
sidebar_position: 1
mdx:
    format: 'md'
---

Every subject this station has named, for one sort of break or for all of them

**`GET`** `/topics`

:::note
SDK method: `listTopics`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                           |
| --------- | -------- | -------- | --------------------------------------------------------------------- |
| `kind`    | `string` | No       | One sort of break, or absent for every subject this station has named |

</details>

## Response

`200 OK` — Returns a [TopicList](../models/topics/topic-list.md) object.
