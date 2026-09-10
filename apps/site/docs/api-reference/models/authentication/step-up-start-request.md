---
title: 'StepUpStartRequest'
sidebar_position: 56
mdx:
    format: 'md'
---

> Mint a fresh MFA challenge for the current session so the SPA can satisfy a `step_up_required` denial. Filters mirror `StepUpRequirement` from `@maroonedsoftware/policies`.

<details>
<summary>Attributes (3)</summary>

| Attribute           | Type                           | Required | Description                                              |
| ------------------- | ------------------------------ | -------- | -------------------------------------------------------- |
| `acceptableMethods` | `AuthenticationFactorMethod[]` | No       | If set, only these factor methods are listed as eligible |
| `acceptableKinds`   | `AuthenticationFactorKind[]`   | No       | If set, only these factor kinds are listed as eligible   |
| `excludeMethods`    | `AuthenticationFactorMethod[]` | No       | If set, factors with these methods are never listed      |

</details>
