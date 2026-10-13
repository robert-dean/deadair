---
title: 'InvitationAuthenticatorSetup'
sidebar_position: 9
mdx:
    format: 'md'
---

> An authenticator app to scan, for an invitation being accepted

<details>
<summary>Attributes (5)</summary>

| Attribute        | Type              | Required | Description                                |
| ---------------- | ----------------- | -------- | ------------------------------------------ |
| `method`         | `'authenticator'` | Yes      | Discriminator                              |
| `registrationId` | `string`          | Yes      | Send this back with the first code         |
| `secret`         | `string`          | Yes      | The key, for an app that cannot scan       |
| `uri`            | `string`          | Yes      | The `otpauth://` address the QR code holds |
| `qrCode`         | `string`          | Yes      | The QR code, as a data URL                 |

</details>
