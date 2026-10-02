import DeadairCore
import DeadairSdk
import SwiftUI

/// The library search: a record by its title, into the running order next or at the end.
///
/// The last answer stays up while the next is fetched, rather than blanking to a spinner on every
/// letter, and the box is never written back from an answer. An add keeps the operator here, because
/// adding three records is one errand, and this screen says "Added" itself: the running order
/// underneath cannot be seen from here. `apps/android`'s `AddRecordScreen`.
struct AddRecordScreen: View {
    @Environment(AppModel.self) private var model
    @State private var typed = ""
    @State private var results: LoadState<ListPage<AddRow>>?
    @State private var searching = false
    @State private var busyId: UUID?

    var body: some View {
        let term = LibrarySearch.term(typed)
        List {
            switch results {
            case nil:
                Text(String(localized: "Type two letters or more of a record's title.")).foregroundStyle(.secondary)
            case .loading:
                ProgressView()
            case .failed(let status):
                Text(detailFailure(status, notFound: .cantReachStation).words).foregroundStyle(.red)
            case .loaded(let page) where page.items.isEmpty:
                Text(String(localized: "Nothing in the library matches that.")).foregroundStyle(.secondary)
            case .loaded(let page):
                ForEach(page.items, id: \.id) { row in
                    ResultRow(row: row, busy: busyId == row.id, disabled: busyId != nil) { index in add(row, at: index) }
                }
                if page.notShown > 0 {
                    Text(Message.searchNotShown(page.notShown).words).font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .overlay(alignment: .top) { if searching { ProgressView().padding(.top, 4) } }
        .searchable(text: $typed, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(String(localized: "Search by title")))
        .autocorrectionDisabled()
        .navigationTitle(String(localized: "Add a record"))
        .navigationBarTitleDisplayMode(.inline)
        // Read here so Play next knows the first position the station will take.
        .task { await model.order.hold() }
        // Keyed on the term, so each new letter cancels the wait for the last one: that is the debounce.
        .task(id: term) {
            guard let term else {
                results = nil
                return
            }
            try? await Task.sleep(for: LibrarySearch.debounce)
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            let query = TrackQueryInput(page: 0, pageSize: ListPage<AddRow>.largest, sort: .asc, search: term, sortBy: .title)
            if let read = await model.read({ deadair in
                let page = try await deadair.catalog.listTracks(query: query)
                return ListPage(items: page.data.map(AddRow.init), total: page.meta.total)
            }) {
                results = read
            }
        }
    }

    private func add(_ row: AddRow, at index: Int?) {
        guard busyId == nil else { return }
        busyId = row.id
        Task {
            if await model.orderActions.addTrack(row.id, at: index) { model.toasts.say(.added(row.title)) }
            busyId = nil
        }
    }

    private struct ResultRow: View {
        @Environment(AppModel.self) private var model
        let row: AddRow
        let busy: Bool
        let disabled: Bool
        let add: (Int?) -> Void

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).lineLimit(1)
                    let line = [nonBlank(row.credit), row.durationMs.map(clockOf)].compactMap { $0 }.joined(separator: " · ")
                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                if !row.addable {
                    Text(String(localized: "Not on this station yet, so it cannot be added")).font(.caption).foregroundStyle(.secondary)
                } else if busy {
                    ProgressView()
                } else {
                    HStack {
                        Button(String(localized: "Play next")) { add(playNextFor(model)) }
                        Button(String(localized: "Add to the end")) { add(nil) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(disabled)
                }
            }
        }

        private func playNextFor(_ model: AppModel) -> Int? {
            if case .loaded(let reading, _) = model.order.state(signedIn: model.signedIn) { return playNextIndex(reading.order.items) }
            return nil
        }
    }
}

/// Play next and Add to the end on a record's page, for the operator. Play next waits for the running
/// order to be read, because it is a position in it; a record whose audio is not here says so beside
/// the buttons rather than offering a press the station would refuse.
struct AddToOrderSection: View {
    @Environment(AppModel.self) private var model
    let trackId: UUID
    let title: String
    let hasAudio: Bool
    @Binding var busy: Bool

    var body: some View {
        let reading: OrderReading? = if case .loaded(let reading, _) = model.order.state(signedIn: model.signedIn) { reading } else { nil }
        Section {
            HStack {
                Button(String(localized: "Play next")) { add(reading.flatMap { playNextIndex($0.order.items) }) }
                    .disabled(reading == nil)
                Button(String(localized: "Add to the end")) { add(nil) }
            }
            .buttonStyle(.bordered)
            .disabled(!hasAudio || busy)
        } footer: {
            if !hasAudio { Text(String(localized: "Not on this station yet, so it cannot be added")) }
        }
        // Held only for the operator, so a listener's record page does not start the order poll.
        .task { await model.order.hold() }
    }

    private func add(_ index: Int?) {
        guard !busy else { return }
        busy = true
        Task {
            if await model.orderActions.addTrack(trackId, at: index) { model.toasts.say(.added(title)) }
            busy = false
        }
    }
}
