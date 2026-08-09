# `.ck` cheat-sheet

Distilled from the contracts in this repo. It is not the language spec: for anything below the
level of what `apps/api/data/contracts/` already demonstrates (unions, discriminated unions,
tuples, records, lazy refs, `{{var}}` substitution, multi-base inheritance and `override`), read
<https://github.com/MaroonedSoftware/contractkit#dsl-language-reference> rather than guessing.
Guessing costs a full `pnpm build:contracts` round-trip to find out you were wrong.

## File header

Every file starts with an `options` block. `area` decides the output directories and the SDK
namespace; `services` maps the names used in `service:` to import specifiers.

```
options {
    keys: {
        area: catalog
    }
    services: {
        ArtistsService: "#src/modules/catalog/artists.service.js"
    }
}
```

`subarea` nests the SDK one level deeper (`sdk.<area>.<subarea>.method`). `authentication.factor.ck`
and `authentication.sessions.ck` use it.

The options block also accepts a `security` block (the file-level floor — see SKILL.md) and
`request: { headers: { ... } }` / `response: { headers: { ... } }`, which merge declared headers into
every operation in the file. Nothing here uses the header defaults yet.

A `#` comment is legal above `options`, directly in the options body between its sub-blocks, inside
`keys { }` / `services { }` / `security { }`, and trailing an individual `keys`/`services` entry.
All of those round-trip through the formatter as of core 0.26 / prettier-plugin 0.14.1.

Two spacing rules on a service path: an unquoted value ends at whitespace-then-`#`, so
`PluginsService: #src/modules/plugins/plugins.service.js` (no space before the `#`) is a subpath, not
a comment, and stays unquoted through formatting. A value the formatter cannot read back bare is
quoted for you.

## Contracts

```
contract Artist: {
    id: readonly uuid
    name: string
    mbid?: uuid                          # optional
    rating: int(min=-1, max=1) = 0       # constrained, with a default
    albumCount: readonly int(min=0)
}

contract CatalogQuery: Pagination & {    # intersection: inherits Pagination's fields
    search?: string(min=1, max=200)
}
```

- Scalars: `string` `number` `int` `bigint` `boolean` `date` `time` `datetime` `duration`
  `interval` `email` `url` `uuid` `object` `json` `binary` `unknown` `null`.
  **`date` / `time` / `datetime` / `duration` / `interval` generate Luxon objects over ISO-8601
  strings**, not numbers — `duration` is a `Duration` parsed from `"PT3M42S"`. `binary` is a
  `Buffer` on the server and a `Blob` in the SDK.
- Constraints go in parens: `int(min=, max=)`, `string(min=, max=, len=)`, and `string(regex=/.../)`
  (see `registration.types.ck` for the E.164 phone field).
- `enum(asc, desc) = desc` for closed sets, `array(Artist)` for lists, `record(string, unknown)` for
  open maps, `literal("code")` for a fixed value, `discriminated(by=grant_type, A | B)` for a tagged
  union. `|` is a plain union, `&` an intersection.
- `?` marks optional, `readonly` marks server-supplied, `writeonly` marks never-returned.
  `deprecated` and `override` are also field modifiers; nothing here uses them yet.
- A contract may carry `mode(strict|strip|loose)` to set how unknown keys are handled
  (`PluginOAuthCallbackQuery` uses `mode(strip)` because OAuth providers add their own params).
  `mode` also attaches to `params:`, `query:` and `headers:`. Defaults: params `strict`, query
  `strict`, headers `strip`.
- A contract may carry `format(input=snake, output=snake)` to name fields in camelCase while the
  wire stays snake_case. The auth token contracts use `format(output=snake)`. Read the SKILL.md note
  before extending this — inheritance across multiple bases is not fully implemented.
- `#` starts a comment, and **a blank line decides whether it is documentation.** On the same line as
  a field or operation, or on the line directly above it, it becomes the JSDoc on the generated
  member and ends up in the public SDK — so write those for the reader of the SDK, not for the next
  contract author. Separated from the declaration below it by a blank line, it is a standalone
  divider: kept verbatim in the `.ck`, generated nowhere. A doc comment before an `operation` becomes
  that route's description and surfaces on any verb that has none of its own.
- Comments in an operation *body* (above `security:`, above a verb that already has its own inline
  `# ...`, or after the last key before the closing brace) are layout, not documentation. That is
  where policy rationale goes.
- Cross-file references resolve project-wide, so `Pagination` from `shared/pagination.ck` is usable
  anywhere without an import.

## Operations

```
operation /catalog/artists/{id}/albums: {
    params: {
        id: uuid
    }
    get: {                                # The albums credited to one artist
        name: List artist albums
        service: AlbumsService.listAlbumsByArtist
        query: CatalogQuery
        response: {
            200: {
                application/json: AlbumPage
            }
        }
    }
}
```

No `security` block on the verb: this file declares `policy: platform.view` once in its `options`
block and every operation inherits it. And the paged response is a named contract rather than an
inline `{ meta, data }` object, so the SDK returns `AlbumPage` instead of an anonymous type the
console cannot import.

- `operation(internal)` generates the router but no SDK method. `deprecated` and `public` are the
  other route modifiers, and they also attach to a verb (`get(deprecated): { ... }`); `deprecated`
  puts `@deprecated` on the generated member. Nothing here uses either yet.
- Verb keys: `get` `post` `put` `patch` `delete`.
- `security:` sits on the verb, the route, or the file's options block, nearest wins. See SKILL.md.
- A verb may also carry `signature:` (emits `requireSignature`, an HMAC over the raw body — for
  webhooks) and `plugins: { name: "path.yml" }` (hands a codegen plugin a per-operation override
  file). Neither is used here.
- `name:` becomes the camelCased SDK method name; `sdk:` overrides it verbatim.
- `params:` sits on the operation, not the verb, and must cover every `{brace}` in the path.
- `query:` and `request:` take a contract name or an inline object. `request:` is keyed by content
  type and may list several:
  ```
  request: {
      application/x-www-form-urlencoded: AuthenticationRequest
      application/json: AuthenticationRequest
  }
  ```
- `response:` is keyed by status, then content type. A `headers: { ... }` block may sit alongside
  the content type inside a status.

## Response statuses

A status may list several mimes, and an operation may declare several statuses. **A status is
emitted by the service if it carries a block, or is 2xx.**

| Declared | Meaning |
| --- | --- |
| `200: { application/json: X }` | the service returns it |
| `304: {}` | the service returns it, carrying nothing |
| `304:` (bare) | documented only; middleware or a throw produces it |
| `404(documented): { ... }` | has a block but stays on the throw path |

Several mimes on one status → the service returns `contentType` alongside the body and the router
sets `ctx.type` from it. Several emitted statuses → the service returns a union discriminated on
`status`, and the SDK returns a matching union rather than throwing. Statuses left on the throw path
get a generated `…ErrorBody` alias, and `SdkError` is parameterized by it. `art/art.ck` (four image
mimes plus a bare `304`) is the worked example.

## Generated schema names

A contract with `readonly` or `writeonly` fields yields more than one Zod schema:

| Schema | Contains | Used for |
| --- | --- | --- |
| `XBase` | everything including writeonly | only emitted when writeonly fields exist |
| `X` | no writeonly | responses |
| `XInput` | no readonly | request bodies and query params |

So the router validates `ctx.parsedBody` against `PluginConfigInput` and `ctx.query` against
`CatalogQueryInput.strict()`. A field you marked `readonly` cannot arrive from a client.
