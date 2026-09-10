---
title: 'ClientCredentialsAuthenticationRequest'
sidebar_position: 7
mdx:
    format: 'md'
---

> Represents an application authentication request

Extends [`BaseAuthenticationRequest`](./base-authentication-request.md)

<details>
<summary>Attributes (3)</summary>

| Attribute       | Type                   | Required | Description                    |
| --------------- | ---------------------- | -------- | ------------------------------ |
| `grant_type`    | `'client_credentials'` | Yes      | The grant type for the request |
| `client_id`     | `string`               | Yes      | The client identifier          |
| `client_secret` | `string`               | Yes      | The client secret              |

</details>
