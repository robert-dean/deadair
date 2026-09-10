---
title: 'CoreOnboardingRequirement'
sidebar_position: 2
mdx:
    format: 'md'
---

> A single onboarding requirement

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type                       | Required | Description                                                     |
| ------------- | -------------------------- | -------- | --------------------------------------------------------------- |
| `key`         | `OnboardingRequirementKey` | Yes      | The key of the requirement                                      |
| `title`       | `string`                   | Yes      | Human-readable label for the onboarding checklist. _read-only_  |
| `description` | `string`                   | No       | Optional longer explanation. _read-only_                        |
| `optional`    | `boolean`                  | Yes      | Whether the requirement is optional for onboarding. _read-only_ |

</details>
