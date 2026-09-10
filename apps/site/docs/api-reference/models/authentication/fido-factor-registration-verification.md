---
title: 'FidoFactorRegistrationVerification'
sidebar_position: 75
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute        | Type                                 | Required | Description                                                   |
| ---------------- | ------------------------------------ | -------- | ------------------------------------------------------------- |
| `method`         | `'fido'`                             | Yes      | The method of the factor                                      |
| `registrationId` | `string`                             | Yes      | The registration identifier                                   |
| `credential`     | `PublicKeyCredentialWithAttestation` | Yes      | The credential the client posts back to complete registration |

</details>
