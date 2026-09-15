---
title: 'ApiKeyIssued'
sidebar_position: 63
mdx:
    format: 'md'
---

> A key and its token. The only time the token is ever returned: store it now, because nothing can show it again

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                               |
| --------- | -------- | -------- | --------------------------------------------------------- |
| `key`     | `ApiKey` | Yes      | The key as it will appear in the list                     |
| `token`   | `string` | Yes      | The bearer token, sent as `Authorization: Bearer <token>` |

</details>
