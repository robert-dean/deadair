import DeadairCore
import DeadairSdk
import Foundation
import SwiftUI
import UIKit

/// Fetches the station's shareable copy of a break and hands it to the share sheet, or to the Files
/// save dialog for somebody who wants to keep it.
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
    /// A copy ready to hand to the save dialog.
    var saving: SharedCopy?

    func share(_ attempt: ScriptAttempt, with model: AppModel) {
        fetch(attempt, with: model) { [weak self] in self?.ready = $0 }
    }

    func save(_ attempt: ScriptAttempt, with model: AppModel) {
        fetch(attempt, with: model) { [weak self] in self?.saving = $0 }
    }

    /// Asks the station for the copy and writes it where both sheets read it, one row at a time: a
    /// second tap while a copy is being made is ignored rather than queued.
    private func fetch(_ attempt: ScriptAttempt, with model: AppModel, then: @escaping @MainActor (SharedCopy) -> Void) {
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
            then(SharedCopy(url: url))
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

/// The Files save dialog, over a file: the person picks the folder, and the file is copied there.
///
/// The system's dialog rather than the photo library or a folder of our own, because a clip is a
/// document and not a photo, and because it asks for no permission. The share sheet already offers
/// "Save to Files"; this is the same place reached in one tap, for somebody who came to keep the clip
/// rather than to send it.
struct SaveSheet: UIViewControllerRepresentable {
    let url: URL
    let onSaved: () -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onSaved: onSaved) }

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onSaved: () -> Void

        init(onSaved: @escaping () -> Void) { self.onSaved = onSaved }

        // Cancelling is an answer, not a failure, so only a save says anything.
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onSaved()
        }
    }
}
