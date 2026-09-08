namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// Where a signed-in session is kept, which is the operating system's own credential store.
/// </summary>
/// <remarks>
/// <para>
/// The seam exists so that macOS's Keychain, Windows' Credential Manager and libsecret are one class
/// each rather than three branches through the session code.
/// </para>
/// <para>
/// This is the one place the desktop departs from the Android listener, which keeps its tokens in an
/// unencrypted file and writes down why. Two things differ here: a desktop is more likely to be a
/// shared machine, and while only macOS is supported the Keychain is a single file of P/Invoke
/// rather than three native integrations.
/// </para>
/// </remarks>
public interface ISecretStore
{
    /// <summary>The session for a station, or null when there is none.</summary>
    Task<StoredSession?> ReadAsync(string origin, CancellationToken cancellationToken = default);

    Task WriteAsync(StoredSession session, CancellationToken cancellationToken = default);

    Task DeleteAsync(string origin, CancellationToken cancellationToken = default);
}

/// <summary>A store that forgets when the process does. For tests, and for a platform with none yet.</summary>
public sealed class InMemorySecretStore : ISecretStore
{
    private readonly Dictionary<string, StoredSession> _sessions = [];
    private readonly Lock _gate = new();

    public Task<StoredSession?> ReadAsync(string origin, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            return Task.FromResult(_sessions.GetValueOrDefault(origin));
        }
    }

    public Task WriteAsync(StoredSession session, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);

        lock (_gate)
        {
            _sessions[session.Origin] = session;
        }

        return Task.CompletedTask;
    }

    public Task DeleteAsync(string origin, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _sessions.Remove(origin);
        }

        return Task.CompletedTask;
    }
}
