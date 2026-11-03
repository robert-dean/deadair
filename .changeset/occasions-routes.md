---
'@deadair/api': patch
'@deadair/sdk': patch
---

**Occasions can be read and written through the API.** `GET` and `POST /occasions`, `PUT /occasions/order`, and `PUT` and `DELETE /occasions/{id}`. Each one says when it next falls, and a rule that could never fall, such as the 31st of June, is refused with the reason.
