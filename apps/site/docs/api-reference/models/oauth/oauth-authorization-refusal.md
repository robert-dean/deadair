---
title: 'OAuthAuthorizationRefusal'
sidebar_position: 5
mdx:
    format: 'md'
---

> A request that names no app the station knows, or an address the app did not register. Never sent anywhere

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type       | Required | Description              |
| ------------- | ---------- | -------- | ------------------------ |
| `kind`        | `'refuse'` | Yes      | Discriminator            |
| `error`       | `string`   | Yes      | The OAuth error code     |
| `description` | `string`   | Yes      | What was wrong, in words |

</details>
