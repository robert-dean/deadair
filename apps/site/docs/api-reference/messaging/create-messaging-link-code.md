---
title: 'Create messaging link code'
sidebar_label: 'Create messaging link code'
sidebar_position: 2
mdx:
    format: 'md'
---

A new one-time code for linking a chat account. It replaces any earlier code and stops working after ten minutes

**`POST`** `/messaging/links/code`

:::note
SDK method: `createMessagingLinkCode`
Security: authenticated (policy: platform.manage)
:::

## Response

`201 Created` — Returns a [MessagingLinkCode](../models/messaging/messaging-link-code.md) object.
