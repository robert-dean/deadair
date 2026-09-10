---
title: 'FidoPublicKeyCredentialRequestOptions'
sidebar_position: 40
mdx:
    format: 'md'
---

<details>
<summary>Attributes (8)</summary>

| Attribute          | Type                                         | Required | Description                                    |
| ------------------ | -------------------------------------------- | -------- | ---------------------------------------------- |
| `challenge`        | `string`                                     | Yes      |                                                |
| `timeout`          | `number`                                     | No       | WebAuthn timeout hint in milliseconds          |
| `rpId`             | `string`                                     | No       |                                                |
| `attestation`      | `'direct' \| 'indirect' \| 'none'`           | No       | The attestation                                |
| `userVerification` | `'required' \| 'preferred' \| 'discouraged'` | No       | Whether the authenticator must verify the user |
| `rawChallenge`     | `Blob`                                       | No       | The raw challenge                              |
| `extensions`       | `Record<string, unknown>`                    | No       |                                                |
| `allowCredentials` | `PublicKeyCredentialDescriptor[]`            | No       |                                                |

</details>
