---
title: 'ScriptRating'
sidebar_position: 12
mdx:
    format: 'md'
---

> What an operator thought of something the station said.
>
> The catalog's three spellings exactly, and deliberately not a second vocabulary: an opinion is an
> opinion whether it is about a record or about a sentence, and `catalog/rating.ts` is the one place
> the words and the column's numbers meet.
>
> `neutral` is a real answer rather than an absence. Rating something back to nothing is a thing an
> operator does, and it has to be distinguishable from never having listened, which is the field
> being absent on the attempt.

```typescript
type ScriptRating = 'liked' | 'neutral' | 'disliked';
```
