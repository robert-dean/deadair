---
title: 'Export topics'
sidebar_label: 'Export topics'
sidebar_position: 4
mdx:
    format: 'md'
---

Every subject this station has named as one file, to hand to another station

**`GET`** `/topics/export`

:::note
SDK method: `exportTopics`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [TopicPack](../models/topics/topic-pack.md) object.
