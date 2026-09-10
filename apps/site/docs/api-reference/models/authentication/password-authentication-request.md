---
title: 'PasswordAuthenticationRequest'
sidebar_position: 8
mdx:
    format: 'md'
---

> Represents an authentication password request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type         | Required | Description                                 |
| ------------ | ------------ | -------- | ------------------------------------------- |
| `grant_type` | `'password'` | Yes      | The grant type for the request              |
| `username`   | `string`     | Yes      | User's identifier, usually an email address |
| `password`   | `string`     | Yes      | User's password                             |

</details>
