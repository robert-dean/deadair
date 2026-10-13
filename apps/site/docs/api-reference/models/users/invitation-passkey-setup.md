---
title: 'InvitationPasskeySetup'
sidebar_position: 10
mdx:
    format: 'md'
---

> A passkey to make, for an invitation being accepted

<details>
<summary>Attributes (3)</summary>

| Attribute        | Type                    | Required | Description                                 |
| ---------------- | ----------------------- | -------- | ------------------------------------------- |
| `method`         | `'fido'`                | Yes      | Discriminator                               |
| `registrationId` | `string`                | Yes      | Send this back with the credential          |
| `attestation`    | `FidoFactorAttestation` | Yes      | What to hand `navigator.credentials.create` |

</details>
