options {
    keys: {
        area: metrics
    }
    services: {
        OtlpReceiveService: "#src/modules/metrics/otlp.receive.service.js"
    }
    security: {
        # `platform.manage`: a sender writes rows into the station's own table, which is an operator's
        # decision, and it authenticates the way a script does, with an operator's API key as a Bearer
        # token in the sender's OTLP headers. The route also answers 404 until `metrics.otlpReceive`
        # is switched on, so a station that never asked for this receives nothing.
        policy: platform.manage
    }
}

# Other services' metrics, kept beside the station's own. Internal: no console calls it, so no SDK
# method is generated; the senders are OTel SDKs and collectors pointed at `<station>/api/otlp`.

operation(internal) /otlp/v1/metrics: {
    post: { # Take an OTLP/HTTP metrics export, sent as JSON
        name: Receive OTLP metrics
        service: OtlpReceiveService.receive
        request: {
            application/json: OtlpMetricsExport
        }
        response: {
            200: {
                application/json: OtlpExportResponse
            }
        }
    }
}
