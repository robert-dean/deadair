using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class ShellView : UserControl
{
    public ShellView()
    {
        InitializeComponent();

        // The Playing on strip opens the bar's picker, and opening it asks the network who is out
        // there exactly as the bar's button does. Never a timer; see PlayerBar.
        if (this.FindControl<Button>("PlayingOnStrip")?.Flyout is Flyout flyout)
        {
            flyout.Opening += (_, _) =>
            {
                if (DataContext is ShellViewModel { Listener.Outputs: { } outputs })
                {
                    _ = outputs.RescanAsync();
                }
            };
        }
    }
}
