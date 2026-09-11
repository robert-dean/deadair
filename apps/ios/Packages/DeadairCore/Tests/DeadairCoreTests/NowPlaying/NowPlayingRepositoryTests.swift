@testable import DeadairCore
import DeadairSdk
import Testing

/// The poll of `/nowplaying`, as the screen and the player share it.
@MainActor
struct NowPlayingRepositoryTests {
    private func answer(_ name: String) -> NowPlaying {
        NowPlaying(station: name, onAir: false, listeners: 0, mounts: [])
    }

    @Test func pollsEveryThreeSecondsAndBacksOffToHalfAMinute() {
        #expect(NowPlayingRepository.schedule.interval(afterFailures: 0) == .seconds(3))
        #expect(NowPlayingRepository.schedule.interval(afterFailures: 1) == .seconds(6))
        #expect(NowPlayingRepository.schedule.interval(afterFailures: 5) == .seconds(30))
    }

    @Test func isLoadingWithNoStationAndAsksNothing() async {
        let asked = Locked(0)
        let repository = NowPlayingRepository(station: nil, sleep: Sleeps().sleep) { _ in
            asked.set(asked.value + 1)
            return NowPlaying(station: "S", onAir: false, listeners: 0, mounts: [])
        }

        let lease = repository.subscribe()
        try? await Task.sleep(for: .milliseconds(20))

        #expect(repository.state == .loading)
        lease.release()
    }

    @Test func asksTheStationItIsPointedAtAndForgetsTheOldOneOnAChange() async {
        let repository = NowPlayingRepository(station: station("https://one.example.com"), sleep: Sleeps().sleep) { station in
            NowPlaying(station: station.origin, onAir: false, listeners: 0, mounts: [])
        }

        let lease = repository.subscribe()
        #expect(await eventually { repository.state.latest?.value.station == "https://one.example.com" })

        repository.point(at: station("https://two.example.com"))
        #expect(repository.state == .loading)
        #expect(await eventually { repository.state.latest?.value.station == "https://two.example.com" })
        lease.release()
    }
}
