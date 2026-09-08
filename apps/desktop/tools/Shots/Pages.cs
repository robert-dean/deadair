using System.Net;
using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;
using MaroonedSoftware.Deadair.Sdk.Models;
using Destination = MaroonedSoftware.Deadair.Desktop.Navigation.Destination;

namespace Shots;

/// <summary>
/// The pages, filled with the kind of thing a real station answers with.
/// </summary>
/// <remarks>
/// The data matters as much as the layout. A page full of one-word rows looks fine and tells you
/// nothing about what happens to a long persona style, a wrapped talk break or a module name that
/// runs past its column — which is where a layout actually goes wrong.
/// </remarks>
internal static class Pages
{
    /// <param name="Width">The window this frame is drawn in. The default is the app's own; the
    /// minimum is what the window may be dragged down to, which is where a layout clips.</param>
    public static IEnumerable<(string Name, Control Page, int Width, int Height)> All()
    {
        yield return ("shell-desk", Shell(operatorSignedIn: false), 1180, 720);
        yield return ("shell-desk-operator", Shell(operatorSignedIn: true), 1180, 720);
        yield return ("shell-min", Shell(operatorSignedIn: true), 820, 520);
        yield return ("shell-desk-live", Shell(operatorSignedIn: false, Fakes.WithoutAPlayhead), 1180, 720);
        yield return ("shell-desk-warming-up", Shell(operatorSignedIn: false, Fakes.WarmingUp), 1180, 720);
        yield return ("shell-desk-off-air", Shell(operatorSignedIn: false, Fakes.OffAir), 1180, 720);
        yield return ("shell-desk-stale", Shell(operatorSignedIn: false, Fakes.Stale), 1180, 720);
        yield return ("shell-history", Page(new Destination.History(), operatorSignedIn: false), 1180, 720);
        yield return ("shell-library", Page(new Destination.Library(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-settings", Page(new Destination.Settings(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-programme", Page(new Destination.Programme(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-checkup", Page(new Destination.Checkup(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-voice", Page(new Destination.Voice(), operatorSignedIn: true), 1180, 720);
        yield return ("shell-voice-said", Page(new Destination.Voice(), operatorSignedIn: true, VoiceTab.Said), 1180, 720);
        yield return ("player-bar", Bar(), 1180, 720);
        yield return ("sidebar", Rail(operatorSignedIn: true), 1180, 720);
        yield return ("sidebar-signed-out", Rail(operatorSignedIn: false), 1180, 720);
        yield return ("login", SignIn(revealed: false), 1180, 720);
        yield return ("login-revealed", SignIn(revealed: true), 1180, 720);
    }

    /// <summary>
    /// The whole window: sidebar, page and bar.
    /// </summary>
    /// <remarks>
    /// The only frame that shows what this app now IS, and the only one that catches the things that
    /// go wrong between three controls rather than inside one — a bar overflowing its column, a hero
    /// clipping beside the operator card.
    /// </remarks>
    private static MainWindowContent Shell(bool operatorSignedIn, Action<ListenerViewModel>? pose = null)
    {
        var shell = Fakes.Shell(operatorSignedIn);
        Fakes.PutOnAir(shell.Listener);
        pose?.Invoke(shell.Listener);

        if (operatorSignedIn)
        {
            Fakes.PutTheDeskOnAir(shell);
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A page other than the desk, inside the shell, so the bar and the sidebar are in frame.</summary>
    private static MainWindowContent Page(Destination destination, bool operatorSignedIn, VoiceTab? tab = null)
    {
        var shell = Fakes.Shell(operatorSignedIn);
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, destination);
        shell.Navigation.Show(destination);

        if (tab is { } open)
        {
            shell.Voice.ShowTabCommand.Execute(open.ToString());
        }

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>The sidebar, signed in, so every section and both states of an entry are in frame.</summary>
    private static Border Rail(bool operatorSignedIn) =>
        new()
        {
            Width = 220,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left,
            Child = new Sidebar { DataContext = Fakes.Shell(operatorSignedIn) },
        };

    /// <summary>The sign-in panel at the width the sidebar's flyout gives it.</summary>
    private static Border SignIn(bool revealed)
    {
        var login = Fakes.Shell(operatorSignedIn: false).Login;
        login.Email = "marla@deanhome.app";

        // A real one's length, so the box is shown holding what somebody actually pasted into it.
        login.Password = "correct-horse-battery-staple";

        var view = new LoginView { DataContext = login };

        // After attach, not before. The panel deliberately turns the reveal off every time it is
        // shown, so a pose set at construction is undone by the time the frame is captured — which
        // is the tool proving the app's own rule rather than working around it.
        if (revealed)
        {
            view.AttachedToVisualTree += (_, _) => view.Reveal(revealed: true);
        }

        return new Border
        {
            Width = 320,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top,
            Background = null,
            Child = view,
        };
    }

    /// <summary>The bar on its own, at the width it really gets, so its columns can be looked at.</summary>
    private static PlayerBar Bar()
    {
        var shell = Fakes.Shell(operatorSignedIn: false);
        Fakes.PutOnAir(shell.Listener);

        return new PlayerBar { DataContext = shell.Listener };
    }

}
