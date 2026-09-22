---
'@deadair/sdk': patch
---

The TypeScript SDK's generated types no longer import `decimal.js` in files that have no decimal field. None do today, so importing the SDK no longer calls `Decimal.set(...)` on your copy of `decimal.js` as a side effect. If your own code relied on the SDK having set `toExpNeg` and `toExpPos`, set them yourself.
