---
title: 'Read the talk direction'
sidebar_label: 'Read the talk direction'
sidebar_position: 16
mdx:
    format: 'md'
---

The direction in force, if any

**`GET`** `/direction`

:::note
SDK method: `readTheTalkDirection`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [TalkDirectionReading](../models/director/talk-direction-reading.md) object.
