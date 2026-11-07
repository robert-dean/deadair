---
title: 'Direct the presenters'
sidebar_label: 'Direct the presenters'
sidebar_position: 17
mdx:
    format: 'md'
---

Gives the presenters a line to lean on for a number of hours, replacing any direction already in force. Breaks already written are not rewritten

**`PUT`** `/direction`

:::note
SDK method: `directThePresenters`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [TalkDirectionInput](../models/director/talk-direction-input.md) object.

## Response

`200 OK` — Returns a [TalkDirectionReading](../models/director/talk-direction-reading.md) object.
