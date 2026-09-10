---
title: 'Create pronunciation'
sidebar_label: 'Create pronunciation'
sidebar_position: 16
mdx:
    format: 'md'
---

Adds one the operator typed. It is said from the next render on

**`POST`** `/pronunciations`

:::note
SDK method: `createPronunciation`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [PronunciationWrite](../models/render/pronunciation-write.md) object.

## Response

`201 Created` — Returns a [PronunciationList](../models/render/pronunciation-list.md) object.
