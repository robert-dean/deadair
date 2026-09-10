---
title: 'Read session'
sidebar_label: 'Read session'
sidebar_position: 12
mdx:
    format: 'md'
---

Who the caller is and which platform roles they hold

**`GET`** `/auth/session`

:::note
SDK method: `readSession`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [AuthSession](../models/authentication/auth-session.md) object.
