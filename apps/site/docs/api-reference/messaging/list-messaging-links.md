---
title: 'List messaging links'
sidebar_label: 'List messaging links'
sidebar_position: 1
mdx:
    format: 'md'
---

The chat accounts linked to the signed-in account

**`GET`** `/messaging/links`

:::note
SDK method: `listMessagingLinks`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [MessagingLinkList](../models/messaging/messaging-link-list.md) object.
