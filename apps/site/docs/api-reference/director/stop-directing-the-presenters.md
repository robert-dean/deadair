---
title: 'Stop directing the presenters'
sidebar_label: 'Stop directing the presenters'
sidebar_position: 18
mdx:
    format: 'md'
---

Ends the direction now. Breaks already written are not rewritten

**`DELETE`** `/direction`

:::note
SDK method: `stopDirectingThePresenters`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [TalkDirectionReading](../models/director/talk-direction-reading.md) object.
