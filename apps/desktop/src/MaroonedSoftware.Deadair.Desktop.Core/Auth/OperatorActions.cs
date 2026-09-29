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
        catch (SdkException failure) when (StepUp is not null && ApiError.IsStepUpRequired(failure))
        {
            if (!await StepUp(cancellationToken).ConfigureAwait(false))
            {
                return null;
            }

            try
            {
                return await action(cancellationToken).ConfigureAwait(false);
            }
            catch (SdkException again)
            {
                await ReportAsync(again, expected, cancellationToken).ConfigureAwait(false);
                return null;
            }
        }
        catch (SdkException failure)
        {
            await ReportAsync(failure, expected, cancellationToken).ConfigureAwait(false);
            return null;
        }
    }

    /// <summary>
    /// Asks the operator for a second factor and answers whether they gave one, for a call the station
    /// refused until they do. Absent, a step-up is reported as a notice like any other refusal.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Set once, by whatever can draw the question (the app's step-up dialog); this project cannot
    /// draw anything. The action is then tried AGAIN, once: the station asked for proof that the
    /// person at the keyboard is the account holder, not for the action to be abandoned, and a
    /// second refusal after a good code is reported rather than asked about again, so a station that
    /// keeps asking cannot hold somebody in a loop of code boxes.
    /// </para>
    /// <para>
    /// Declining says nothing at the foot of the page: the person pressed Cancel, and a notice telling
    /// them the station wanted a code they chose not to give is news to nobody.
    /// </para>
    /// </remarks>
    public Func<CancellationToken, Task<bool>>? StepUp { get; set; }

    /// <summary>
    /// Runs a call that answers with nothing, and says whether it worked.
    /// </summary>
    /// <remarks>
    /// Named apart from <see cref="RunAsync{T}"/> rather than overloading it, because a lambda that
    /// returns <c>Task&lt;T&gt;</c> converts to both and the overload chosen would be the one a
    /// reader has to look up. A delete, a hide or a refresh answers 204, and the caller only needs
    /// to know whether to redraw.
    /// </remarks>
    public async Task<bool> DoAsync(
        Func<CancellationToken, Task> action,
        IReadOnlyDictionary<int, string>? expected = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(action);

        // Through RunAsync, so a call that answers with nothing is asked about a second factor the
        // same way one that answers with a body is.
        var done = await RunAsync(
            async token =>
            {
                await action(token).ConfigureAwait(false);
                return Done;
            },
            expected,
            cancellationToken).ConfigureAwait(false);

        return done is not null;
    }

    private static readonly object Done = new();

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
