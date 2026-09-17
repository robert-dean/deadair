options {
    keys: {
        area: art
    }
}

# The picture one KIND of break wears -- a weather forecast, a news bulletin -- as the console draws
# it.
#
# Only kinds the station actually holds bytes for are listed. A kind with no picture is a break
# wearing the station's logo on the mount and nothing in a listener's app, which is what every break
# did before this existed and is not a row worth drawing
contract BreakArtwork: {
    kind: string(min=1, max=64) # `segments.kind`, which is what decides which break wears this: `weather`, `news`, or whatever an operator wrote on a format-clock band
    url: string(max=2000) # Where the station serves it, as a path under the API root. The same shape and the same route a record's cover uses
    source: enum(shipped, operator) # Whether these are the bytes this repository ships or ones somebody uploaded over them
    hasShipped: boolean # Whether this repository ships a picture for this kind, which is whether reverting has anywhere to go
}

# Every kind the station holds a picture for, kind by kind
contract BreakArtworkList: {
    breaks: array(BreakArtwork)
}

# A picture arriving from the browser, as multipart form parts.
#
# Documentation rather than validation: a multipart body reaches the service as the raw parser and
# the generated client types the body as `FormData`, so nothing checks this shape. It says what to
# send
contract BreakArtworkUpload: {
    file: binary # The image itself. jpeg, png, webp or gif, decided by its BYTES rather than by its name or its declared type, and at most 4 MB
}
