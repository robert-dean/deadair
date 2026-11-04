---
title: 'Import topics'
sidebar_label: 'Import topics'
sidebar_position: 6
mdx:
    format: 'md'
---

Adds what is new in a file. A subject this station already has, by kind and key, is left as it is

**`POST`** `/topics/import`

:::note
SDK method: `importTopics`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [TopicPack](../models/topics/topic-pack.md) object.

## Response

`200 OK` — Returns a [TopicImportResult](../models/topics/topic-import-result.md) object.
