using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;

namespace Shots;

/// <summary>
/// The window's contents, without the window.
/// </summary>
/// <remarks>
/// A `Window` cannot be the content of another one, and this tool already builds one to render
/// into, so a frame is the app's own <see cref="ShellView"/> inside it: the same control the window
/// holds, rather than a copy of its layout. It used to be a copy, rebuilt here from the sidebar, the
/// page host and the bar, and a copy is a thing that goes out of step the first time the layout moves.
/// </remarks>
internal sealed class MainWindowContent : UserControl
{
    private readonly ShellView _shell = new();

    public MainWindowContent()
    {
        Content = _shell;

        // Nulled so a frame is the page rather than the first instant of a cross-fade into it.
        if (_shell.FindControl<PageHost>("Pages") is { } pages)
        {
            pages.PageTransition = null;
        }
    }

    /// <summary>The shell the frame draws, set on the view so its own bindings hand it on.</summary>
    public ShellViewModel? Shell
    {
        get => _shell.DataContext as ShellViewModel;
        set
        {
            DataContext = value;
            _shell.DataContext = value;
        }
    }
}
