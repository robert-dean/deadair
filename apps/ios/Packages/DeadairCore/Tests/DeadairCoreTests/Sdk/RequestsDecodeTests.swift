import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes what the request routes actually answer. `apps/android`'s
/// `RequestsDecodeTest`.
///
/// The fixtures are the shapes `toListenerRequest` and the request search produce: optional fields
/// ABSENT rather than null, a refusal as an ordinary request with `declined` and a reason, and a
/// search row with no album or year.
struct RequestsDecodeTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try SdkJSON.makeDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func decodesSearchResultsWithAndWithoutTheCatalogsDetails() throws {
        let list = try decode(RequestableTrackList.self, #"""
            {
              "tracks": [
                { "trackId": "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b", "title": "Blue Monday", "artist": "New Order", "album": "Power, Corruption & Lies", "year": 1983 },
                { "trackId": "1a2b3c4d-0000-4000-8000-000000000003", "title": "An Unknown Record", "artist": "Earth, Wind & Fire" }
              ]
            }
            """#)
        #expect(list.tracks[0].trackId == UUID(uuidString: "5B0E8A52-3C1F-4D2A-9E7B-0F6C1D2E3A4B"))
        #expect(list.tracks[0].year == 1983)
        #expect(list.tracks[1].album == nil)
        #expect(list.tracks[1].year == nil)
    }

    @Test func decodesARefusalWhichIsARequestLikeAnyOther() throws {
        let request = try decode(ListenerRequest.self, #"""
            {
              "id": "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b",
              "status": "declined",
              "title": "Blue Monday",
              "artist": "New Order",
              "requesterName": "a listener",
              "source": "app",
              "createdAt": "2026-10-03T20:00:00.000Z",
              "reason": "You already have a request in: Temptation. One at a time."
            }
            """#)
        #expect(request.status == .declined)
        #expect(request.source == .app)
        #expect(request.reason == "You already have a request in: Temptation. One at a time.")
        #expect(request.airedAt == nil)
        #expect(request.dedicateTo == nil)
    }

    @Test func decodesMyRequestsAiredAndDedicated() throws {
        let list = try decode(ListenerRequestList.self, #"""
            {
              "requests": [
                {
                  "id": "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b",
                  "status": "aired",
                  "title": "Blue Monday",
                  "artist": "New Order",
                  "requesterName": "Sam",
                  "source": "app",
                  "createdAt": "2026-10-03T20:00:00.000Z",
                  "airedAt": "2026-10-03T20:09:31.000Z",
                  "dedicateTo": "Alex",
                  "message": "Happy birthday"
                }
              ]
            }
            """#)
        let request = try #require(list.requests.first)
        #expect(request.status == .aired)
        #expect(request.airedAt == ISO8601DateFormatter().date(from: "2026-10-03T20:09:31Z"))
        #expect(request.dedicateTo == "Alex")
        #expect(request.message == "Happy birthday")
    }
}
