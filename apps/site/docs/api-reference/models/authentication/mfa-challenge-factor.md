---
title: 'MfaChallengeFactor'
sidebar_position: 18
mdx:
    format: 'md'
---

> A factor the SPA may use to satisfy the MFA challenge

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type                         | Required | Description                                                                                                                 |
| ---------- | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `method`   | `AuthenticationFactorMethod` | Yes      | The factor method                                                                                                           |
| `methodId` | `string`                     | Yes      | The id of the enrolled factor (opaque to the SPA, must be echoed back in the proof for methods that don't bind another way) |
| `kind`     | `AuthenticationFactorKind`   | Yes      | The factor kind (knowledge, possession, biometric) — the SPA filters against step-up `acceptableKinds`/`excludeKinds` hints |
| `label`    | `string`                     | No       | Optional human-readable label (e.g. provider name for OIDC, friendly name for FIDO)                                         |

</details>
