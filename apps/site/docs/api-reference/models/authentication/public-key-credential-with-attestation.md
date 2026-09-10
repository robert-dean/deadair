---
title: 'PublicKeyCredentialWithAttestation'
sidebar_position: 46
mdx:
    format: 'md'
---

> The credential the client posts back to complete registration

Extends [`PublicKeyCredential`](./public-key-credential.md)

<details>
<summary>Attributes (2)</summary>

| Attribute                | Type                                   | Required | Description                            |
| ------------------------ | -------------------------------------- | -------- | -------------------------------------- |
| `clientExtensionResults` | `SimpleClientExtensionResults`         | Yes      | The client extension results           |
| `response`               | `FidoAuthenticatorAttestationResponse` | Yes      | The authenticator attestation response |

</details>
