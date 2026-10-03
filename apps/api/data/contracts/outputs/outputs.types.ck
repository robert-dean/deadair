options {
    keys: {
        area: outputs
    }
}

contract OutputMount: { # One of the station's mounts a speaker can play
    format: enum(mp3, opus, aac, flac, hls)
    path: string(min=1, max=200) # Same-origin path, leading slash included, as `/nowplaying` gives it
}

contract OutputDevice: { # A speaker the station can play on, as an `output` plugin listed it
    pluginId: string(max=200) # The plugin that drives it, for example `deadair.cast`
    deviceId: string(max=400) # The plugin's own id for the speaker. Stable across restarts
    name: string(max=200) # What the operator calls it
    model?: string(max=200) # The make or model, where the speaker says
    address: string(max=400) # How the plugin reaches it, for recognising rather than dialling
    protocol?: string(max=50) # How it is driven, for a plugin that speaks several: `chromecast`, `upnp`, `bluos`
    mounts: array(OutputMount) # The station's mounts this speaker can play, MP3 first. Empty when it plays none of the ones switched on
    casting: boolean # Whether the station is meant to be playing on it now. `/outputs/casts` says how that is going
}

contract OutputProblem: { # A plugin that could not list its speakers
    pluginId: string(max=200)
    message: string(max=1000)
}

contract OutputDeviceList: { # Every speaker every `output` plugin can play the station on
    devices: array(OutputDevice)
    problems: array(OutputProblem) # Plugins that did not answer. Their speakers are missing from `devices` rather than the whole list failing
}

contract OutputCast: { # A speaker the station is meant to be playing on, and how it is doing
    pluginId: string(max=200)
    deviceId: string(max=400)
    deviceName: string(max=200) # What the speaker was called when the cast started
    mountPath: string(min=1, max=200) # Which mount it plays
    startedAt: datetime
    phase: enum(idle, opening, buffering, playing, stopped, unreachable) # As the speaker reports it now. `opening` and `buffering` are a stream starting, not a failure; `stopped` with the station's stream still loaded is played again on its own; `unreachable` is a speaker that did not answer, which the station waits out
    detail?: string(max=1000) # A sentence about the phase when it needs one, such as why a speaker is unreachable
}

contract OutputCastList: { # Every speaker the station is meant to be playing on
    casts: array(OutputCast)
}

contract OutputCastRequest: { # Play the station on a speaker
    pluginId: string(min=1, max=200)
    deviceId: string(min=1, max=400)
    mountPath?: string(min=1, max=200) # Which mount, from the speaker's `mounts`. Absent means its first, which is MP3 wherever the speaker takes it
}
