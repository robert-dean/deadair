import DeadairSdk
import Foundation

/// The decisions behind sharing a break, free of UIKit so the tests can read them.
///
/// The station makes the copy (`GET /segments/{id}/audio?rendition=share`, AAC sized for a text
/// message) and this app only asks for it, so what is left here is which rows can be shared, what
/// the file is called on the way out, and what to say when it does not work. `apps/android`'s
/// `BreakShare`.
public enum BreakShare {
    /// The name a copy gets when the station did not offer one.
    public static let fallbackName = "deadair-break.m4a"

    /// Whether a row has audio to share: words were written, and the segment they became is still
    /// known. A declined or failed attempt never became audio, and a row that outlived its segment
    /// has nothing to fetch.
    public static func shareable(_ attempt: ScriptAttempt) -> Bool {
        attempt.outcome == .written && attempt.segmentId != nil
    }

    /// The file name, from the station's `content-disposition` when it sent one.
    ///
    /// Cleaned again here rather than trusted: it becomes a path under the temporary directory, so
    /// anything but letters, digits, dots, dashes and underscores goes, and a name that cleans down
    /// to nothing usable falls back. An older station that ignored the rendition and sent the
    /// original gets its extension from the type it actually answered.
    public static func fileName(contentDisposition: String?, extension ext: String) -> String {
        let offered = contentDisposition.flatMap { $0.firstMatch(of: /filename="?([^";]+)"?/).map { String($0.1) } }
        let cleaned = offered.map { $0.replacing(/[^A-Za-z0-9._-]+/, with: "-").trimmingCharacters(in: CharacterSet(charactersIn: "-.")) }
        let name = (cleaned.map { !$0.isEmpty && $0.contains(".") } ?? false) ? cleaned! : fallbackName
        let stem = name.lastIndex(of: ".").map { String(name[..<$0]) } ?? name
        return "\(stem).\(ext)"
    }

    /// What to tell somebody whose share did not work, from the station's status, or `nil` when the
    /// station was never reached.
    public static func failure(status: Int?) -> Message {
        switch status {
        case nil: .shareCouldNotReach
        case 404: .shareGone
        case 503: .shareCannotCopy
        default: .shareFailed
        }
    }

    /// The bytes, the type's extension and the offered name, out of whatever the station answered.
    /// `nil` for a 304, which is never asked for: the app sends no validator.
    public static func received(_ response: GetSegmentAudioResponse) -> (data: Data, extension: String, disposition: String?)? {
        switch response {
        case .status200AudioMp4(let data, let headers): (data, "m4a", headers.contentDisposition)
        case .status200AudioMpeg(let data, let headers): (data, "mp3", headers.contentDisposition)
        case .status200AudioWav(let data, let headers): (data, "wav", headers.contentDisposition)
        case .status200AudioOgg(let data, let headers): (data, "ogg", headers.contentDisposition)
        case .status200AudioFlac(let data, let headers): (data, "flac", headers.contentDisposition)
        case .status304: nil
        }
    }
}
