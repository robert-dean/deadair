using System.Collections.Concurrent;
using System.Net;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// A player that is not there, answering by script.
/// </summary>
/// <remarks>
/// A message handler rather than a mock of the client, because what these tests are about is the
/// requests: which ones are made, in what order, and what the player's own answers turn into.
/// </remarks>
internal sealed class FakeBluOsPlayer : HttpMessageHandler
{
    private readonly ConcurrentQueue<string> _statuses = new();

    /// <summary>Every path and query that was asked for, in order.</summary>
    public List<string> Asked { get; } = [];

    /// <summary>What <c>/Status</c> answers when the script has run out. Held from then on.</summary>
    public string Resting { get; set; } = Status("stop", null);

    /// <summary>How many of the next requests fail before anything answers again.</summary>
    public int Failing { get; set; }

    /// <summary>
    /// How long the player takes to answer.
    /// </summary>
    /// <remarks>
    /// Not zero, deliberately. A handler that answers instantly is not a small computer in another
    /// room, and anything that exists to avoid queueing requests behind one would look like it was
    /// working when it was not: with no latency at all, forty slider values become forty complete
    /// round trips before the second one is even asked for.
    /// </remarks>
    public TimeSpan Latency { get; set; } = TimeSpan.FromMilliseconds(20);

    /// <summary>What a volume request answers, given the level it was asked for.</summary>
    public Func<int, string> VolumeAnswer { get; set; } = level => $"<volume db=\"0\" mute=\"0\">{level}</volume>";

    /// <summary>Queues one <c>/Status</c> answer.</summary>
    public void Next(string xml) => _statuses.Enqueue(xml);

    /// <summary>Queues one built from the parts a phase turns on.</summary>
    public void Next(string state, int? secs, string? streamUrl = "https://radio.example.com/live.mp3", int volume = 20) =>
        _statuses.Enqueue(Status(state, secs, streamUrl, volume));

    public static string Status(string state, int? secs, string? streamUrl = null, int volume = 20)
    {
        var position = secs is { } value ? $"<secs>{value}</secs>" : string.Empty;
        var url = streamUrl is null ? string.Empty : $"<streamUrl>{streamUrl}</streamUrl>";

        return $"""<status etag="{state}-{secs}"><state>{state}</state>{position}{url}<volume>{volume}</volume></status>""";
    }

    protected override HttpResponseMessage Send(HttpRequestMessage request, CancellationToken cancellationToken) =>
        SendAsync(request, cancellationToken).GetAwaiter().GetResult();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri!;
        var asked = url.AbsolutePath + url.Query;

        lock (Asked)
        {
            Asked.Add(asked);
        }

        if (Latency > TimeSpan.Zero)
        {
            await Task.Delay(Latency, cancellationToken).ConfigureAwait(false);
        }

        if (Failing > 0)
        {
            Failing--;
            throw new HttpRequestException("nothing answered");
        }

        var body = url.AbsolutePath switch
        {
            "/Status" => _statuses.TryDequeue(out var next) ? next : Resting,
            "/Play" => "<state>stream</state>",
            "/Stop" => "<state>stop</state>",
            "/Volume" => VolumeAnswer(Level(url)),
            "/SyncStatus" => """<SyncStatus name="Office" brand="NAD" model="M10v2" volume="20" />""",
            _ => "<status/>",
        };

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "text/xml"),
        };
    }

    private static int Level(Uri url)
    {
        var query = url.Query.TrimStart('?').Split('&');
        var level = query.FirstOrDefault(part => part.StartsWith("level=", StringComparison.Ordinal));

        return level is null ? 20 : int.Parse(level["level=".Length..], System.Globalization.CultureInfo.InvariantCulture);
    }
}

/// <summary>Keeps what a plugin said, so a test can read it back.</summary>
internal sealed class RecordingLogger : IPluginLogger
{
    public List<string> Lines { get; } = [];

    public void Log(PluginLogLevel level, string message, Exception? exception = null)
    {
        lock (Lines)
        {
            Lines.Add($"{level}: {message}");
        }
    }
}
