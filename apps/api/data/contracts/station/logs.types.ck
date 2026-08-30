options {
    keys: {
        area: station
    }
}

# Five values, where `PluginLogLevel` next door has four. The plugin enum is the narrower one on
# purpose — that is the vocabulary a plugin's own `PluginLogger` offers — while `api.log` is written
# by `DeadairLogger`, which tees every level the app-wide `Logger` has, `trace` included. Narrowing
# here would make a `trace` line unrepresentable in the type of the surface that reads the file it
# is in.
contract LogLevel: enum(trace, debug, info, warn, error)

contract LogSource: { # One log file this install has, whether or not anything has been written to it
    id: string(min=1, max=40) # A closed set the API owns: `api`, `liquidsoap`, `shim`. Never a path
    label: string(min=1, max=80)
    description: string(max=300) # What writes it, in a sentence, because "shim" means nothing to somebody who has not read the tree
    present: boolean # Whether the file is there at all. A station that never ran the stream has no stream logs, which is a state rather than a fault
    levels: boolean # Whether its lines carry a level, so the console knows whether to offer the filter
    bytes: int(min=0) # Retained size across every segment. Zero when absent
    lastWriteAt?: datetime # Absent when nothing has ever been written
}

contract LogSourceList: {
    sources: array(LogSource) # Every source, in a fixed order, including the ones that are not present
}

contract LogLine: { # One line, as far as it could be read back
    ts?: string(max=40) # Absent on a line this API did not write, and on one of its own that did not parse
    level?: LogLevel # Absent for the same two reasons
    text: string(max=65536) # Must match MAX_LINE_BYTES_CEILING in apps/api/src/logging/rotating.log.store.ts. Change both together
}

contract LogPage: {
    sourceId: string(min=1, max=40)
    level?: LogLevel # The minimum severity that was applied. Absent when the source carries no levels, so a filter that did nothing cannot look as though it worked
    truncated: boolean # Whether the read hit its byte budget, so the oldest line here is not the file's first
    lines: array(LogLine) # Newest first, as the plugin log page, the activity feed and the script history all send
}

contract LogQuery: {
    limit?: int(min=1, max=2000)
    level?: LogLevel # Ignored by a source whose lines carry no level
}
