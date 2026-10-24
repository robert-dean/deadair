options {
    keys: {
        area: director
    }
    services: {
        BreakKindsService: "#src/modules/director/break.kinds.service.js"
        BreakKindFileService: "#src/modules/director/break.kind.file.service.js"
    }
    security: {
        # The floor is the WRITE end, as in the clock and the topics: this file is one read and three
        # writes, so a route added without a block of its own is likelier to be another write, and
        # inheriting the tighter gate is the failure that gets reported rather than the one that goes
        # quiet. The read overrides it downward.
        policy: platform.manage
    }
}

# The kinds of break an operator writes rather than the station ships. Ideas #24.
#
# Every mutation answers the whole list, as the clock and the topics do: these rows are read together,
# and a caller handed back only the one it named is holding a list it has to refetch anyway.

operation /breaks/kinds: {
    get: { # Every kind of break you have written, switched on or not, in your own order
        name: List break kinds
        service: BreakKindsService.list
        security: {
            # The one read in the file, so it drops to the read floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
    post: { # Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it
        name: Create break kind
        service: BreakKindsService.create
        request: {
            application/json: BreakKind
        }
        response: {
            201: {
                application/json: BreakKindList
            }
        }
    }
}

operation /breaks/kinds/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given
        name: Update break kind
        service: BreakKindsService.update
        request: {
            application/json: BreakKind
        }
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
    delete: { # Removes a kind of break. Refused while a band on the format clock still names it
        name: Delete break kind
        service: BreakKindsService.remove
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
}

# The kinds as a file, to move between stations. A kind is prose the console already shows in full and
# carries no credential, so reading one is the read floor, as the persona export is.
operation /breaks/kinds/export: {
    get: { # Every kind of break you have written, as one file
        name: Export break kinds
        security: {
            policy: platform.view
        }
        service: BreakKindFileService.exportAll
        response: {
            200: {
                application/json: BreakKindFile
                headers: {
                    Content-Disposition?: string
                }
            }
        }
    }
}

operation /breaks/kinds/{id}/export: {
    params: {
        id: string(min=1, max=100)
    }
    get: { # One kind of break, as a file
        name: Export break kind
        security: {
            policy: platform.view
        }
        service: BreakKindFileService.exportOne
        response: {
            200: {
                application/json: BreakKindFile
                headers: {
                    Content-Disposition?: string
                }
            }
            404:
        }
    }
}

# What a file WOULD do here, written nowhere. Its own verb rather than a flag on the import, so the
# console can preview the moment a file is chosen and offer Import as a second, deliberate act.
operation /breaks/kinds/import/preview: {
    post: { # Reads a file and reports what importing it would create, rewrite, skip and refuse. Writes nothing
        name: Preview break kind import
        service: BreakKindFileService.preview
        query: {
            replace?: array(string(min=1, max=60)) # Keys of kinds this station already holds that the import should rewrite. Every other one it holds is skipped
        }
        request: {
            application/json: BreakKindFile
        }
        response: {
            200: {
                application/json: BreakKindImportPlan
            }
        }
    }
}

# Takes a file in. A kind this station does not hold is created; one it holds is skipped unless named
# in `replace`, because a key match is not consent. Every kind written, new or rewritten, is switched
# off, so a brief read from a file is read back here before it airs. All or nothing.
operation /breaks/kinds/import: {
    post: { # Writes a file into this station and answers with what it did. Every kind it writes arrives switched off
        name: Import break kinds
        service: BreakKindFileService.import
        query: {
            replace?: array(string(min=1, max=60)) # Keys of kinds this station already holds that the file should rewrite
        }
        request: {
            application/json: BreakKindFile
        }
        response: {
            200: {
                application/json: BreakKindImportResult
            }
        }
    }
}
