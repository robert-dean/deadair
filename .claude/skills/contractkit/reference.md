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

`subarea` is also supported and nests the SDK one level deeper (`sdk.<area>.<subarea>.method`).
Nothing in this repo uses it yet.

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
- Constraints go in parens: `int(min=, max=)`, `string(min=, max=, len=)`.
- `enum(asc, desc) = desc` for closed sets, `array(Artist)` for lists.
- `?` marks optional, `readonly` marks server-supplied, `writeonly` marks never-returned.
- `#` starts a comment. A comment on the same line as a field or operation becomes the JSDoc on the
  generated member, so write them for the reader of the SDK.
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
        security: {
            policy: none
        }
        query: CatalogQuery
        response: {
            200: {
                application/json: {
                    meta: Pagination
                    data: array(Album)
                }
            }
        }
    }
}
```

- `operation(internal)` generates the router but no SDK method.
- Verb keys: `get` `post` `put` `patch` `delete`.
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

The generated router hardcodes the status of the **first response entry that carries a body**.
Additional statuses (a `304`, an error shape) are documentation for the SDK and OpenAPI surface,
not runtime behaviour: they have to be produced by middleware or by the service throwing. See the
comments in `art/art.ck` for the worked example.

## Generated schema names

A contract with `readonly` or `writeonly` fields yields more than one Zod schema:

| Schema | Contains | Used for |
| --- | --- | --- |
| `XBase` | everything including writeonly | only emitted when writeonly fields exist |
| `X` | no writeonly | responses |
| `XInput` | no readonly | request bodies and query params |

So the router validates `ctx.parsedBody` against `PluginConfigInput` and `ctx.query` against
`CatalogQueryInput.strict()`. A field you marked `readonly` cannot arrive from a client.
