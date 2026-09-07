using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>Whether anybody is signed in, and as whom.</summary>
public abstract record SessionState
{
    private SessionState()
    {
    }

    public sealed record SignedOut : SessionState;

    public sealed record SignedIn(string Email, IReadOnlyList<PlatformRole> Roles) : SessionState
    {
        /// <summary>
        /// Whether to DRAW the operator's controls. Never whether to allow them: the station is the
        /// gate, and this is a cached hint that can be out of date.
        /// </summary>
        public bool IsOperator => Roles.Contains(PlatformRole.Admin);
    }
}

/// <summary>
/// The whole of the app's sign-in policy.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately one class, because the rules only make sense together and every one of them was
/// learned rather than designed. They are the Android listener's, and they transfer exactly.
/// </para>
/// </remarks>
public sealed class SessionManager : IDisposable
{
    private readonly ISecretStore _store;
    private readonly HttpClient _http;
    private readonly SemaphoreSlim _refreshing = new(1, 1);

    private StationUrl _station;
    private StoredSession? _session;
    private bool _rolesRead;

    public SessionManager(ISecretStore store, HttpClient http)
    {
        _store = store;
        _http = http;
    }

    public SessionState State { get; private set; } = new SessionState.SignedOut();

    public event Action<SessionState>? Changed;

    /// <summary>The access token to present, or null when nobody is signed in.</summary>
    public string? AccessToken => _session?.AccessToken;

    /// <summary>
    /// Points the manager at a station and loads whatever is held for it.
    /// </summary>
    /// <remarks>
    /// A session stored against a DIFFERENT origin is deleted rather than kept: a token is only
    /// meaningful to the station that issued it, and holding one for a station the operator has moved
    /// away from is keeping a credential for no reason.
    /// </remarks>
    public async Task AttachAsync(StationUrl station, CancellationToken cancellationToken = default)
    {
        _station = station;
        _rolesRead = false;

        _session = await _store.ReadAsync(station.ToString(), cancellationToken).ConfigureAwait(false);
        Publish();
    }

