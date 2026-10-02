import DeadairCore
import DeadairSdk
import SwiftUI

/// The running order: what is airing, item by item, each saying where it has got to.
///
/// The history behind the item on air starts folded behind a count, because on a phone an hour of
/// played records is an hour of scrolling in front of the four rows that have not happened yet.
/// Folded rather than dropped: which item was skipped and where is exactly what somebody opens this
/// to find. The list opens on the anchor row and follows it as the station moves. Everything it
/// decides is `RunningOrderUiState`'s and `BroadcastUiState`'s, where the tests are.
struct UpNextScreen: View {
    @Environment(AppModel.self) private var model
    @State private var historyOpen = false
    /// Edit mode: rows are for moving rather than opening, and Done is the one obvious way out. Only
    /// for the operator.
    @State private var editMode: EditMode = .inactive

    var body: some View {
        let state = model.order.state(signedIn: model.signedIn)

        Group {
            switch state {
            case .signedOut:
                SignedOutPlaceholder()
            case .loading:
                ProgressView()
            case .unreachable:
                placeholder(String(localized: "Can't reach the station. Pull down to try again."))
            case .loaded(let reading, let stale):
                Rows(reading: reading, stale: stale, historyOpen: $historyOpen)
                    .environment(\.editMode, $editMode)
            }
        }
        .navigationTitle(String(localized: "Up next"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.isOperator, case .loaded = state {
                ToolbarItem(placement: .topBarLeading) {
                    Button(editMode.isEditing ? String(localized: "Done") : String(localized: "Edit")) {
                        withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                    }
                }
            }
            // Everything the station has said, for anybody it lets read it.
            if model.signedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: PageRoute.scripts(segmentId: nil)) {
                        Label(String(localized: "What it said"), systemImage: "quote.bubble")
                    }
                }
            }
        }
        .refreshable { model.order.retry() }
        // A role taken away mid-edit ends the edit.
        .onChange(of: model.isOperator) { _, operates in
            if !operates { editMode = .inactive }
        }
        // Re-held when the account changes, so an order read under one sign-in is never shown under another.
        .task(id: model.session.stored?.email) {
            model.order.reset()
            await model.order.hold()
        }
    }

    private func placeholder(_ words: String) -> some View {
        Text(words)
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The order's rows, under who is presenting it.
private struct Rows: View {
    @Environment(AppModel.self) private var model
    @Environment(\.editMode) private var editMode
    private static let fold = "fold"
    let reading: OrderReading
    let stale: Bool
    @Binding var historyOpen: Bool
    /// The order a dragged row was left in, held until the station's answer replaces the order:
    /// without it the list would snap back for the moment the move is in flight, then jump forward.
    @State private var held: [StationOrderItem]?
    /// The row an action is in flight for, and whether any is: one operator action at a time.
    @State private var busyItemId: String?
    @State private var pickingHost = false

    var body: some View {
        let ui = RunningOrderUiState(items: reading.order.items, historyOpen: historyOpen)
        let broadcast = BroadcastUiState(order: reading.order, personas: reading.personas)
        let anchorId = ui.anchorIndex.map { ui.items[$0].id }
        let station = model.settings.settings.station
        let editing = editMode?.wrappedValue.isEditing == true
        let canEdit = model.isOperator && ui.dragBounds != nil && busyItemId == nil
        let rows = held ?? ui.shown

        ScrollViewReader { scroller in
            List {
                if stale { StaleBanner() }

                // Who is presenting, and nothing about a broadcast that has none: off air there is
                // no one, and the line would name the station's own host over an empty order.
                if !broadcast.nothingOn {
                    Section {
                        // Where the reader may change it, the name is the control, with a chevron, so the
                        // host is changed where it is read rather than two pages away. Not while rows are
                        // being moved: the one thing to do then is finish.
                        let recasts = model.isOperator && broadcast.canRecast && !editing
                        Button {
                            pickingHost = true
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(String(localized: "Host")).font(.caption).foregroundStyle(.secondary)
                                    Text(broadcast.hostName.words).font(.title2.weight(.semibold)).lineLimit(1).foregroundStyle(.primary)
                                }
                                if recasts {
                                    Image(systemName: "chevron.down").foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!recasts)
                        .accessibilityElement(children: .combine)
                        .accessibilityHint(recasts ? Text("Change the host") : Text(""))
                    }
                }

                Section {
                    // One slot above the rows: the fold while there is one, and once it is open (or there
                    // was nothing to fold) the way further back, to everything the station has played. In
                    // the same place either way, so Played is always one tap from here.
                    if let label = ui.historyLabel {
                        Button {
                            withAnimation { historyOpen = true }
                        } label: {
                            Label(label.words, systemImage: "chevron.down")
                        }
                        .id(Self.fold)
                    } else {
                        NavigationLink {
                            HistoryScreen()
                        } label: {
                            Label(String(localized: "Everything the station has played"), systemImage: "clock.arrow.circlepath")
                        }
                    }

                    if ui.items.isEmpty {
                        Text(String(localized: "The running order is empty.")).foregroundStyle(.secondary)
                    }

                    ForEach(rows, id: \.id) { item in
                        let row = OrderRow(item: item, artwork: station?.artUrl(item.artworkUrl).flatMap(URL.init(string:)), stale: stale, busy: busyItemId == item.id)
                        // Every record row leads to its page, which is also where its rating lives, and every break to what was said in it.
                        Group {
                            if item.kind == .track, let route = PageRoute.track(item.trackId) {
                                NavigationLink(value: route) { row }
                            } else if item.kind == .segment, let segmentId = item.segmentId {
                                // A break leads to its attempts: what the station said, or tried to, in that slot.
                                NavigationLink(value: PageRoute.scripts(segmentId: segmentId)) { row }
                            } else {
                                row
                            }
                        }
                        .id(item.id)
                        .listRowBackground(item.state == .airing ? Color.accentColor.opacity(0.12) : nil)
                        // Only a row the player has not been handed can be moved or dropped: an
                        // affordance that could only ever answer 422 is worse than none.
                        .moveDisabled(item.isSpent || !canEdit)
                        .contextMenu {
                            if model.isOperator, !item.isSpent, !editing, busyItemId == nil {
                                rowMenu(item, ui: ui)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            if model.isOperator, !item.isSpent, !editing, busyItemId == nil {
                                Button(String(localized: "Drop"), role: .destructive) { drop(item, ui: ui) }
                            }
                        }
                    }
                    .onMove(perform: canEdit ? { source, offset in
                        guard let from = source.first, let target = ui.dropTarget(from: from, offset: offset) else { return }
                        let landing = offset > from ? offset - 1 : offset
                        held = ui.shown.moved(from: from, to: landing)
                        act(ui.shown[from].id) { await model.orderActions.move(ui.shown[from].id, to: target) }
                    } : nil)
                }
            }
            .listStyle(.insetGrouped)
            .sheet(isPresented: $pickingHost) { HostPicker(broadcast: broadcast) }
            // The station's answer is the order now; whatever was held for the drag is done with.
            .onChange(of: reading.order.items) { _, _ in held = nil }
            // Opened on the row the order is read from, and moved to it again when it changes: the
            // item on air is the whole point of this tab and a long order buries it. Keyed on the
            // anchor's id, so a poll that changes nothing does not pull the list back from wherever
            // the reader took it.
            // While history is folded the fold sits right above the anchor, so it is what the list opens
            // on: scrolled to the anchor itself, the fold went up under the bar and the count with it.
            .task(id: anchorId) {
                if ui.historyLabel != nil {
                    scroller.scrollTo(Self.fold, anchor: .top)
                } else if let anchorId {
                    scroller.scrollTo(anchorId, anchor: .top)
                }
            }
        }
    }
}

extension Rows {
    /// The three moves and the drop, offered only where each lands somewhere: a menu item whose only
    /// effect is nothing teaches an operator that the menu does nothing. Play next moves the row in
    /// front of everything the player is not already holding, which is not necessarily the next thing
    /// heard: whatever has been handed over plays first. Also VoiceOver's way to move a row, which a
    /// drag is not.
    @ViewBuilder
    fileprivate func rowMenu(_ item: StationOrderItem, ui: RunningOrderUiState) -> some View {
        if let shownIndex = ui.shown.firstIndex(where: { $0.id == item.id }) {
            let position = ui.positionOf(shownIndex: shownIndex)
            ForEach(Move.allCases, id: \.self) { move in
                if let target = moveTarget(move, position: position, firstPlannedIndex: ui.firstPlannedIndex, size: ui.items.count) {
                    Button(Message.move(move).words) {
                        act(item.id) { await model.orderActions.move(item.id, to: target) }
                    }
                }
            }
            Button(String(localized: "Drop"), role: .destructive) { drop(item, ui: ui) }
        }
    }

    /// Drop a row, and offer to put a record back where it was. A break cannot be put back: the
    /// station only marks it removed, so another is not planted into the same slot a minute later.
    fileprivate func drop(_ item: StationOrderItem, ui: RunningOrderUiState) {
        guard let shownIndex = ui.shown.firstIndex(where: { $0.id == item.id }) else { return }
        let position = ui.positionOf(shownIndex: shownIndex)
        let actions = model.orderActions
        let toasts = model.toasts
        act(item.id) {
            guard await actions.remove(item.id) else { return false }
            if item.kind == .track, let trackId = item.trackId.flatMap(UUID.init(uuidString:)) {
                toasts.say(.dropped(item.title), action: ToastAction(label: .putItBack) {
                    await actions.restore(trackId: trackId, at: position)
                })
            }
            return true
        }
    }

    /// Take the one turn there is, and give it back when the station has answered. A refusal lets go
    /// of the held order too, so the list goes back to what the station has.
    fileprivate func act(_ itemId: String, _ action: @escaping @MainActor () async -> Bool) {
        guard busyItemId == nil else { return }
        busyItemId = itemId
        Task {
            if !(await action()) { held = nil }
            busyItemId = nil
        }
    }
}

/// One item in the order: its picture, its title and credit, and its length, or on the item that is
/// airing a moving level meter in place of the length.
private struct OrderRow: View {
    @Environment(AppModel.self) private var model
    let item: StationOrderItem
    let artwork: URL?
    let stale: Bool
    var busy = false

    var body: some View {
        HStack(spacing: 14) {
            // The picture first, whatever the row is. A break wears the picture its KIND was given,
            // and the console draws the same one against the same row.
            ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 8, placeholderSize: 20)
                .frame(width: 52, height: 52)
                .opacity(stale ? 0.4 : 1)
                .overlay {
                    if artwork == nil && item.kind == .segment {
                        Image(systemName: "mic").foregroundStyle(.secondary)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.semibold)).lineLimit(1)
                let credit = item.artists.joined(separator: ", ")
                if !credit.isEmpty {
                    Text(credit).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            let label = item.stateLabel
            if busy {
                ProgressView()
            } else if item.state == .airing {
                OnAirMeter(moving: !stale)
                    .accessibilityLabel(Text(label?.words ?? ""))
            } else if let label {
                // A row that has been handed over, played or skipped says so where the length was:
                // what happened to it is the news, and its length no longer matters.
                Text(label.words).font(.caption).foregroundStyle(.secondary)
            } else if let duration = item.durationMs {
                Text(clockOf(duration)).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .opacity(item.opacity)
        .accessibilityElement(children: .combine)
    }
}

/// The on-air mark: three bars rising and falling in a disc of the app's colour. It stands still
/// while the reading is stale, since a meter moving over a record that may have ended would be a
/// confident lie, and while Reduce Motion is on.
struct OnAirMeter: View {
    let moving: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Where the bars stand when the meter is still.
    private static let resting: [Double] = [0.55, 0.9, 0.7]
    /// How long each bar takes to rise, never in step with the others.
    private static let tempos: [Double] = [0.42, 0.56, 0.48]

    var body: some View {
        TimelineView(.animation(paused: !moving || reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    let share = moving && !reduceMotion ? 0.3 + 0.7 * (0.5 + 0.5 * sin(t * .pi / Self.tempos[index] + Double(index))) : Self.resting[index]
                    Capsule().frame(width: 3, height: 15 * share)
                }
            }
            .frame(height: 15, alignment: .bottom)
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(Circle().fill(Color.accentColor))
        }
    }
}

/// Said where a signed-in screen would be, with the way to sign in beside it.
struct SignedOutPlaceholder: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 16) {
            Text(String(localized: "The station keeps this for signed-in listeners. Listening itself needs no account."))
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(String(localized: "Sign in")) { model.tab = .settings }
                .buttonStyle(.bordered)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
