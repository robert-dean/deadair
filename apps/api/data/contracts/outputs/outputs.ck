options {
    keys: {
        area: outputs
    }
    services: {
        OutputsService: "#src/modules/outputs/outputs.service.js"
    }
    security: {
        # The floor: starting and stopping a speaker is an operator action, since a speaker playing
        # the station is a listener that holds it on air. Reading is lowered per operation below.
        policy: platform.manage
    }
}

operation /outputs/devices: {
    get: { # Every speaker the station can play on, from every `output` plugin, with the mounts each can take
        name: List output devices
        service: OutputsService.listDevices
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: OutputDeviceList
            }
        }
    }
}

operation /outputs/casts: {
    get: { # Every speaker the station is meant to be playing on, each asked how it is doing now
        name: List casts
        service: OutputsService.listCasts
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: OutputCastList
            }
        }
    }
    post: { # Play the station on a speaker, replacing whatever it was playing. The station keeps it playing, through a dropped stream or a restart, until it is stopped here or somebody plays something else on it
        name: Start cast
        service: OutputsService.startCast
        request: {
            application/json: OutputCastRequest
        }
        response: {
            201: {
                application/json: OutputCast
            }
        }
    }
}

operation /outputs/casts/{pluginId}/{deviceId}: {
    params: {
        pluginId: string(min=1, max=200)
        deviceId: string(min=1, max=400)
    }
    delete: { # Stop the station on a speaker. Answers 204 when it was not playing too
        name: Stop cast
        service: OutputsService.stopCast
        response: {
            204:
        }
    }
}
