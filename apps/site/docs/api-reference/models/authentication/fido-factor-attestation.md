---
title: 'FidoFactorAttestation'
sidebar_position: 69
mdx:
    format: 'md'
---

> The FIDO factor attestation information

<details>
<summary>Attributes (6)</summary>

| Attribute          | Type                                                | Required | Description                          |
| ------------------ | --------------------------------------------------- | -------- | ------------------------------------ |
| `rp`               | `{ name: string; id: string; icon?: string }`       | Yes      | The relying party                    |
| `user`             | `{ id: string; name: string; displayName: string }` | Yes      |                                      |
| `challenge`        | `string`                                            | Yes      | The challenge                        |
| `pubKeyCredParams` | `{ type: 'public-key'; alg: number }[]`             | Yes      | The public key credential parameters |
| `timeout`          | `number`                                            | No       | The timeout                          |
| `attestation`      | `'direct' \| 'indirect' \| 'none'`                  | Yes      | The attestation                      |

</details>
