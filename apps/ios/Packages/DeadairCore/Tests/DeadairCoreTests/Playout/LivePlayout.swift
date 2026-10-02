@testable import DeadairCore
import DeadairSdk
import Foundation

/// The live station's own transport readings, from 2026-10-02: `GET /playout/status` on air with one
/// listener, and `GET /director/air` with the operator driving an imported playlist. Tests derive
/// the other states from these by changing a field, so every variant starts from a shape the station
/// really sends.
enum LivePlayout {
    static var status: PlayoutStatus {
        try! SdkJSON.makeDecoder().decode(PlayoutStatus.self, from: Data(statusJSON.utf8))
    }

    static var air: StationAir {
        try! SdkJSON.makeDecoder().decode(StationAir.self, from: Data(airJSON.utf8))
    }

    static let statusJSON = #"""
        {
          "mountPath": "/live.mp3",
          "mounts": [
            {
              "format": "mp3",
              "path": "/live.mp3",
              "bitrateKbps": 320
            },
            {
              "format": "aac",
              "path": "/live.aac",
              "bitrateKbps": 320
            }
          ],
          "streamUp": true,
          "onAir": true,
          "nowPlaying": {
            "item": {
              "id": "296f86a7-cd82-4128-9bf6-d9ac7d3eb804",
              "pluginId": "deadair.spotify",
              "externalId": "0s995gCthqnYJCWGvfKpNt",
              "title": "One Bourbon, One Scotch, One Beer",
              "artists": [
                "George Thorogood & The Destroyers"
              ],
              "durationMs": 506720,
              "album": "George Thorogood & the Destroyers",
              "artworkUrl": "art/a2def0b0-54c2-47f8-adc7-115c9474ea3f/cover.jpg",
              "year": 1977,
              "trackId": "da061b81-e34e-40fc-9048-14f449667c4b"
            },
            "startedAt": 1790959768121,
            "remainingMs": 422042
          },
          "upNext": [
            {
              "id": "d22e5f68-17e6-45d3-bd98-869bd24e46d9",
              "pluginId": "deadair.render",
              "externalId": "110a2b5b-3d74-4118-97dd-057f858ef863",
              "title": "Talk break: One Bourbon, One Scotch, One Beer into Shot in the Dark",
              "artists": []
            }
          ],
          "queuedCount": 1,
          "listeners": 1,
          "audience": true,
          "staleStreamConfig": [],
          "silence": {
            "audible": true,
            "cause": "airing",
            "detail": "The station is holding the mount and its programme is going out.",
            "checks": [
              {
                "code": "transportStalled",
                "state": "ok",
                "detail": "The transport loop is reconciling normally."
              },
              {
                "code": "controlDenied",
                "state": "ok",
                "detail": "The stream is accepting the app's bridge secret."
              },
              {
                "code": "streamUnreachable",
                "state": "ok",
                "detail": "The audio chain's control API is answering and Icecast has its source."
              },
              {
                "code": "configNotAdopted",
                "state": "ok",
                "detail": "Both stream containers are running the current config."
              },
              {
                "code": "stoodDown",
                "state": "ok",
                "detail": "The station is active."
              },
              {
                "code": "noProgramme",
                "state": "ok",
                "detail": "There is a running order to air."
              },
              {
                "code": "noAudience",
                "state": "ok",
                "detail": "1 listening."
              },
              {
                "code": "warmingUp",
                "state": "ok",
                "detail": "The station is not waiting on a download."
              },
              {
                "code": "waitingOnAudio",
                "state": "ok",
                "detail": "The records in front of the station are on this machine."
              },
              {
                "code": "notDriving",
                "state": "ok",
                "detail": "deadair is holding the mount."
              },
              {
                "code": "starved",
                "state": "ok",
                "detail": "The running order is producing audio."
              }
            ]
          }
        }
        """#

    static let airJSON = #"""
        {
          "active": true,
          "airMode": "audience",
          "name": "From Spotify",
          "source": "import",
          "airSource": "operator",
          "held": false,
          "remaining": 856
        }
        """#
}
