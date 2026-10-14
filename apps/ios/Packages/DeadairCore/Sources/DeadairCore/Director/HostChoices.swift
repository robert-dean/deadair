import DeadairSdk

/// One persona the broadcast could be handed to.
///
/// `name` is the persona's LABEL rather than its DJ name, because the label is what the station
/// resolves `personaLabel` from: a picker that showed the DJ name would disagree with the line above
/// it about the same person. The DJ name rides along as supporting text where it says something the
/// label does not. `apps/android`'s `HostChoice`.
public struct HostChoice: Equatable, Sendable {
    public let id: String
    public let name: String
    /// What they are introduced by on air, when that is not simply the label again.
    public let djName: String?
    /// The station's own host, which is who presents anything that names nobody.
    public let onAir: Bool
    /// Already presenting this broadcast, so picking them would change nothing.
    public let current: Bool
}

extension Persona {
    /// Whether this persona can present: whether its `kinds` hold `host`.
    ///
    /// A character may do several jobs, and presenting is the `host` one whatever else it does. A
    /// station from before `kinds` sends one `kind`, and there an absent kind is a host, which is what
    /// the contract says and what most stored personas left blank. Anything else, a caller, a guest or
    /// the newsreader, cannot be put on air, so offering one would be offering a refusal.
    /// `apps/android`'s `Persona.presents`.
    public var presents: Bool {
        if let kinds { return kinds.contains(.host) }
        return kind == nil || kind == .host
    }
}

/// Who this broadcast could be handed to: everybody who `presents`.
public func hostChoices(_ personas: [Persona], currentId: String?) -> [HostChoice] {
    personas
        .filter(\.presents)
        .sorted { $0.label.lowercased() < $1.label.lowercased() }
        .map { persona in
            HostChoice(
                id: persona.id,
                name: persona.label,
                djName: nonBlank(persona.djName).flatMap { $0 == persona.label ? nil : $0 },
                onAir: persona.defaultHost,
                current: persona.id == currentId
            )
        }
}

extension BroadcastUiState {
    /// Handing back to the station's host is offered only where the broadcast named somebody else.
    public var stationsOwnEnabled: Bool { order.personaId != nil }

    public var hostChoiceList: [HostChoice] { hostChoices(personas ?? [], currentId: order.personaId) }

    /// The station's own host, for the picker's first row to name.
    public var stationsOwnName: String? { personas?.stationHost?.label }
}
