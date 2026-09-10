---
title: 'AuthenticatorFactorRegistrationResponse'
sidebar_position: 68
mdx:
    format: 'md'
---

<details>
<summary>Attributes (7)</summary>

| Attribute        | Type              | Required | Description                       |
| ---------------- | ----------------- | -------- | --------------------------------- |
| `method`         | `'authenticator'` | Yes      | The method of the factor          |
| `registrationId` | `string`          | Yes      | The registration identifier       |
| `secret`         | `string`          | Yes      | The secret for the authenticator  |
| `uri`            | `string`          | Yes      | The URI for the authenticator     |
| `qrCode`         | `string`          | Yes      | The QR code for the authenticator |
| `expiresAt`      | `string`          | Yes      | The expiration timestamp          |
| `issuedAt`       | `string`          | Yes      | The issuance timestamp            |

</details>
