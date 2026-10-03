---
title: 'List output devices'
sidebar_label: 'List output devices'
sidebar_position: 1
mdx:
    format: 'md'
---

Every speaker the station can play on, from every `output` plugin, with the mounts each can take

**`GET`** `/outputs/devices`

:::note
SDK method: `listOutputDevices`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [OutputDeviceList](../models/outputs/output-device-list.md) object.
