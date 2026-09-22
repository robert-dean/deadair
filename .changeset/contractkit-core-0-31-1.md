---
'@deadair/sdk': patch
---

The TypeScript SDK no longer depends on `decimal.js`. Its generated types imported `decimal.js` even in files with no decimal field, and no contract has one today, so the import is gone and so is the dependency. That also means importing the SDK no longer calls `Decimal.set(...)` on your copy of `decimal.js` as a side effect. If your own code relied on the SDK having set `toExpNeg` and `toExpPos`, set them yourself.
