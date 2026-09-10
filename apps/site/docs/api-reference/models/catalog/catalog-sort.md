---
title: 'CatalogSort'
sidebar_position: 12
mdx:
    format: 'md'
---

> What an artist or album list is ordered BY, where `Pagination.sort` says only which direction.
>
> name the default, and the only key every row here has
> albums how many records the station holds of them. Artists only
> tracks how many songs. Artists only
> year when the record came out. Albums only
> rating the operator's own opinion
>
> One enum for both lists rather than two, because the alternative is a second near-identical
> contract whose only content is which two keys it drops. A key the row cannot answer falls back to
> name order rather than failing: an ordering nobody can serve is a page an operator cannot open.

```typescript
type CatalogSort = 'name' | 'albums' | 'tracks' | 'year' | 'rating';
```
