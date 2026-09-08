using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Desktop.Views;

namespace Shots;

/// <summary>
/// The window's contents, without the window.
/// </summary>
/// <remarks>
/// `MainWindow` is a `Window`, and this tool already builds one to render into, so the shell is
/// rebuilt here from the same three controls. That is a copy of a layout, which is worth saying out
/// loud: if the window's own arrangement changes, this has to change with it or the frames stop
/// being pictures of the app. Rendering the real window instead is not available — a Window cannot
/// be the content of another one.
/// </remarks>
internal sealed class MainWindowContent : UserControl
{
    private readonly Sidebar _sidebar = new();
    private readonly PageHost _pages = new()
    {
        // Nulled so a frame is the page rather than the first instant of a cross-fade into it.
        PageTransition = null,
    };

    private readonly PlayerBar _bar = new();

    public MainWindowContent()
    {
        var top = new Grid { ColumnDefinitions = new ColumnDefinitions("220,*") };
        Grid.SetColumn(_pages, 1);
        top.Children.Add(_sidebar);
        top.Children.Add(_pages);

        var root = new Grid { RowDefinitions = new RowDefinitions("*,Auto") };
        Grid.SetRow(_bar, 1);
        root.Children.Add(top);
        root.Children.Add(_bar);

        Content = root;
    }

    /// <summary>
    /// The shell, pushed into the three controls rather than inherited.
    /// </summary>
    /// <remarks>
    /// A property rather than the `DataContextChanged` handler this started as: the handler ran, but
    /// a child that inherits a DataContext and then has one set on it is a different thing from a
    /// child given one outright, and the first render drew both halves of the account at once
    /// because the sidebar's bindings had resolved against nothing.
    /// </remarks>
    public ShellViewModel? Shell
    {
        get => DataContext as ShellViewModel;
        set
        {
            DataContext = value;
            _sidebar.DataContext = value;
            _pages.Shell = value;
            _bar.DataContext = value?.Listener;
        }
    }
}
