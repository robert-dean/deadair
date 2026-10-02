import DeadairSdk
import Foundation

/// Which segment the rating control draws pressed.
///
/// An absent rating and an explicit `neutral` both draw as nothing pressed. Every record has an
/// implicit place in the rotation whether or not anybody stated one, but a list of never-rated
/// records showing the middle pressed on every row reads as hundreds of decisions somebody made.
/// Picking neutral on purpose lands on the same nothing, which is how withdrawing an opinion stays
/// reachable. `apps/android`'s `ratingSelection`.
public func ratingSelection(_ rating: Rating?) -> Rating? {
    rating == .neutral ? nil : rating
}

/// What pressing the heart on Now playing marks the record as.
///
/// A heart has two states and a rating has three, so the heart is a way into and out of LIKED and
/// nothing else: pressed on a liked record it goes back to neutral, and pressed on anything else, a
/// record the operator had disliked included, it likes it. Disliking stays on the record's page,
/// where the three are laid out side by side and a thumb cannot reach one meaning the other.
public func toggledLike(_ current: Rating?) -> Rating {
    current == .liked ? .neutral : .liked
}

/// The operator's marks on the library, from the phone.
///
/// A rating here is the same curation mark the console makes, with the same consequence: it changes
/// how often the station plays the record. The running order is asked to read again straight after
/// a record is marked, because its rows carry the rating and the row the operator just marked is the
/// one they are looking at. `apps/android`'s `CatalogActions`.
@MainActor
public final class CatalogActions {
    private let actions: OperatorActions
    private let order: OrderRepository

    public init(actions: OperatorActions, order: OrderRepository) {
        self.actions = actions
        self.order = order
    }

    /// Whether the station took the mark.
    public func rateTrack(_ id: UUID, _ rating: Rating) async -> Bool {
        let answered = await actions.run { try await $0.catalog.rateTrack(id: id, body: RateInput(rating: rating)) } != nil
        if answered { order.retry() }
        return answered
    }

    public func rateAlbum(_ id: UUID, _ rating: Rating) async -> Bool {
        await actions.run { try await $0.catalog.rateAlbum(id: id, body: RateInput(rating: rating)) } != nil
    }

    public func rateArtist(_ id: UUID, _ rating: Rating) async -> Bool {
        await actions.run { try await $0.catalog.rateArtist(id: id, body: RateInput(rating: rating)) } != nil
    }
}
