---
title: 'Create event destination'
sidebar_label: 'Create event destination'
sidebar_position: 3
mdx:
    format: 'md'
---

Add an event destination. The answer carries its signing secret, which is not shown again

**`POST`** `/events/destinations`

:::note
SDK method: `createEventDestination`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [EventDestinationCreate](../models/events/event-destination-create.md) object.

## Response

`201 Created` — Returns a [EventDestinationCreated](../models/events/event-destination-created.md) object.
