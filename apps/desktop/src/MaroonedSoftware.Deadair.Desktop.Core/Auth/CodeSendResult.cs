namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// What came of asking the station to email a code for a pending sign-in. The Android app's
/// <c>CodeSendResult</c>.
/// </summary>
/// <remarks>
/// <see cref="Sent"/> carries the email challenge's id, which the <c>code</c> grant has to echo back:
/// an emailed code is bound to the message the station sent rather than to an enrolled factor's
/// method id.
/// </remarks>
public abstract record CodeSendResult
{
    private CodeSendResult()
    {
    }

    /// <summary>The station sent a code. Answer it with this message's id.</summary>
    public sealed record Sent(string EmailChallengeId) : CodeSendResult;

    /// <summary>The pending sign-in expired before the code could be sent. Only the password step again can fix it.</summary>
    public sealed record ChallengeExpired : CodeSendResult;

    /// <summary>The station has no mail server to send through.</summary>
    public sealed record NoMail : CodeSendResult;

    /// <summary>Anything else: no network, a station that is down. The detail is for the log, not the page.</summary>
    public sealed record Failed(string? Detail) : CodeSendResult;
}
