using System.Diagnostics;
using Windows.Storage;

namespace PlayerSpike;

/// <summary>
/// Every reading, timestamped from launch, on screen and in <c>LocalState\spike.log</c>.
/// </summary>
/// <remarks>
/// The file is the half that matters: the interesting readings happen while a game owns the screen,
/// when there is nothing to look at. Device Portal's file explorer reaches it under the app's
/// LocalState folder.
/// </remarks>
public static class SpikeLog
{
    private static readonly Lock Gate = new();
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly string FilePath = Path.Combine(ApplicationData.Current.LocalFolder.Path, "spike.log");
    private static readonly List<string> Lines = [];

    /// <summary>Raised on whichever thread wrote the line. Subscribers marshal for themselves.</summary>
    public static event Action<string>? Written;

    public static IReadOnlyList<string> Snapshot()
    {
        lock (Gate)
        {
            return [.. Lines];
        }
    }

    public static void Write(string message)
    {
        var line = $"{Clock.Elapsed.TotalSeconds,8:F2}s  {message}";
        lock (Gate)
        {
            Lines.Add(line);
            try
            {
                File.AppendAllText(FilePath, line + Environment.NewLine);
            }
            catch (IOException)
            {
                // A reading lost from the file is still on screen. Not worth stopping the spike for.
            }
        }

        Written?.Invoke(line);
    }

    public static void Divider(string title)
    {
        Write(string.Empty);
        Write($"=== {title} ({DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz})");
    }
}
