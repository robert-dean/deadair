using System.Diagnostics;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Input.Platform;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// The two things a view model asks of the Mac beyond the window: open a link in the person's
/// browser, and put some text on the clipboard.
/// </summary>
/// <remarks>
/// A seam for the reason <see cref="IFilePicker"/> is one: the clipboard hangs off a window a view
/// model has no business holding, and a headless render must be able to build a page that has a
/// Connect button without a browser opening.
/// </remarks>
public interface ISystemShell
{
    /// <summary>Opens a link in the default browser, answering whether anything was asked to.</summary>
    bool Open(Uri link);

    /// <summary>Puts text on the clipboard.</summary>
    Task CopyAsync(string text);
}

/// <summary>The Mac's own browser and the main window's clipboard.</summary>
public sealed class SystemShell : ISystemShell
{
    public bool Open(Uri link)
    {
        ArgumentNullException.ThrowIfNull(link);

        // Only a web address. A plugin's authorization link comes from the station, and `open` would
        // as happily run a file:// or an app's own scheme handed over by something that went wrong.
        if (link.Scheme != Uri.UriSchemeHttps && link.Scheme != Uri.UriSchemeHttp)
        {
            Trace.WriteLine($"browser: refused to open a {link.Scheme} link");
            return false;
        }

        try
        {
            using var _ = Process.Start(new ProcessStartInfo("open") { ArgumentList = { link.AbsoluteUri }, UseShellExecute = false });
            return true;
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            Trace.WriteLine($"browser: could not open a link: {exception.Message}");
            return false;
        }
    }

    public async Task CopyAsync(string text)
    {
        if ((Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.MainWindow?.Clipboard is { } clipboard)
        {
            await clipboard.SetTextAsync(text).ConfigureAwait(true);
        }
    }
}
