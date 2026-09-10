---
title: 'FetcherAuthorizationStart'
sidebar_position: 2
mdx:
    format: 'md'
---

> An authorization to open in a browser

<details>
<summary>Attributes (2)</summary>

| Attribute      | Type     | Required | Description                                                 |
| -------------- | -------- | -------- | ----------------------------------------------------------- |
| `authorizeUrl` | `string` | Yes      | The Spotify consent page, to be opened by the operator      |
| `expiresInMs`  | `number` | Yes      | How long this URL is good for. Starting another replaces it |

</details>
