using Avalonia.Controls;
using Avalonia.Input;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        AddHandler(KeyDownEvent, OnKeyDown, Avalonia.Interactivity.RoutingStrategies.Tunnel);
    }

    /// <summary>
    /// The rail's letters, without a modifier, as the web console has them.
    /// </summary>
    /// <remarks>
    /// Tunnelled so the rail responds before anything else sees the key, and skipped entirely while a
    /// text box has focus — otherwise typing a station address or a password navigates away
    /// mid-word.
    /// </remarks>
    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (DataContext is not ShellViewModel shell || shell.NeedsStation)
        {
            return;
        }

        // A Slider is not a TextBox and takes no letters, but it does take focus — so with the
        // volume slider focused, pressing "d" would navigate to the desk mid-drag.
        if (e.KeyModifiers != KeyModifiers.None || FocusManager?.GetFocusedElement() is TextBox or Slider)
        {
            return;
        }

        foreach (var item in shell.Navigation.Items)
        {
            if (item.IsVisible && string.Equals(item.Key, e.Key.ToString(), System.StringComparison.OrdinalIgnoreCase))
            {
                shell.Navigation.Show(item.Entry.Destination);
                e.Handled = true;
                return;
            }
        }
    }
}
