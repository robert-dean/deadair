---
title: 'List my requests'
sidebar_label: 'List my requests'
sidebar_position: 4
mdx:
    format: 'md'
---

The signed-in account's own recent requests

**`GET`** `/requests/mine`

:::note
SDK method: `listMyRequests`
Security: authenticated (policy: requests.ask)
:::

## Response

`200 OK` — Returns a [ListenerRequestList](../models/requests/listener-request-list.md) object.
