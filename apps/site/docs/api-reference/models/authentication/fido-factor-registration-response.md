---
title: 'FidoFactorRegistrationResponse'
sidebar_position: 70
mdx:
    format: 'md'
---

<details>
<summary>Attributes (5)</summary>

| Attribute        | Type                    | Required | Description                             |
| ---------------- | ----------------------- | -------- | --------------------------------------- |
| `method`         | `'fido'`                | Yes      | The method of the factor                |
| `registrationId` | `string`                | Yes      | The registration identifier             |
| `expiresAt`      | `string`                | Yes      | The expiration timestamp                |
| `issuedAt`       | `string`                | Yes      | The issuance timestamp                  |
| `attestation`    | `FidoFactorAttestation` | Yes      | The FIDO factor attestation information |

</details>
