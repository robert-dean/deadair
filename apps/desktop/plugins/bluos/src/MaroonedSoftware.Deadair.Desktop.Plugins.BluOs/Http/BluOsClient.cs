using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;

/// <summary>
/// One player, asked things.
/// </summary>
/// <remarks>
/// <para>
/// Every request carries its own deadline rather than relying on the client's, because the client
/// this plugin is given has none: its timeout cannot be changed after the first request, and a
/// long-poll and a stop command want wildly different waits.
/// </para>
/// <para>
/// Nothing here retries. What to do about a player that did not answer is the host's decision, and
/// a second attempt buried in here would only make the first one's failure arrive later.
/// </para>
/// </remarks>
public sealed class BluOsClient(HttpClient http, BluOsEndpoint player, IPluginLogger logger)
{
    /// <summary>Long enough for a busy player, short enough to notice one that is not there.</summary>
    private static readonly TimeSpan CommandDeadline = TimeSpan.FromSeconds(5);

    /// <summary>Which player this is.</summary>
    public BluOsEndpoint Player { get; } = player;

    /// <summary>
    /// How long a player may hold a status request open.
    /// </summary>
    /// <remarks>
    /// The spec asks for no faster than ten seconds and around sixty at most. The upper end is taken
    /// unless the client would give up first — which it will not for the client the host supplies,
    /// but a plugin should not fail differently because somebody handed it a stricter one.
    /// </remarks>
    public TimeSpan LongPollTimeout { get; } = LongPoll(http);

    /// <summary>What the player is doing.</summary>
    /// <param name="etag">The last reading's tag, when waiting for a change.</param>
    /// <param name="longPoll">Whether to let the player hold the request until something happens.</param>
    public async Task<BluOsStatus> StatusAsync(string? etag, bool longPoll, CancellationToken cancellationToken)
    {
        var timeout = longPoll ? (int)LongPollTimeout.TotalSeconds : (int?)null;
        var url = BluOsUrls.Status(Player, longPoll ? etag : null, timeout);

        // The player is entitled to hold a long-poll for the whole timeout it was given, so the
        // deadline has to be that plus room for the network rather than the command deadline.
        var deadline = longPoll ? LongPollTimeout + CommandDeadline : CommandDeadline;

        return BluOsXml.ParseStatus(await GetAsync(url, deadline, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>What the player calls itself.</summary>
    public async Task<BluOsSyncStatus> SyncStatusAsync(CancellationToken cancellationToken) =>
        BluOsXml.ParseSyncStatus(await GetAsync(BluOsUrls.SyncStatus(Player), CommandDeadline, cancellationToken).ConfigureAwait(false));

    /// <summary>Hands the player a mount and lets it fetch the audio itself.</summary>
    public async Task<string?> PlayAsync(Uri mount, string? caption, Uri? logo, CancellationToken cancellationToken) =>
        BluOsXml.ParseState(await GetAsync(BluOsUrls.Play(Player, mount, caption, logo), CommandDeadline, cancellationToken).ConfigureAwait(false));

    /// <summary>Stops, which drops the player's connection to the mount.</summary>
    public async Task<string?> StopAsync(CancellationToken cancellationToken) =>
        BluOsXml.ParseState(await GetAsync(BluOsUrls.Stop(Player), CommandDeadline, cancellationToken).ConfigureAwait(false));

    /// <summary>Sets the volume, 0 to 100, and answers what the player says it now is.</summary>
    public async Task<int?> SetVolumeAsync(int level, CancellationToken cancellationToken) =>
        BluOsXml.ParseVolume(await GetAsync(BluOsUrls.Volume(Player, level), CommandDeadline, cancellationToken).ConfigureAwait(false));

    private async Task<string> GetAsync(Uri url, TimeSpan deadline, CancellationToken cancellationToken)
    {
        using var giveUp = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        giveUp.CancelAfter(deadline);

        try
        {
            using var response = await http.GetAsync(url, giveUp.Token).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();

            return await response.Content.ReadAsStringAsync(giveUp.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The deadline, not the caller. Reported as a request that did not finish rather than as
            // a cancellation, since nobody asked for it to stop.
            logger.Warn($"{Player} did not answer {url.AbsolutePath} within {deadline.TotalSeconds:0} seconds");

            throw new HttpRequestException($"{Player} did not answer within {deadline.TotalSeconds:0} seconds");
        }
    }

    private static TimeSpan LongPoll(HttpClient http)
    {
        ArgumentNullException.ThrowIfNull(http);

        // Sixty, unless the client would give up first. Five seconds of room, because the player
        // answers AT the timeout and the answer still has to arrive.
        var ceiling = http.Timeout == Timeout.InfiniteTimeSpan
            ? TimeSpan.FromSeconds(60)
            : http.Timeout - TimeSpan.FromSeconds(5);

        var seconds = Math.Clamp(ceiling.TotalSeconds, 10, 60);

        return TimeSpan.FromSeconds(seconds);
    }
}
