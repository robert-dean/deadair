import DeadairSdk
import Foundation

/// A page's one fetch, as the page draws it.
public enum LoadState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    /// The station's status, or `nil` when nothing answered at all.
    case failed(status: Int?)

    public var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }
}

extension LoadState: Equatable where Value: Equatable {}

/// Run one fetch and say how it went, in the terms a page draws.
///
/// A signed-out session is reported as a 401 rather than thrown, because it is the ordinary way a
/// page reached from a link fails and the page should say so rather than show nothing. A
/// cancellation is passed through: the page that asked has gone, and nobody is there to tell.
/// `apps/android`'s `rememberDetail`, without the composition.
public func loadState<Value: Sendable>(isolation: isolated (any Actor)? = #isolation, _ fetch: () async throws -> Value) async throws -> LoadState<Value> {
    do {
        return .loaded(try await fetch())
    } catch is CancellationError {
        throw CancellationError()
    } catch is NotSignedIn {
        return .failed(status: 401)
    } catch let error as SdkError where error.status != 0 {
        return .failed(status: error.status)
    } catch {
        return .failed(status: nil)
    }
}

/// The first page of a list, and how many there are in all.
///
/// The station pages at a hundred at most, and a phone lists rather than paginates: the rare album
/// or artist with more than a hundred says how many it left out rather than offering a pager.
public struct ListPage<Item: Sendable>: Sendable {
    public let items: [Item]
    public let total: Int

    public init(items: [Item], total: Int) {
        self.items = items
        self.total = total
    }

    public var notShown: Int { max(total - items.count, 0) }

    /// The most the station will answer in one page.
    public static var largest: Int { 100 }
}

extension ListPage: Equatable where Item: Equatable {}

/// Why a detail page has nothing to show, in the words it says it in.
public func detailFailure(_ status: Int?, notFound: Message) -> Message {
    switch status {
    case nil: .cantReachStation
    case 404: notFound
    default: .operatorNotice(.failed(status: status ?? 0))
    }
}
