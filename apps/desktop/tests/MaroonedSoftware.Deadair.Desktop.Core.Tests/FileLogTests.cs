using MaroonedSoftware.Deadair.Desktop.Core.Diagnostics;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class FileLogTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"deadair-log-{Guid.NewGuid():N}");
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 9, 13, 10, 41, 2, 123, TimeSpan.Zero));

    public FileLogTests() => _time.SetLocalTimeZone(TimeZoneInfo.Utc);

    private string LogPath => Path.Combine(_directory, FileLog.FileName);

    [Fact]
    public void WritesOneLinePerEntryWithTheTimeInFront()
    {
        using (var log = FileLog.Open(_directory, _time))
        {
            log.Write("station attached");
            _time.Advance(TimeSpan.FromSeconds(1));
            log.Write("player: Playing");
        }

        Assert.Equal(
            [
                "2026-09-13T10:41:02.123+00:00 station attached",
                "2026-09-13T10:41:03.123+00:00 player: Playing",
            ],
            File.ReadAllLines(LogPath));
    }

    [Fact]
    public void RotatesAFileOverTheCapWhenItOpens_AndKeepsOnePrevious()
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(LogPath, new string('x', 200));
        File.WriteAllText(LogPath + ".1", "the one before that");

        using (var log = FileLog.Open(_directory, _time, rotateAt: 100))
        {
            log.Write("fresh");
        }

        Assert.Equal(new string('x', 200), File.ReadAllText(LogPath + ".1"));
        Assert.Equal(["2026-09-13T10:41:02.123+00:00 fresh"], File.ReadAllLines(LogPath));
    }

    [Fact]
    public void LeavesAFileUnderTheCapAlone()
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(LogPath, "yesterday\n");

        using (var log = FileLog.Open(_directory, _time, rotateAt: 100))
        {
            log.Write("today");
        }

        Assert.False(File.Exists(LogPath + ".1"));
        Assert.Equal(["yesterday", "2026-09-13T10:41:02.123+00:00 today"], File.ReadAllLines(LogPath));
    }

    /// <summary>
    /// A log that cannot be written must not become an app that cannot start, and a line written to
    /// it must not throw: a listener that throws inside <c>Trace.WriteLine</c> crashes whoever logged.
    /// </summary>
    [Fact]
    public void KeepsRunningWhenTheDirectoryCannotBeWritten()
    {
        // A file where the directory should be: CreateDirectory refuses it on every platform.
        Directory.CreateDirectory(_directory);
        var blocked = Path.Combine(_directory, "not-a-directory");
        File.WriteAllText(blocked, string.Empty);

        using var log = FileLog.Open(blocked, _time);

        Assert.False(log.IsWriting);
        log.Write("nobody will read this");
    }

    [Fact]
    public void FlushesEachLineSoAReaderSeesItAtOnce()
    {
        using var log = FileLog.Open(_directory, _time);

        log.Write("before the crash");

        // Read while the log is still open, the way Console.app or `tail` would.
        using var reader = new StreamReader(new FileStream(LogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite));
        Assert.Equal("2026-09-13T10:41:02.123+00:00 before the crash", reader.ReadLine());
    }

    [Fact]
    public void AStackTraceStaysOneEntry()
    {
        using (var log = FileLog.Open(_directory, _time))
        {
            log.Write("unhandled: System.InvalidOperationException: no\n   at A.B()\r\n   at C.D()\n");
        }

        var lines = File.ReadAllLines(LogPath);

        Assert.Equal(3, lines.Length);
        Assert.Single(lines, line => line.StartsWith("2026-", StringComparison.Ordinal));
        Assert.Equal("       at A.B()", lines[1]);
    }

    /// <summary>
    /// <c>TraceEvent</c> writes a header with <c>Write</c> and the message with <c>WriteLine</c>, and
    /// the two belong on one line.
    /// </summary>
    [Fact]
    public void JoinsATraceWriteToTheLineThatFinishesIt()
    {
        using (var log = FileLog.Open(_directory, _time))
        {
            var listener = log.AsTraceListener();
            listener.Write("deadair Error: 0 : ");
            listener.WriteLine("the thing failed");
        }

        Assert.Equal(["2026-09-13T10:41:02.123+00:00 deadair Error: 0 : the thing failed"], File.ReadAllLines(LogPath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }

        GC.SuppressFinalize(this);
    }
}
