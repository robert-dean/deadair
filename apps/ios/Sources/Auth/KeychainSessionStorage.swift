import DeadairCore
import Foundation
import Security

/// The session, in the Keychain.
///
/// The Keychain rather than a file beside the settings, which is the desktop app's choice and not
/// Android's. On Android an app-private file behind `allowBackup="false"` is as good as the
/// deprecated keystore wrapper; here the Keychain is the platform's own answer and costs three
/// calls. One item, holding the whole `StoredSession` as JSON with its origin inside it:
/// `SessionManager` clears a session that belongs to another station, so there is never a second.
///
/// `AfterFirstUnlockThisDeviceOnly`: readable in the background once the phone has been unlocked
/// since boot, which is when a lock-screen press can reach the app, and never in a backup or on a
/// new phone, which is what `PRIVACY.md` says. A locked or unreadable Keychain reads as nobody
/// signed in, as an unreadable item from an older build does.
@MainActor
final class KeychainSessionStorage: SessionStorage {
    private let service = "deadair"
    private let account = "session"

    func load() -> StoredSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    func save(_ session: StoredSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(baseQuery.merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
