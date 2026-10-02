import DeadairSdk

/// Who is presenting, in the three states the answer actually has.
public enum HostLine: Equatable, Sendable {
    /// The broadcast named somebody, and the station resolved their name as it read the order.
    case named(String)
    /// The broadcast named nobody, so whoever the station has on air presents it. `nil` until the
    /// persona list arrives.
    case stationsOwn(String?)
    /// Nobody at all: the broadcast named nobody and the station has no persona on air either.
    case nobody
}

/// What the broadcast at the top of the Up next tab says about itself.
///
/// Off air is an ordinary state rather than an error, and the station says so by answering with an
/// order that has an empty name and no items. So an empty name is no title, and the host cannot be
/// changed, but the header is still drawn. `apps/android`'s `BroadcastUiState`.
public struct BroadcastUiState: Equatable, Sendable {
    public let order: StationOrder
    public let personas: [Persona]?

    public init(order: StationOrder, personas: [Persona]?) {
        self.order = order
        self.personas = personas
    }

    /// There is no broadcast at all.
    ///
    /// The station answers off air with a synthesised order rather than a 404, and what marks it is
    /// an empty NAME as well as an empty list. A real broadcast that has simply run out of records
    /// still has a name, a brief and a host, and is still a thing an operator can recast or replan;
    /// keying this on the items alone hid those controls exactly when they were wanted.
    public var nothingOn: Bool { nonBlank(order.name) == nil && order.items.isEmpty }

    public var title: String? { nonBlank(order.name) }

    /// What the operator asked for, in their own words. It steers every refill, so it is worth showing.
    public var brief: String? { nonBlank(order.brief) }

    public var host: HostLine {
        // The name they go by on air where the station has one for them, as What's on names them;
        // the persona's label is the name of the character sheet, not of the presenter.
        if let named = order.personaId.flatMap({ id in personas?.first { $0.id == id }?.onAirName }) ?? nonBlank(order.personaLabel) {
            return .named(named)
        }
        // Before the persona list lands there is no name to give, which is a different thing from
        // there being nobody: saying "nobody" for that moment would be a lie that corrects itself,
        // and the correction is the part a reader notices.
        guard let known = personas else { return .stationsOwn(nil) }
        return known.stationHost.map { .stationsOwn($0.onAirName) } ?? .nobody
    }

    /// Who is presenting, as the header names them: the name alone, since the header says what it is.
    public var hostName: Message {
        switch host {
        case .named(let name): .text(name)
        case .stationsOwn(let name?): .text(name)
        case .stationsOwn(nil): .stationsHost
        case .nobody: .noHost
        }
    }

    /// There has to be a broadcast to recast. Off air the station is not presenting anything.
    public var canRecast: Bool { !nothingOn }
}

extension Persona {
    /// What a persona is called on air: their DJ name where they have one, else their label.
    public var onAirName: String { nonBlank(djName) ?? label }
}

extension Array where Element == Persona {
    /// The persona the station presents with when a broadcast names nobody.
    public var stationHost: Persona? { first { $0.defaultHost } }
}
