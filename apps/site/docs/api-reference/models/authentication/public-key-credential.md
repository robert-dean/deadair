---
title: 'PublicKeyCredential'
sidebar_position: 23
mdx:
    format: 'md'
---

> Represents a common shape of a `PublicKeyCredential` after the client serializes the `id` and `rawId` fields to base64 strings for transport

<details>
<summary>Attributes (4)</summary>

| Attribute                 | Type                             | Required | Description                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `string`                         | Yes      | The base64url encoding of `rawId`                                                                                                                                                                                                                                                                                                                                                       |
| `type`                    | `'public-key'`                   | Yes      | This enumeration defines the valid credential types. It is an extension point; values can be added to it in the future, as more credential types are defined. The values of this enumeration are used for versioning the Authentication Assertion and attestation structures according to the type of the authenticator. Currently one credential type is defined, namely `public-key`. |
| `rawId`                   | `string`                         | Yes      | The credential identifier                                                                                                                                                                                                                                                                                                                                                               |
| `authenticatorAttachment` | `'cross-platform' \| 'platform'` | No       | The authenticator attachment                                                                                                                                                                                                                                                                                                                                                            |

</details>
