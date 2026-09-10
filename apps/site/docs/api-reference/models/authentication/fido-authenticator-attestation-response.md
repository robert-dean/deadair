---
title: 'FidoAuthenticatorAttestationResponse'
sidebar_position: 45
mdx:
    format: 'md'
---

> Serialized form of `AuthenticatorAttestationResponse` — produced by the browser at registration; all binary fields are base64-encoded for transport

<details>
<summary>Attributes (3)</summary>

| Attribute           | Type                           | Required | Description                              |
| ------------------- | ------------------------------ | -------- | ---------------------------------------- |
| `clientDataJSON`    | `string`                       | Yes      | The client data JSON                     |
| `attestationObject` | `string`                       | Yes      | The attestation object                   |
| `transports`        | `FidoAuthenticatorTransport[]` | No       | The transports used by the authenticator |

</details>
