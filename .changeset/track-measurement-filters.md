---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

The tracks list can now be narrowed by what the measurement walk did. **Measured by** shows every record one analysis plugin measured or tried to, and failed measurements are counted and filterable by kind: could not fetch, stopped early, or would not decode. A record's page says which kind its failure was. On the API, `GET /catalog/tracks` takes `analyzer` and `measureFailure`, the state counts carry `analyzers` and `measureFailures`, and a track's analysis carries `failureCode`.
