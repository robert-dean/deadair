import DeadairCore
import Foundation
import SwiftUI

/// Cover art, fetched through the app's one session and kept for as long as memory allows.
///
/// Not `AsyncImage`, which fetches through `URLSession.shared` under the system's agent: from the
/// station's side that is a second listener every time the record changes, which is the bug
/// `apps/android` found in its media session's bitmap loader.
@MainActor
final class ArtworkLoader {
    private let session: URLSession
    private let cache = NSCache<NSURL, PlatformImage>()

    init(session: URLSession) {
        self.session = session
        cache.countLimit = 32
    }

    func image(for url: URL) async -> PlatformImage? {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              let image = PlatformImage(data: data)
        else { return nil }
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}

/// A record's cover, or a quiet placeholder while there is none.
struct ArtworkView: View {
    let url: URL?
    let loader: ArtworkLoader

    @State private var image: PlatformImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(.quaternary)
            if let image {
                Image(platformImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "radio").font(.system(size: 56)).foregroundStyle(.secondary)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityHidden(true)
        .task(id: url) {
            image = nil
            if let url { image = await loader.image(for: url) }
        }
    }
}
