---
title: 'PublicKeyCredentialDescriptor'
sidebar_position: 36
mdx:
    format: 'md'
---

> A credential the relying party expects the user to be able to present

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type                                                    | Required | Description                                         |
| ------------ | ------------------------------------------------------- | -------- | --------------------------------------------------- |
| `type`       | `'public-key'`                                          | Yes      | The credential type — currently always `public-key` |
| `id`         | `string`                                                | Yes      | The base64url-encoded credential identifier         |
| `transports` | `('usb' \| 'nfc' \| 'ble' \| 'internal' \| 'hybrid')[]` | No       | Transports the authenticator advertises             |

</details>
