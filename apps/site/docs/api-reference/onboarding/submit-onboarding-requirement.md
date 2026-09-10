---
title: 'Submit onboarding requirement'
sidebar_label: 'Submit onboarding requirement'
sidebar_position: 2
mdx:
    format: 'md'
---

**`POST`** `/onboarding`

:::note
SDK method: `submitOnboardingRequirement`
Security: public
:::

## Request body (`application/json`)

Accepts a [OnboardingRequirement](../models/onboarding/onboarding-requirement.md) object.

## Response

`200 OK` — Returns a list of [OnboardingRequirement](../models/onboarding/onboarding-requirement.md) objects.
