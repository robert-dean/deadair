---
title: 'BaseAuthenticationLoginStartResponse'
sidebar_position: 37
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type                                  | Required | Description                        |
| ------------- | ------------------------------------- | -------- | ---------------------------------- |
| `grant_type`  | `PasswordlessAuthenticationGrantType` | Yes      | The grant type for the response    |
| `challengeId` | `string`                              | Yes      | The challenge identifier           |
| `expiresAt`   | `string`                              | Yes      | The challenge expiration timestamp |

</details>
