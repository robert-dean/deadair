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
    @State private var cover = CoverPaletteReader()
    @Environment(\.colorScheme) private var colorScheme
    /// Edit mode: rows are for moving rather than opening, and Done is the one obvious way out. Only
    /// for the operator.
    @State private var editMode: EditMode = .inactive
    @State private var pickingHost = false

    var body: some View {
        let state = model.order.state(signedIn: model.signedIn)
        let broadcast: BroadcastUiState? =
            if case .loaded(let reading, _) = state { BroadcastUiState(order: reading.order, personas: reading.personas) } else { nil }

        // Who is presenting, and nothing about a broadcast that has none: off air there is no one, and
        // the line would name the station's own host over an empty order.
        let hostName = broadcast.flatMap { $0.nothingOn ? nil : $0.hostName.words }

        VStack(spacing: 0) {
            UpNextHeader(
                mesh: cover.palette?.mesh ?? [],
                hostName: hostName,
                // Their picture from the public reading, and only while it names the same presenter
                // the order does: a recast the poll has not seen yet keeps the bare name.
                hostPortrait: hostPortraitUrl(station: model.settings.settings.station, reading: model.nowPlaying.state.latest?.value, naming: hostName)
                    .flatMap(URL.init(string:)),
                loader: model.artwork,
                // Not while rows are being moved: the one thing to do then is finish.
                onHost: model.isOperator && broadcast?.canRecast == true && !editMode.isEditing ? { pickingHost = true } : nil
            ) {
                actions
            }

            Group {
                switch state {
                case .signedOut:
                    SignedOutPlaceholder(what: String(localized: "Up next"))
                case .loading:
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                case .unreachable:
                    ErrorPlaceholder(retry: { model.order.retry() })
                case .loaded(let reading, let stale):
                    if reading.order.items.isEmpty {
                        EmptyPlaceholder(what: String(localized: "The running order is empty."))
                    } else {
                        Rows(reading: reading, stale: stale, historyOpen: $historyOpen)
                            .environment(\.editMode, $editMode)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        // No title: the tab bar already says where this is, and the header is the top of the page.
        .toolbar(.hidden, for: .navigationBar)
        // The on-air cover's colours, as on Now playing: its accent on the on-air row and the
        // controls, its mesh behind the header.
        .tint(cover.palette?.accent.map { Color(rgb: $0.accent) })
        .environment(\.onAccent, cover.palette?.accent.map { Color(rgb: $0.onAccent) })
        .sheet(isPresented: $pickingHost) {
            if let broadcast { HostPicker(broadcast: broadcast) }
        }
        // The public reading, for the cover the colours come from: opened on this tab, nothing else
        // would be asking for it.
        .task { await model.nowPlaying.hold() }
        .task(id: "\(onAirArtwork?.absoluteString ?? "")|\(colorScheme == .dark)") {
            await cover.read(onAirArtwork, darkPage: colorScheme == .dark, loader: model.artwork)
        }
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

    /// The header's actions: Done while rows are being moved; otherwise Request for anybody signed in,
    /// beside Manage for the operator, where every station-wide control is, and beside the one read a
    /// signed-in listener has.
    @ViewBuilder
    private var actions: some View {
        if editMode.isEditing {
            Button(String(localized: "Done")) { withAnimation { editMode = .inactive } }
                .font(.body.weight(.semibold))
                .padding(.horizontal, 12)
        } else if model.isOperator {
            HStack(spacing: 4) {
                requestLink
                manageLink
            }
        } else if model.signedIn {
            HStack(spacing: 0) {
                requestLink
                NavigationLink(value: PageRoute.scripts(segmentId: nil)) {
                    Image(systemName: "quote.bubble").font(.title3).frame(width: 48, height: 48)
                }
                .accessibilityLabel(Text("What it said"))
            }
        }
    }

    /// Request is anybody's who is signed in, the operator included: a request is asked of the station
    /// and may be said on air, which is not what the operator's own Play next does.
    private var requestLink: some View {
        NavigationLink(value: PageRoute.request) {
            Image(systemName: "text.badge.plus").font(.title3).frame(width: 48, height: 48)
        }
        .accessibilityLabel(Text(String(localized: "Request a record")))
    }

    private var manageLink: some View {
        NavigationLink(value: PageRoute.manage) {
            Label(String(localized: "Manage"), systemImage: "slider.horizontal.3")
                .font(.subheadline.weight(.semibold))
                .padding(.leading, 12)
                .padding(.trailing, 16)
                .padding(.vertical, 10)
                .background(Capsule().fill(.tint.opacity(0.18)))
        }
        .buttonStyle(.plain)
    }

    /// The cover on air, through the same public reading Now playing draws.
    private var onAirArtwork: URL? {
        artworkURL(station: model.settings.settings.station, reading: model.nowPlaying.state.latest?.value)
    }
}

/// The order's rows, under who is presenting it.
private struct Rows: View {
    @Environment(AppModel.self) private var model
    @Environment(\.editMode) private var editMode
    let reading: OrderReading
    let stale: Bool
    @Binding var historyOpen: Bool
    /// The order a dragged row was left in, held until the station's answer replaces the order:
    /// without it the list would snap back for the moment the move is in flight, then jump forward.
    @State private var held: [StationOrderItem]?
    /// The row an action is in flight for, and whether any is: one operator action at a time.
    @State private var busyItemId: String?

    var body: some View {
        let ui = RunningOrderUiState(items: reading.order.items, historyOpen: historyOpen)
        let anchorId = ui.anchorIndex.map { ui.items[$0].id }
        let station = model.settings.settings.station
        let editing = editMode?.wrappedValue.isEditing == true
        let canEdit = model.isOperator && ui.dragBounds != nil && busyItemId == nil
        let rows = held ?? ui.shown

        VStack(spacing: 0) {
            if stale {
                StaleBanner(readAt: nil)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }

            // One slot above the list: the fold while there is one, and once it is open (or there was
            // nothing to fold) the way further back, to everything the station has played. In the same
            // place either way and outside the list, so History is always one tap from here and never
            // moves the rows.
            Group {
                if let label = ui.historyLabel {
                    Button {
                        withAnimation { historyOpen = true }
                    } label: {
                        Label(label.words, systemImage: "chevron.down")
                    }
                } else {
                    NavigationLink(value: PageRoute.history) {
                        Label(String(localized: "Everything the station has played"), systemImage: "clock.arrow.circlepath")
                    }
                }
            }
            .font(.subheadline.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 40)
            .padding(.horizontal, 8)

            if editing {
                Text(String(localized: "Drag a record by its handle to move it."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
            }

            ScrollViewReader { scroller in
                List {
                    ForEach(rows, id: \.id) { item in
                        let movable = canEdit && !item.isSpent
                        OrderRow(
                            item: item,
                            artwork: station?.artUrl(item.artworkUrl).flatMap(URL.init(string:)),
                            stale: stale,
                            menu: model.isOperator && !item.isSpent && !editing ? { menu(item, ui: ui) } : nil,
                            busy: busyItemId == item.id
                        )
                        // Every record row leads to its page, which is also where its rating lives,
                        // and every break to what was said in it. Behind the row rather than around
                        // it, so the row carries no chevron and its menu button is its own.
                        .background {
                            if !editing {
                                if item.kind == .track, let route = PageRoute.track(item.trackId) {
                                    NavigationLink(value: route) { EmptyView() }.opacity(0)
                                } else if item.kind == .segment, let segmentId = item.segmentId {
                                    NavigationLink(value: PageRoute.scripts(segmentId: segmentId)) { EmptyView() }.opacity(0)
                                }
                            }
                        }
                        .id(item.id)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                        // The row on air sits on a card of its own, so it is the row the eye lands on;
                        // in edit mode the rows that can be picked up sit on a fainter one.
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(item.state == .airing ? AnyShapeStyle(Color(uiColor: .secondarySystemBackground)) : editing && movable ? AnyShapeStyle(.quaternary.opacity(0.5)) : AnyShapeStyle(.clear))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                        )
                        // Only a row the player has not been handed can be moved: an affordance that
                        // could only ever answer 422 is worse than none.
                        .moveDisabled(!movable)
                    }
                    .onMove(perform: canEdit ? { source, offset in
                        guard let from = source.first, let target = ui.dropTarget(from: from, offset: offset) else { return }
                        let landing = offset > from ? offset - 1 : offset
                        held = ui.shown.moved(from: from, to: landing)
                        act(ui.shown[from].id) { await model.orderActions.move(ui.shown[from].id, to: target) }
                    } : nil)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { model.order.retry() }
                // The station's answer is the order now; whatever was held for the drag is done with.
                .onChange(of: reading.order.items) { _, _ in held = nil }
                // Nothing left to move ends the mode rather than leaving a Done over rows that do nothing.
                .onChange(of: ui.dragBounds == nil) { _, none in
                    if none { editMode?.wrappedValue = .inactive }
                }
                // Opened on the row the order is read from, and moved to it again when it changes: the
                // item on air is the whole point of this tab and a long order buries it. Keyed on the
                // anchor's id, so a poll that changes nothing does not pull the list back from wherever
                // the reader took it.
                .task(id: "\(anchorId ?? "")|\(historyOpen)") {
                    if let anchorId { scroller.scrollTo(anchorId, anchor: .top) }
                }
            }
        }
    }
}

extension Rows {
    /// The three moves, the way into moving rows by hand, and the drop, behind one button on the row.
    /// Each move is offered only where it lands somewhere: a menu item whose only effect is nothing
    /// teaches an operator that the menu does nothing. Play next moves the row in front of everything
    /// the player is not already holding, which is not necessarily the next thing heard: whatever has
    /// been handed over plays first. Also VoiceOver's way to move a row, which a drag is not.
    @ViewBuilder
    fileprivate func menu(_ item: StationOrderItem, ui: RunningOrderUiState) -> some View {
        if let shownIndex = ui.shown.firstIndex(where: { $0.id == item.id }) {
            let position = ui.positionOf(shownIndex: shownIndex)
            ForEach(Move.allCases, id: \.self) { move in
                if let target = moveTarget(move, position: position, firstPlannedIndex: ui.firstPlannedIndex, size: ui.items.count) {
                    Button(Message.move(move).words) {
                        act(item.id) { await model.orderActions.move(item.id, to: target) }
                    }
                }
            }
            if ui.dragBounds != nil {
                Button(String(localized: "Move rows")) { withAnimation { editMode?.wrappedValue = .active } }
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
/// airing a moving level meter in the station's colour in place of the length; and for the operator,
/// a button holding what can be done to it.
private struct OrderRow<Menu: View>: View {
    @Environment(AppModel.self) private var model
    let item: StationOrderItem
    let artwork: URL?
    let stale: Bool
    var menu: (() -> Menu)?
    var busy = false

    var body: some View {
        HStack(spacing: 14) {
            // The picture first, whatever the row is. A break wears the picture its KIND was given,
            // and the console draws the same one against the same row.
            ArtworkView(
                url: artwork, loader: model.artwork, cornerRadius: 10, placeholderSize: 22,
                placeholder: item.kind == .segment ? "mic" : "radio", dimmed: stale
            )
            .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.callout.weight(.semibold)).lineLimit(1)
                let credit = item.artists.joined(separator: ", ")
                if !credit.isEmpty {
                    Text(credit).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            let label = item.stateLabel
            if item.state == .airing {
                OnAirMeter(moving: !stale)
                    .accessibilityLabel(Text(label?.words ?? ""))
            } else if let label {
                // A row that has been handed over, played or skipped says so where the length was:
                // what happened to it is the news, and its length no longer matters.
                Text(label.words).font(.caption).foregroundStyle(.secondary)
            } else if let duration = item.durationMs {
                Text(clockOf(duration)).font(.subheadline.weight(.medium).monospacedDigit()).foregroundStyle(.secondary)
            }
            if busy {
                ProgressView().frame(width: 32, height: 44)
            } else if let menu {
                SwiftUI.Menu(content: menu) {
                    Image(systemName: "ellipsis")
                        .rotationEffect(.degrees(90))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .tint(.secondary)
                .accessibilityLabel(Text("Actions for \(item.title)"))
            }
        }
        .opacity(item.opacity)
        .accessibilityElement(children: .contain)
    }
}

extension OrderRow where Menu == EmptyView {
    init(item: StationOrderItem, artwork: URL?, stale: Bool, busy: Bool = false) {
        self.init(item: item, artwork: artwork, stale: stale, menu: nil, busy: busy)
    }
}

/// The on-air mark: three bars rising and falling in a disc of the app's colour. It stands still
/// while the reading is stale, since a meter moving over a record that may have ended would be a
/// confident lie, and while Reduce Motion is on.
struct OnAirMeter: View {
    let moving: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.onAccent) private var onAccent
    @Environment(\.colorScheme) private var colorScheme

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
            .foregroundStyle(onAccent ?? (colorScheme == .dark ? Color(white: 0.06) : .white))
            .frame(width: 32, height: 32)
            .background(Circle().fill(.tint))
        }
    }
}

extension EnvironmentValues {
    /// What reads on the page's accent: black on a light cover colour, white on a dark one. Unset, the
    /// app's own green decides.
    @Entry var onAccent: Color?
}

/// The head of Up next: who is presenting, and the tab's one action beside it, over the on-air
/// cover's colours. No title: the tab bar already says where this is. The mesh stands still, since
/// colour moving at the top of a list pulls the eye off the rows, and its foot fades into the page so
/// the list starts on plain ground. `apps/android`'s `UpNextHeader`.
private struct UpNextHeader<Actions: View>: View {
    let mesh: [RGB]
    let hostName: String?
    /// The presenter's picture, drawn beside the name when there is one.
    let hostPortrait: URL?
    let loader: ArtworkLoader
    /// Where the reader may change the host, the name is the control, with a picker's chevron.
    let onHost: (() -> Void)?
    @ViewBuilder let actions: Actions

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if let hostName {
                    let host = HStack(spacing: 10) {
                        if let hostPortrait { HostPortrait(url: hostPortrait, loader: loader, size: 40) }
                        VStack(alignment: .leading, spacing: 0) {
                            Text(String(localized: "Host")).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                            HStack(spacing: 2) {
                                Text(hostName).font(.title2.weight(.semibold)).lineLimit(1)
                                if onHost != nil { Image(systemName: "chevron.down").font(.body.weight(.semibold)) }
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .contentShape(RoundedRectangle(cornerRadius: 12))
                    if let onHost {
                        Button(action: onHost) { host }
                            .buttonStyle(.plain)
                            .accessibilityHint(Text("Change the host"))
                    } else {
                        host.accessibilityElement(children: .combine)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
        .padding(.leading, 8)
        .padding(.trailing, 8)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(minHeight: 64)
        .background {
            ZStack {
                if !mesh.isEmpty {
                    CoverMesh(colors: mesh, moving: false).opacity(0.7)
                }
                LinearGradient(
                    stops: [.init(color: .clear, location: 0.35), .init(color: Color(uiColor: .systemBackground), location: 1)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            // The blur reaches past the blobs; kept to the header, as Android's is.
            .clipped()
            .ignoresSafeArea(edges: .top)
        }
    }
}
