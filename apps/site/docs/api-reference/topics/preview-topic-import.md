---
title: 'Preview topic import'
sidebar_label: 'Preview topic import'
sidebar_position: 5
mdx:
    format: 'md'
---

Reads a file and reports what importing it would add, skip and leave out. Writes nothing

**`POST`** `/topics/import/preview`

:::note
SDK method: `previewTopicImport`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [TopicPack](../models/topics/topic-pack.md) object.

## Response

`200 OK` — Returns a [PackImportPlan](../models/topics/pack-import-plan.md) object.
