using System.Diagnostics;
using MaroonedSoftware.Deadair.Desktop.Core.Diagnostics;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// The log file as the app's pages see it: where it is, and a way to show it in Finder.
/// </summary>
/// <remarks>
/// Revealed rather than opened. Somebody asked for the log is usually about to attach it to a bug
/// report or a message, and the file selected in a Finder window is the one step before that; opening
/// it in whatever the Mac thinks reads .log files is a detour.
/// </remarks>
public sealed class AppLog(FileLog? log)
{
    /// <summary>Where the log is, or null when the app is running without one.</summary>
    public string? FilePath => log?.FilePath;

    /// <summary>Whether there is a file to show.</summary>
    public bool CanReveal => log is { IsWriting: true } && OperatingSystem.IsMacOS();

    public void Reveal()
    {
        if (!CanReveal || log is null)
        {
            return;
        }

        try
        {
            using var _ = Process.Start(new ProcessStartInfo("open") { ArgumentList = { "-R", log.FilePath }, UseShellExecute = false });
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            Trace.WriteLine($"log: could not reveal {log.FilePath}: {exception.Message}");
        }
    }
}
