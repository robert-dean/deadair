using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace MaroonedSoftware.Deadair.Desktop.Core.Diagnostics;

/// <summary>
/// The app's log, as one file somebody can open, attach to a bug report or watch with <c>tail</c>.
/// </summary>
/// <remarks>
/// <para>
/// Before this the app called <c>LogToTrace</c> and registered no listener, so a bundled app logged
/// nowhere at all: Avalonia's warnings, a plugin's lines and an unhandled exception all went to a
/// sink only a debugger reads. When something went wrong on somebody else's Mac there was nothing to
/// ask them for.
/// </para>
/// <para>
/// <see cref="Trace"/> stays the one channel, since Core already writes through it; this is only the
/// listener at the end of it. <c>~/Library/Logs/deadair</c> because Console.app lists that folder
/// without being told about it.
/// </para>
/// <para>
/// Three properties are the point. It NEVER throws: a listener that throws inside
/// <c>Trace.WriteLine</c> crashes whoever was logging, which would turn a line about a problem into
/// the problem. Every line is flushed as it is written, so a crash loses nothing before it. And the
/// file is rotated once, at open, over a cap: a session writes tens of lines, so four megabytes is
/// months, and one previous file doubles it without a scheme to maintain.
/// </para>
/// </remarks>
public sealed class FileLog : IDisposable
{
    /// <summary>The size over which the file is moved aside when the app starts.</summary>
    public const long RotateAt = 4L * 1024 * 1024;

    /// <summary>The file's name, and with <c>.1</c> after it, the previous one's.</summary>
    public const string FileName = "deadair.log";

    private readonly Lock _gate = new();
    private readonly TimeProvider _clock;
    private StreamWriter? _writer;

    private FileLog(string filePath, TimeProvider clock, StreamWriter? writer)
    {
        FilePath = filePath;
        _clock = clock;
        _writer = writer;
    }

    /// <summary>The log the app opened at start, for the one place that has to be handed it statically.</summary>
    public static FileLog? Shared { get; set; }

    /// <summary>Where the log is, whether or not it could be opened.</summary>
    public string FilePath { get; }

    /// <summary>False when the directory refused the file, in which case every line is dropped.</summary>
    public bool IsWriting
    {
        get
        {
            lock (_gate)
            {
                return _writer is not null;
            }
        }
    }

    /// <summary><c>~/Library/Logs/deadair</c> on macOS, the local application data folder elsewhere.</summary>
    public static string DefaultDirectory() => OperatingSystem.IsMacOS()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Logs", "deadair")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "deadair", "logs");

    /// <summary>Opens the log in <paramref name="directory"/>, rotating it first if it has grown past the cap.</summary>
    /// <remarks>Never throws. A log that cannot be written is a log that drops its lines, not an app that will not start.</remarks>
    public static FileLog Open(string directory, TimeProvider? clock = null, long rotateAt = RotateAt)
    {
        ArgumentNullException.ThrowIfNull(directory);

        var path = Path.Combine(directory, FileName);

        try
        {
            Directory.CreateDirectory(directory);

            var existing = new FileInfo(path);
            if (existing.Exists && existing.Length > rotateAt)
            {
                File.Move(path, path + ".1", overwrite: true);
            }

            // Shared for reading, so Console.app and `tail -f` can follow a file that is still open.
            var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
            var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)) { AutoFlush = true };

            return new FileLog(path, clock ?? TimeProvider.System, writer);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return new FileLog(path, clock ?? TimeProvider.System, writer: null);
        }
    }

    /// <summary>Writes one entry, the time in front and any further lines of it indented beneath.</summary>
    /// <remarks>
    /// A stack trace stays one entry: its lines are indented, so every line that starts with a date
    /// starts an entry and <c>grep</c> can count them.
    /// </remarks>
    public void Write(string message)
    {
        var at = _clock.GetLocalNow().ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture);
        var lines = (message ?? string.Empty).ReplaceLineEndings("\n").TrimEnd('\n').Split('\n');

        var entry = new StringBuilder();
        entry.Append(at).Append(' ').Append(lines[0]).Append('\n');
        for (var i = 1; i < lines.Length; i++)
        {
            entry.Append("    ").Append(lines[i]).Append('\n');
        }

        lock (_gate)
        {
            if (_writer is null)
            {
                return;
            }

            try
            {
                _writer.Write(entry.ToString());
            }
            catch (Exception exception) when (exception is IOException or ObjectDisposedException)
            {
                // Dropped rather than thrown: see the class remarks. A disk that filled up mid-session
                // is not something the line that noticed it can fix.
            }
        }
    }

    /// <summary>The listener to add to <see cref="Trace.Listeners"/>.</summary>
    public TraceListener AsTraceListener() => new Listener(this);

    public void Dispose()
    {
        lock (_gate)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }

    /// <summary>
    /// Turns <see cref="Trace"/>'s writes into entries. <c>Write</c> without a line end is held until
    /// the <c>WriteLine</c> that finishes it, which is how <c>TraceEvent</c> puts a header in front.
    /// </summary>
    private sealed class Listener(FileLog log) : TraceListener("deadair")
    {
        private readonly Lock _gate = new();
        private readonly StringBuilder _pending = new();

        public override void Write(string? message)
        {
            lock (_gate)
            {
                _pending.Append(message);
            }
        }

        public override void WriteLine(string? message)
        {
            string entry;
            lock (_gate)
            {
                entry = _pending.Append(message).ToString();
                _pending.Clear();
            }

            log.Write(entry);
        }
    }
}
