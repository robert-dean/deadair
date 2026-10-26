---
title: 'Get the live input connection'
sidebar_label: 'Get the live input connection'
sidebar_position: 11
mdx:
    format: 'md'
---

What an encoder needs to connect to the live input: the port, the mount, the user and the password

**`GET`** `/playout/live/connection`

:::note
SDK method: `getTheLiveInputConnection`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [LiveConnection](../models/playout/live-connection.md) object.
