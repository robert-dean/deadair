---
title: 'StationItemState'
sidebar_position: 10
mdx:
    format: 'md'
---

> Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around. The three terminal states that are not `played` are three different facts on a page that has to say why the station is silent: `skipped` is the station passing over an item it reached, `removed` is an operator taking one out before its turn, and `unavailable` is a record the station could not obtain the audio for — the only one of the three an operator can act on, since it names a copy rather than a decision

```typescript
type StationItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped' | 'unavailable' | 'removed';
```
