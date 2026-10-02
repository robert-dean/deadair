@testable import DeadairCore
import DeadairSdk

/// Orders and their rows, as the director tests build them.
func orderItem(
    _ id: String,
    _ state: StationItemState = .planned,
    kind: StationOrderItemKind = .track,
    segmentState: StationOrderItemSegmentState? = nil,
    playable: Bool? = nil
) -> StationOrderItem {
    StationOrderItem(
        id: id, kind: kind, state: state, title: id, artists: [],
        segmentId: kind == .segment ? "s-\(id)" : nil, segmentState: segmentState, playable: playable
    )
}

func stationOrder(name: String = "Heavy metal hits", brief: String? = nil, personaId: String? = nil, personaLabel: String? = nil, items: [StationOrderItem]? = nil) -> StationOrder {
    StationOrder(
        name: name, brief: brief, personaId: personaId, personaLabel: personaLabel, mode: .rotation, onEnd: .extend, source: "director",
        items: items ?? [orderItem("i1"), orderItem("i2")]
    )
}

func persona(_ id: String, _ label: String, kind: PersonaKind? = nil, defaultHost: Bool = false, djName: String? = nil) -> Persona {
    Persona(id: id, key: id, kind: kind, label: label, style: "warm", djName: djName, defaultHost: defaultHost, presenting: defaultHost)
}