    public async Task<SignInResult> SignInAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        try
        {
            var answer = await RequestTokenAsync(
                new PasswordAuthenticationRequest { Username = email, Password = password },
                cancellationToken).ConfigureAwait(false);

            return await AcceptAsync(email, answer, cancellationToken).ConfigureAwait(false);
        }
        catch (SdkException failure) when (failure.Status is 400 or 401)
        {
            return new SignInResult.BadCredentials();
        }
        catch (SdkException failure)
        {
            return new SignInResult.Failed(ApiError.Message(failure));
        }
    }

    /// <summary>Answers a second-factor challenge with a code from an authenticator app.</summary>
    public async Task<SignInResult> CompleteSecondFactorAsync(
        string email,
        string challengeId,
        string methodId,
        string code,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var answer = await RequestTokenAsync(
                new AuthenticatorAuthenticationRequest
                {
                    Code = code,
                    MfaChallengeId = challengeId,
                    MethodId = methodId,
                },
                cancellationToken).ConfigureAwait(false);

            return await AcceptAsync(email, answer, cancellationToken).ConfigureAwait(false);
        }
        catch (SdkException failure) when (failure.Status is 400 or 401)
        {
            return new SignInResult.BadCredentials();
        }
        catch (SdkException failure)
        {
            return new SignInResult.Failed(ApiError.Message(failure));
        }
    }

    private async Task<SignInResult> AcceptAsync(
        string email,
        AuthenticationTokenResponse answer,
        CancellationToken cancellationToken)
    {
        switch (answer)
        {
            case MfaRequiredResponse challenge:
                // A 200 rather than an error, and the reason this method returns a result type rather
                // than throwing on failure.
                return new SignInResult.SecondFactorNeeded(challenge.ChallengeId, challenge.Factors);

            case AuthenticationTokenIssued issued when issued.RefreshToken is { Length: > 0 } refresh:
                _session = new StoredSession
                {
                    Origin = _station.ToString(),
                    Email = email,
                    AccessToken = issued.AccessToken,
                    RefreshToken = refresh,
                };

                await _store.WriteAsync(_session, cancellationToken).ConfigureAwait(false);
                Publish();

                // A failure here is not a failed sign-in: the operator is signed in, and the app
                // simply does not know yet what to draw.
                try
                {
                    await RefreshRolesAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (SdkException)
                {
                    // Left as no roles, which draws a listener rather than an operator.
                }

                return new SignInResult.Ok();

            case AuthenticationTokenIssued:
                // Without a refresh token the session lasts fifteen minutes and then ends with no way
                // back, which is worse than refusing it here.
                return new SignInResult.Unsupported("The station issued no refresh token.");

            default:
                return new SignInResult.Unsupported("The station answered in a way this app does not know.");
        }
    }

    /// <summary>
    /// Re-reads what this account may do.
    /// </summary>
    /// <remarks>
    /// A 403 stores NO roles rather than failing: the account is signed in and holds nothing, which is
    /// an ordinary state for anything that did not come in through onboarding.
    /// </remarks>
    public async Task RefreshRolesAsync(CancellationToken cancellationToken = default)
    {
        if (_session is null)
        {
            return;
        }

        IReadOnlyList<PlatformRole> roles;
        try
        {
            using var sdk = Sdk();
            var session = await sdk.AuthenticationSessions.ReadSessionAsync(cancellationToken).ConfigureAwait(false);
            roles = session.Roles;
        }
        catch (SdkException failure) when (failure.Status == 403)
        {
            roles = [];
        }

        _session = _session with { Roles = roles };
        _rolesRead = true;
        await _store.WriteAsync(_session, cancellationToken).ConfigureAwait(false);
        Publish();
    }

    /// <summary>Reads the roles once per station per run, for a session restored from the store.</summary>
    public async Task EnsureRolesAsync(CancellationToken cancellationToken = default)
    {
        if (_session is null || _rolesRead)
        {
            return;
        }

        try
        {
            await RefreshRolesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (SdkException)
        {
            // The station is unreachable. What is cached is what gets drawn until it is not.
        }
    }

    /// <summary>
    /// Exchanges the refresh token, at most once at a time.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Single-flight, and that is not tidiness.</b> Refresh tokens are single-use and rotating, and
    /// presenting a spent one revokes the whole family — so two pollers that hit a 401 in the same
    /// second must produce ONE exchange, or the app signs itself out.
    /// </para>
    /// <para>
    /// The re-check inside the lock is the other half: by the time a caller acquires it, somebody else
    /// may already have replaced the very token it set out to replace, in which case the right answer
    /// is the new one rather than another exchange.
    /// </para>
    /// </remarks>
    /// <param name="spent">The access token the caller found to be rejected.</param>
    public async Task<RefreshOutcome> RefreshedAsync(string? spent, CancellationToken cancellationToken = default)
    {
        await _refreshing.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = _session;
            if (current is null)
            {
                return new RefreshOutcome.SessionEnded();
            }

            if (!string.Equals(current.AccessToken, spent, StringComparison.Ordinal))
            {
                // Somebody else already refreshed while this caller waited.
                return new RefreshOutcome.Renewed(current.AccessToken);
            }

            AuthenticationTokenResponse answer;
            try
            {
                answer = await RequestTokenAsync(
                    new RefreshTokenAuthenticationRequest { RefreshToken = current.RefreshToken },
                    cancellationToken).ConfigureAwait(false);
            }
            catch (SdkException failure) when (failure.Status is >= 400 and < 500)
            {
                // A 4xx ENDS the session and nothing else does. Not a network failure, not a 5xx:
                // those are the station being unreachable, and signing somebody out because their
                // wifi dropped is the wrong answer.
                await EndAsync(cancellationToken).ConfigureAwait(false);
                return new RefreshOutcome.SessionEnded();
            }
            catch (Exception failure) when (failure is SdkException or HttpRequestException or TaskCanceledException)
            {
                // The station could not be asked. The session stays exactly as it was, and the caller
                // is handed back its own failure rather than this one — a 502 from a background
                // refresh surfacing at whoever happened to trigger it is a confusing lie about what
                // they asked for.
                return new RefreshOutcome.Unavailable();
            }

            if (answer is not AuthenticationTokenIssued issued)
            {
                // A second factor cannot be answered from inside a background refresh.
                await EndAsync(cancellationToken).ConfigureAwait(false);
                return new RefreshOutcome.SessionEnded();
            }

            _session = current with
            {
                AccessToken = issued.AccessToken,

                // A rotation that does not answer with a new refresh token leaves the old one in
                // force. Dropping it here would end the session at the following refresh.
                RefreshToken = issued.RefreshToken is { Length: > 0 } rotated ? rotated : current.RefreshToken,
            };

            await _store.WriteAsync(_session, cancellationToken).ConfigureAwait(false);
            Publish();

            return new RefreshOutcome.Renewed(_session.AccessToken);
        }
        finally
        {
            _refreshing.Release();
        }
    }

    public async Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var sdk = Sdk();
            await sdk.AuthenticationSessions.LogoutAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Best effort. The local session is cleared either way: an operator who pressed sign out
            // and is still signed in because the station was unreachable has been ignored.
        }

        await EndAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task EndAsync(CancellationToken cancellationToken)
    {
        var origin = _session?.Origin ?? _station.ToString();
        _session = null;
        _rolesRead = false;
        await _store.DeleteAsync(origin, cancellationToken).ConfigureAwait(false);
        Publish();
    }

    private async Task<AuthenticationTokenResponse> RequestTokenAsync(
        AuthenticationRequest request,
        CancellationToken cancellationToken)
    {
        using var sdk = Sdk();
        return await sdk.Authentication.RequestTokenAsync(request, cancellationToken).ConfigureAwait(false);
    }

    /// <remarks>
    /// No <c>Headers</c> callback: the bearer is attached by <see cref="SessionHandler"/> on the
    /// shared client, so that the refresh and its single replay live in one place.
    /// </remarks>
    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = _http,
    });

    private void Publish()
    {
        State = _session is null
            ? new SessionState.SignedOut()
            : new SessionState.SignedIn(_session.Email, _session.Roles);

        Changed?.Invoke(State);
    }

    public void Dispose() => _refreshing.Dispose();
}


/// <summary>What came of trying to exchange a refresh token.</summary>
/// <remarks>
/// Three outcomes rather than a nullable token, because "the session is over" and "the station could
/// not be reached" want opposite handling and a null cannot tell them apart.
/// </remarks>
public abstract record RefreshOutcome
{
    private RefreshOutcome()
    {
    }

    /// <summary>A new access token. Retry with this.</summary>
    public sealed record Renewed(string AccessToken) : RefreshOutcome;

    /// <summary>The station refused the refresh token. Nobody is signed in any more.</summary>
    public sealed record SessionEnded : RefreshOutcome;

    /// <summary>The station could not be asked. The session is untouched; do not retry.</summary>
    public sealed record Unavailable : RefreshOutcome;
}
