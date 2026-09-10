---
title: 'Start factor challenge'
sidebar_label: 'Start factor challenge'
sidebar_position: 8
mdx:
    format: 'md'
---

Issue a factor verification challenge for a pending MFA round. Authenticated via the short-lived `mfa_challenge_id` in the body, not by session — this is the only /auth/factors/* route that does not require an authenticated session.

**`POST`** `/auth/factors/start`

:::note
SDK method: `startFactorChallenge`
Security: public
:::

## Request body (`application/json`)

Accepts a [FactorChallengeStartRequest](../models/authentication/factor-challenge-start-request.md) object.

## Response

`200 OK` — Returns a [FactorChallengeStartResponse](../models/authentication/factor-challenge-start-response.md) object.
