using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// The one path every operator action takes.
/// </summary>
/// <remarks>
/// <para>
/// Skip, stop, hold, reorder: each is a call that may be refused for one of three reasons, and each
/// of those needs different handling. Putting it here means a new verb inherits the handling rather
/// than reinventing two thirds of it.
/// </para>
/// <para>
/// <b>A 403 refreshes the roles.</b> They are a cached hint, and the station disagreeing with them is
/// the only signal that they are stale — so the controls go away rather than staying and failing.
/// </para>
/// </remarks>
public sealed class OperatorActions(SessionManager session)
{
    /// <summary>Raised when something needs saying. Drawn by one host.</summary>
    public event Action<Notice>? Noticed;

    /// <summary>
    /// Runs an action, handling the ways the station can refuse it.
    /// </summary>
    /// <param name="action">The call.</param>
    /// <param name="expected">
    /// Statuses this caller has a sentence for, such as 409 meaning "nothing to resume". Anything not
    /// listed is reported as a failure.
    /// </param>
    public async Task<T?> RunAsync<T>(
        Func<CancellationToken, Task<T>> action,
        IReadOnlyDictionary<int, string>? expected = null,
        CancellationToken cancellationToken = default)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(action);

        try
        {
            return await action(cancellationToken).ConfigureAwait(false);
        }
        catch (SdkException failure)
        {
            await ReportAsync(failure, expected, cancellationToken).ConfigureAwait(false);
            return null;
        }
    }

    private async Task ReportAsync(
        SdkException failure,
        IReadOnlyDictionary<int, string>? expected,
        CancellationToken cancellationToken)
    {
        if (expected?.TryGetValue(failure.Status, out var sentence) == true)
        {
            Noticed?.Invoke(new Notice.Expected(sentence));
            return;
        }

        if (ApiError.IsStepUpRequired(failure))
        {
            Noticed?.Invoke(new Notice.StepUpNeeded());
            return;
        }

        if (ApiError.IsForbidden(failure))
        {
            await session.RefreshRolesAsync(cancellationToken).ConfigureAwait(false);
            Noticed?.Invoke(new Notice.NoLongerOperator());
            return;
        }

        Noticed?.Invoke(new Notice.Failed(
            ApiError.Message(failure) ?? "The station refused that, and did not say why."));
    }
}
