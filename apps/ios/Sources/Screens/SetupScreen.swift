import SwiftUI

/// The first screen: where is the station?
struct SetupScreen: View {
    @State private var entry = StationEntry(stored: nil)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    AddressField(entry: entry)
                } header: {
                    Text("Your station")
                } footer: {
                    Text("The address your station's console loads from. One address carries the console, the API and the stream, so it is all this app needs. Listening needs no account.")
                }
            }
            .navigationTitle("deadair")
        }
    }
}
