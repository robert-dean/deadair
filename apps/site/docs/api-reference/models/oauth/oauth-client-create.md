---
title: 'OAuthClientCreate'
sidebar_position: 12
mdx:
    format: 'md'
---

> An app an operator registers by hand, for a client that cannot register itself

<details>
<summary>Attributes (3)</summary>

| Attribute                 | Type                    | Required | Description                                                                       |
| ------------------------- | ----------------------- | -------- | --------------------------------------------------------------------------------- |
| `name`                    | `string`                | Yes      | What to call it                                                                   |
| `redirectUris`            | `string[]`              | Yes      | Where it may be sent back to. At least one; https, or this computer's own address |
| `tokenEndpointAuthMethod` | `OAuthClientAuthMethod` | Yes      | `none` for an app on somebody's own device, otherwise a secret it keeps           |

</details>
