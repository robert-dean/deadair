---
title: 'Create topic'
sidebar_label: 'Create topic'
sidebar_position: 2
mdx:
    format: 'md'
---

Names a new subject. Nothing uses it until something points at it

**`POST`** `/topics`

:::note
SDK method: `createTopic`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [Topic](../models/topics/topic.md) object.

## Response

`201 Created` — Returns a [TopicList](../models/topics/topic-list.md) object.
