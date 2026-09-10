---
title: 'List topic kinds'
sidebar_label: 'List topic kinds'
sidebar_position: 3
mdx:
    format: 'md'
---

Which sorts of break have subjects, and the form each one's settings are edited with

**`GET`** `/topics/kinds`

:::note
SDK method: `listTopicKinds`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [TopicKindList](../models/topics/topic-kind-list.md) object.
