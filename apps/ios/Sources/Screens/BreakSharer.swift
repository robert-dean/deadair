import DeadairCore
import DeadairSdk
import Foundation
import SwiftUI
import UIKit

/// Fetches the station's shareable copy of a break and hands it to the share sheet.
///
/// The copy is written under the temporary directory's `shared/`, which **never holds more than
/// one**: it is emptied before each share, so nothing accumulates however many breaks somebody
/// sends, and iOS clears the temporary directory on its own anyway. Emptying before rather than
/// after is deliberate: the app receiving the file may read it after the sheet closes, at a moment
/// this one cannot know. `apps/android`'s `BreakSharer`.
@MainActor
@Observable
final class BreakSharer {
    /// The row whose copy is being fetched.
    private(set) var busyId: String?
    /// A copy ready to hand to the share sheet.
    var ready: SharedCopy?

    func share(_ attempt: ScriptAttempt, with model: AppModel) {
        guard busyId == nil, let segmentId = attempt.segmentId.flatMap(UUID.init(uuidString:)) else { return }
        busyId = attempt.id
        Task {
            defer { busyId = nil }
            let answer: GetSegmentAudioResponse
            do {
                answer = try await model.session.withSession {
                    try await $0.render.getSegmentAudio(id: segmentId, query: SegmentAudioQuery(rendition: .share))
                }
            } catch let error as SdkError where error.status != 0 {
                model.toasts.say(BreakShare.failure(status: error.status))
                return
            } catch is NotSignedIn {
                model.toasts.say(.shareFailed)
                return
            } catch {
                model.toasts.say(BreakShare.failure(status: nil))
                return
            }
            guard let copy = BreakShare.received(answer), let url = Self.write(copy) else {
                model.toasts.say(.shareFailed)
                return
            }
            ready = SharedCopy(url: url)
        }
    }

    private static func write(_ copy: (data: Data, extension: String, disposition: String?)) -> URL? {
        let directory = FileManager.default.temporaryDirectory.appending(path: "shared", directoryHint: .isDirectory)
        do {
            try? FileManager.default.removeItem(at: directory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appending(path: BreakShare.fileName(contentDisposition: copy.disposition, extension: copy.extension))
            try copy.data.write(to: file)
            return file
        } catch {
            return nil
        }
    }
}

/// A file waiting for the share sheet.
struct SharedCopy: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The system's share sheet, over a file.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
