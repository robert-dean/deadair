using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// Sessions in the macOS Keychain, one generic-password item per station.
/// </summary>
/// <remarks>
/// <para>
/// The service is a fixed string and the ACCOUNT is the station's origin, so an operator with two
/// stations has two items and signing out of one leaves the other alone.
/// </para>
/// <para>
/// Written against the C API with P/Invoke rather than through a binding package, for the same reason
/// the player is: it keeps the app on one plain target framework and needs no workload. The surface
/// is four functions and it is all in this file.
/// </para>
/// </remarks>
public sealed partial class MacKeychainSecretStore : ISecretStore
{
    private const string Service = "deadair";

    private const int Success = 0;
    private const int NotFound = -25300;

    public MacKeychainSecretStore()
    {
        if (!OperatingSystem.IsMacOS())
        {
            throw new PlatformNotSupportedException("The Keychain store runs on macOS only.");
        }
    }

    public Task<StoredSession?> ReadAsync(string origin, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(origin);

        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(origin);

        var status = SecKeychainFindGenericPassword(
            nint.Zero,
            (uint)service.Length, service,
            (uint)account.Length, account,
            out var length, out var data, nint.Zero);

        if (status == NotFound || data == nint.Zero)
        {
            return Task.FromResult<StoredSession?>(null);
        }

        try
        {
            if (status != Success)
            {
                // A locked keychain, a denied prompt. Treated as "nobody is signed in", which asks
                // for a password rather than refusing to start.
                return Task.FromResult<StoredSession?>(null);
            }

            var json = Marshal.PtrToStringUTF8(data, (int)length);
            return Task.FromResult(JsonSerializer.Deserialize<StoredSession>(json));
        }
        catch (JsonException)
        {
            // An item from an older shape. Signing in again is the remedy and it is a small one.
            return Task.FromResult<StoredSession?>(null);
        }
        finally
        {
            _ = SecKeychainItemFreeContent(nint.Zero, data);
        }
    }

    public async Task WriteAsync(StoredSession session, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);

        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(session.Origin);
        var secret = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(session));

        // There is no upsert: adding over an existing item fails, so an existing one is found and
        // modified and only a missing one is added.
        var found = SecKeychainFindGenericPassword(
            nint.Zero,
            (uint)service.Length, service,
            (uint)account.Length, account,
            out _, out var data, out var item);

        if (found == Success && item != nint.Zero)
        {
            _ = SecKeychainItemFreeContent(nint.Zero, data);
            var modified = SecKeychainItemModifyAttributesAndData(item, nint.Zero, (uint)secret.Length, secret);
            CFRelease(item);

            if (modified == Success)
            {
                return;
            }

            // The item is there and could not be written. Removing it and adding it again is the only
            // remaining move, and leaving a stale session behind would be worse than having none.
            await DeleteAsync(session.Origin, cancellationToken).ConfigureAwait(false);
        }

        var added = SecKeychainAddGenericPassword(
            nint.Zero,
            (uint)service.Length, service,
            (uint)account.Length, account,
            (uint)secret.Length, secret,
            nint.Zero);

        if (added != Success)
        {
            // A locked keychain, or a denied prompt. The session stays live in memory for this run and
            // is simply not remembered, which is a sign-in next launch rather than a broken app.
            throw new SecretStoreException($"The Keychain refused to store the session (OSStatus {added}).");
        }
    }

    public Task DeleteAsync(string origin, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(origin);

        var service = Encoding.UTF8.GetBytes(Service);
        var account = Encoding.UTF8.GetBytes(origin);

        var found = SecKeychainFindGenericPassword(
            nint.Zero,
            (uint)service.Length, service,
            (uint)account.Length, account,
            out _, out var data, out var item);

        if (found == Success && item != nint.Zero)
        {
            _ = SecKeychainItemFreeContent(nint.Zero, data);
            _ = SecKeychainItemDelete(item);
            CFRelease(item);
        }

        return Task.CompletedTask;
    }

    /// <remarks>
    /// The `SecKeychain*` family is the older of the two Keychain APIs and is marked deprecated,
    /// while remaining present and working. It is used here because the newer `SecItem*` family takes
    /// a `CFDictionary`, and building one across P/Invoke is considerably more native code than this
    /// whole file. Worth revisiting if a macOS release ever removes it rather than merely deprecating
    /// it.
    /// </remarks>
    private const string Security = "/System/Library/Frameworks/Security.framework/Security";
    private const string CoreFoundation = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

    [LibraryImport(Security)]
    private static partial int SecKeychainFindGenericPassword(
        nint keychain,
        uint serviceNameLength, byte[] serviceName,
        uint accountNameLength, byte[] accountName,
        out uint passwordLength, out nint passwordData,
        nint itemRef);

    [LibraryImport(Security)]
    private static partial int SecKeychainFindGenericPassword(
        nint keychain,
        uint serviceNameLength, byte[] serviceName,
        uint accountNameLength, byte[] accountName,
        out uint passwordLength, out nint passwordData,
        out nint itemRef);

    [LibraryImport(Security)]
    private static partial int SecKeychainAddGenericPassword(
        nint keychain,
        uint serviceNameLength, byte[] serviceName,
        uint accountNameLength, byte[] accountName,
        uint passwordLength, byte[] passwordData,
        nint itemRef);

    [LibraryImport(Security)]
    private static partial int SecKeychainItemModifyAttributesAndData(
        nint itemRef, nint attrList, uint length, byte[] data);

    [LibraryImport(Security)]
    private static partial int SecKeychainItemDelete(nint itemRef);

    [LibraryImport(Security)]
    private static partial int SecKeychainItemFreeContent(nint attrList, nint data);

    [LibraryImport(CoreFoundation)]
    private static partial void CFRelease(nint reference);
}

/// <summary>The credential store refused to keep something.</summary>
public sealed class SecretStoreException : Exception
{
    public SecretStoreException(string message)
        : base(message)
    {
    }

    public SecretStoreException()
    {
    }

    public SecretStoreException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
