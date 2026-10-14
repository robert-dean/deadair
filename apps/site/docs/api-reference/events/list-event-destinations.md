---
title: 'List event destinations'
sidebar_label: 'List event destinations'
sidebar_position: 2
mdx:
    format: 'md'
---

Every event destination, oldest first

**`GET`** `/events/destinations`

:::note
SDK method: `listEventDestinations`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [EventDestinationList](../models/events/event-destination-list.md) object.
