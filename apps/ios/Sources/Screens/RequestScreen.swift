import DeadairCore
import DeadairSdk
import SwiftUI

/// Find a record and ask the station to play it. `apps/android`'s `RequestScreen`.
///
/// The search is the request route's rather than the library's: it answers only records a request
/// could get, so there is no row to draw that would be refused at the door. With nothing typed the page
/// is the listener's own requests, polled while it shows, because the station tells an app nothing when
/// one moves on. A row opens a sheet rather than sending at once: a request is one at a time and cannot
/// be taken back, and the sheet is where the name and the dedication go. A refusal is still a 201, and
/// is said as the station said it.
struct RequestScreen: View {
    @Environment(AppModel.self) private var model
    @State private var typed = ""
    @State private var results: LoadState<[RequestRow]>?
    @State private var searching = false
    @State private var attempt = 0
    @State private var mine: LoadState<[MyRequestRow]>?
    @State private var mineAttempt = 0
    @State private var chosen: RequestRow?
    @State private var form = RequestForm()
    @State private var sending = false

    var body: some View {
        let term = LibrarySearch.term(typed)
        List {
            switch results {
            case nil:
                Section {
                    Text(String(localized: "The station plays a request soon after it is asked for, between two records, if its rules allow. One at a time."))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Section(String(localized: "Your requests")) { myRequests }
            case .loading:
                ProgressView()
            case .failed(let status):
                Text(detailFailure(status, notFound: .cantReachStation).words).foregroundStyle(.red)
            case .loaded(let rows) where rows.isEmpty:
                Text(String(localized: "Nothing the station could play matches that.")).foregroundStyle(.secondary)
            case .loaded(let rows):
                ForEach(rows) { row in
                    // Plain, so a row reads as a record rather than as a link in the tint colour.
                    Button { chosen = row } label: { ResultRow(row: row) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Request “\(row.title)”")))
                }
            }
        }
        .overlay(alignment: .top) { if searching { ProgressView().padding(.top, 4) } }
        .searchable(text: $typed, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(String(localized: "Search by title or artist")))
        .autocorrectionDisabled()
        .navigationTitle(String(localized: "Request a record"))
        .navigationBarTitleDisplayMode(.inline)
        // Keyed on the term, so each new letter cancels the wait for the last one: that is the debounce.
        .task(id: SearchKey(term: term, attempt: attempt)) {
            guard let term else {
                results = nil
                return
            }
            try? await Task.sleep(for: LibrarySearch.debounce)
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            let query = SearchRequestableRecordsQuery(q: term, limit: RequestRules.searchLimit)
            if let read = await model.read({ deadair in try await deadair.requests.searchRequestableRecords(query: query).tracks.map(RequestRow.init) }) {
                results = read
            }
        }
        // A failed poll keeps the last list up rather than blanking it: the next one is fifteen seconds off.
        .task(id: mineAttempt) {
            while !Task.isCancelled {
                if let read = await model.read({ deadair in try await deadair.requests.listMyRequests() }) {
                    switch read {
                    case .loaded(let list):
                        let now = Date()
                        mine = .loaded(list.requests.map { MyRequestRow($0, now: now, calendar: .current) })
                    case .failed(let status):
                        if mine?.value == nil { mine = .failed(status: status) }
                    case .loading:
                        break
                    }
                }
                try? await Task.sleep(for: RequestRules.pollInterval)
            }
        }
        .sheet(item: $chosen) { row in
            RequestSheet(row: row, form: $form, sending: sending) { send(row) }
                .presentationDetents([.medium, .large])
                .interactiveDismissDisabled(sending)
        }
    }

    @ViewBuilder
    private var myRequests: some View {
        switch mine {
        case nil, .loading:
            ProgressView()
        case .failed(let status):
            Button(detailFailure(status, notFound: .cantReachStation).words) { mineAttempt += 1 }
        case .loaded(let rows) where rows.isEmpty:
            Text(String(localized: "You have not asked for anything yet.")).foregroundStyle(.secondary)
        case .loaded(let rows):
            ForEach(rows) { row in MyRow(row: row) }
        }
    }

    private func send(_ row: RequestRow) {
        guard !sending else { return }
        sending = true
        let body = form.body(trackId: row.id)
        Task {
            defer { sending = false }
            switch await model.read({ deadair in try await deadair.requests.createRequest(body: body) }) {
            case .loaded(let request):
                chosen = nil
                // The name is who the listener is, so it stays for the next one; the rest was for this record.
                form = RequestForm(name: form.name)
                typed = ""
                mineAttempt += 1
                model.toasts.say(RequestRules.outcome(request))
            case .failed(status: 404):
                chosen = nil
                attempt += 1
                model.toasts.say(.requestRecordGone)
            case .failed(status: let status?):
                model.toasts.say(.operatorNotice(.failed(status: status)))
            case .failed(status: nil):
                model.toasts.say(.cantReachStation)
            case .loading, nil:
                break
            }
        }
    }

    private struct SearchKey: Equatable {
        let term: String?
        let attempt: Int
    }

    private struct ResultRow: View {
        let row: RequestRow

        var body: some View {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).lineLimit(1)
                    Text([row.artist, row.detail].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "text.badge.plus").foregroundStyle(.tint)
            }
            .contentShape(Rectangle())
        }
    }

    private struct MyRow: View {
        let row: MyRequestRow

        var body: some View {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).lineLimit(1)
                    Text(row.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    if let note = row.note { Text(note.words).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                Text(Message.requestState(row.status).words)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(RequestRules.isOpen(row.status) ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
        }
    }
}

/// The name, the dedication and the message, and Send. Every field is optional.
private struct RequestSheet: View {
    let row: RequestRow
    @Binding var form: RequestForm
    let sending: Bool
    let send: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(String(localized: "Your name"), text: capped(\.name, RequestRules.nameMax))
                        .textContentType(.givenName)
                } footer: {
                    Text(String(localized: "Leave it blank to be “a listener”"))
                }
                Section {
                    TextField(String(localized: "Dedicate it to"), text: capped(\.dedicateTo, RequestRules.dedicateMax))
                }
                Section {
                    TextField(String(localized: "A message"), text: capped(\.message, RequestRules.messageMax), axis: .vertical)
                        .lineLimit(2...5)
                } footer: {
                    Text(String(localized: "The presenter may put it in their own words"))
                }
                Section {
                    Button(action: send) {
                        if sending { ProgressView().frame(maxWidth: .infinity) } else { Text(String(localized: "Send request")).frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .disabled(sending)
                }
            }
            .disabled(sending)
            .navigationTitle(String(localized: "Request “\(row.title)”"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// A field that cannot hold more than the station takes.
    private func capped(_ field: WritableKeyPath<RequestForm, String>, _ max: Int) -> Binding<String> {
        Binding(get: { form[keyPath: field] }, set: { form[keyPath: field] = String($0.prefix(max)) })
    }
}
