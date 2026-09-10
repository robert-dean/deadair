---
title: 'AuthenticationRegistration'
sidebar_position: 27
mdx:
    format: 'md'
---

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type     | Required | Description                                          |
| ---------------- | -------- | -------- | ---------------------------------------------------- |
| `registrationId` | `string` | Yes      | The registration identifier. _read-only_             |
| `expiresAt`      | `string` | Yes      | The registration expiration timestamp. _read-only_   |
| `email`          | `string` | Yes      | User's email address. _write-only_                   |
| `password`       | `string` | No       | optionally set a password for the user. _write-only_ |

</details>
