---
title: 'OAuthAuthorizationRedirect'
sidebar_position: 4
mdx:
    format: 'md'
---

> A request with something wrong that the app should be told about: send the browser back to it

<details>
<summary>Attributes (2)</summary>

| Attribute     | Type         | Required | Description               |
| ------------- | ------------ | -------- | ------------------------- |
| `kind`        | `'redirect'` | Yes      | Discriminator             |
| `redirectUrl` | `string`     | Yes      | Where to send the browser |

</details>
