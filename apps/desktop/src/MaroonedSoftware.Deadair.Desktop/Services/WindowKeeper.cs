using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>What the app's menus can ask of its one window.</summary>
public interface IWindowKeeper
{
    void Show();

    void Hide();

    void Minimize();

    void Quit();
}

/// <summary>
/// Keeps the app running, and the station playing, when its window is closed.
/// </summary>
/// <remarks>
/// <para>
/// This is a radio. Closing its window used to quit it, which stopped the station for anybody who
/// only wanted the window out of the way, the way Music and every other Mac player does not. So the
/// app now ends only when somebody quits it (the app menu, ⌘Q, the Dock, the menu-bar icon), a
/// close hides the window, and a click on the Dock icon brings it back.
/// </para>
/// <para>
/// <see cref="HidesInsteadOfClosing"/> is the one decision, and it is narrow on purpose: only the
/// person's own close is turned into a hide. A close raised by the app quitting, by the system
/// shutting down, or by code must still close, or quitting would stop working and the app would
/// hang on at logout.
/// </para>
/// <para>
/// Dock reopening and link opening arrive only for a BUNDLED app: a <c>dotnet run</c> has no bundle
/// identifier for macOS to route them to. Under <c>dotnet run</c>, the menu-bar icon's Show is the
/// way back.
/// </para>
/// </remarks>
public sealed class WindowKeeper : IWindowKeeper
{
    private readonly IClassicDesktopStyleApplicationLifetime _desktop;
    private readonly Window _window;

    public WindowKeeper(IClassicDesktopStyleApplicationLifetime desktop, Window window)
    {
        ArgumentNullException.ThrowIfNull(desktop);
        ArgumentNullException.ThrowIfNull(window);

        _desktop = desktop;
        _window = window;

        // The loop now ends only on an explicit quit, which is also what makes the lifetime's Exit
        // (and the container's disposal in it) the single way out.
        desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;

        window.Closing += (_, e) =>
        {
            if (HidesInsteadOfClosing(e.CloseReason, e.IsProgrammatic))
            {
                e.Cancel = true;
                window.Hide();
            }
        };

        // Subscribed here, which App does before the shell starts: Avalonia does not hold an
        // activation for a handler that arrives later, and a link that launched the app arrives early.
        if (Application.Current?.TryGetFeature<IActivatableLifetime>() is { } activation)
        {
            activation.Activated += (_, e) =>
            {
                if (e.Kind == ActivationKind.Reopen)
                {
                    Show();
                }
                else if (e is ProtocolActivatedEventArgs { Kind: ActivationKind.OpenUri, Uri: { } uri })
                {
                    UriOpened?.Invoke(uri);
                }
            };
        }
    }

    /// <summary>Raised with a link macOS handed the app, a <c>deadair://</c> one being the only kind it registers for.</summary>
    /// <remarks>
    /// macOS delivers it to the instance already running, which is why there is no single-instance
    /// machinery anywhere in this app: a second launch of a bundle is the system's to prevent, and it does.
    /// </remarks>
    public event Action<Uri>? UriOpened;

    /// <summary>Whether a close should hide the window rather than close it.</summary>
    public static bool HidesInsteadOfClosing(WindowCloseReason reason, bool isProgrammatic) =>
        reason == WindowCloseReason.WindowClosing && !isProgrammatic;

    public void Show()
    {
        if (_window.WindowState == WindowState.Minimized)
        {
            _window.WindowState = WindowState.Normal;
        }

        _window.Show();
        _window.Activate();
    }

    public void Hide() => _window.Hide();

    public void Minimize() => _window.WindowState = WindowState.Minimized;

    public void Quit() => _desktop.TryShutdown();
}
