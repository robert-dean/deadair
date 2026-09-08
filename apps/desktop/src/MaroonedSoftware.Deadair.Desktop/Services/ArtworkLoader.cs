using Avalonia.Media.Imaging;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// Covers for a list, fetched once each and kept.
/// </summary>
/// <remarks>
/// <para>
/// A page of history is a hundred rows and a page of the catalog is fifty, so the thing this exists
/// to prevent is a hundred simultaneous requests the first time somebody opens one. The station rate
/// limits at a hundred requests per five seconds and would answer most of them with a 429, which
/// would look like a station with no artwork.
/// </para>
/// <para>
/// Three rules, each for a measured reason rather than for tidiness. FOUR at a time, so a list fills
/// visibly from the top rather than arriving all at once or not at all. ONE request per URL even if
/// twenty rows ask together, because the same cover appears on every track of an album. And a
/// FAILURE is remembered: art is hotlinked until the station's own cache pass runs, so a dead
/// upstream is ordinary, and retrying it on every scroll would spend the whole rate limit on a URL
/// that is not going to answer.
/// </para>
/// <para>
/// The client is the app's one client, which is what keeps every request — API, artwork and audio —
/// under a single User-Agent. The station counts an HLS listener per IP and agent.
/// </para>
/// </remarks>
public sealed class ArtworkLoader(HttpClient http) : IDisposable
{
    /// <summary>Enough for several pages of scrollback, and small: these are thumbnails.</summary>
    private const int Keep = 200;

    private readonly Dictionary<string, Task<Bitmap?>> _inFlight = [];
    private readonly Dictionary<string, Bitmap?> _done = [];
    private readonly Queue<string> _order = new();
    private readonly SemaphoreSlim _atOnce = new(4, 4);
    private readonly Lock _gate = new();

    /// <summary>
    /// The one the controls reach.
    /// </summary>
    /// <remarks>
    /// A static because a control cannot be given anything by a container: it is built by XAML. Set
    /// once, in `Composition`, which is the only place in the app that knows how anything is wired.
    /// </remarks>
    public static ArtworkLoader? Shared { get; set; }

    public async Task<Bitmap?> GetAsync(Uri url)
    {
        ArgumentNullException.ThrowIfNull(url);

        var key = url.ToString();
        Task<Bitmap?> work;

        lock (_gate)
        {
            if (_done.TryGetValue(key, out var already))
            {
                return already;
            }

            if (!_inFlight.TryGetValue(key, out var running))
            {
                running = FetchAsync(url, key);
                _inFlight[key] = running;
            }

            work = running;
        }

        return await work.ConfigureAwait(false);
    }

    private async Task<Bitmap?> FetchAsync(Uri url, string key)
    {
        Bitmap? bitmap = null;

        await _atOnce.WaitAsync().ConfigureAwait(false);
        try
        {
            await using var stream = await http.GetStreamAsync(url).ConfigureAwait(false);
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer).ConfigureAwait(false);
            buffer.Position = 0;

            bitmap = new Bitmap(buffer);
        }
        catch (Exception)
        {
            // Remembered as "there is none", not retried. See the note above about hotlinking.
        }
        finally
        {
            _atOnce.Release();
        }

        lock (_gate)
        {
            _inFlight.Remove(key);
            _done[key] = bitmap;
            _order.Enqueue(key);

            while (_order.Count > Keep && _order.TryDequeue(out var oldest))
            {
                if (_done.Remove(oldest, out var evicted))
                {
                    evicted?.Dispose();
                }
            }
        }

        return bitmap;
    }

    public void Dispose()
    {
        _atOnce.Dispose();

        lock (_gate)
        {
            foreach (var bitmap in _done.Values)
            {
                bitmap?.Dispose();
            }

            _done.Clear();
        }
    }
}
