---
title: 'List event types'
sidebar_label: 'List event types'
sidebar_position: 1
mdx:
    format: 'md'
---

Every kind of event the station sends, each with an example of what a destination receives

**`GET`** `/events/types`

:::note
SDK method: `listEventTypes`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [EventTypeList](../models/events/event-type-list.md) object.
