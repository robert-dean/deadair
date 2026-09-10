---
title: 'FetcherAuthorizationInput'
sidebar_position: 3
mdx:
    format: 'md'
---

> The callback the browser could not deliver, handed over by the operator instead

<details>
<summary>Attributes (1)</summary>

| Attribute     | Type     | Required | Description                                                                                                                                                               |
| ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirectUrl` | `string` | Yes      | The address the browser ended up at, pasted whole. Taken apart by the fetcher rather than here, because two readings of one address is one of them being wrong eventually |

</details>
