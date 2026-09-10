---
title: 'Start mfa challenge'
sidebar_label: 'Start mfa challenge'
sidebar_position: 9
mdx:
    format: 'md'
---

Mint a fresh MFA challenge for the _current_ authenticated session so the SPA can satisfy a `step_up_required` denial. Optionally filters eligible factors against an inbound `StepUpRequirement` hint. Returns `enrollment_required` when no enrolled factor matches the requirement so the SPA can route the user into enrollment instead of getting stuck.

**`POST`** `/auth/mfa/start`

:::note
SDK method: `startMFAChallenge`
Security: authenticated (policy: none)
:::

## Request body (`application/json`)

Accepts a [StepUpStartRequest](../models/authentication/step-up-start-request.md) object.

## Response

`200 OK` — Returns a [StepUpStartResponse](../models/authentication/step-up-start-response.md) object.
