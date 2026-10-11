---
'@deadair/api': patch
---

The bundled Pandora plugin is now actually loaded by the station. It shipped in the image and the docs called it bundled, but the API never listed it among its bundled plugin directories, so a station never discovered it.
