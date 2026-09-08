using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class PlayerBar : UserControl
{
    public PlayerBar()
    {
        InitializeComponent();

        // Opening the picker is what asks the network who is out there. Never a timer: a scan is a
        // broadcast plus a request to every player the operator wrote down, and between opens
        // nobody is looking at the answer.
        if (this.FindControl<Button>("OutputButton")?.Flyout is Flyout flyout)
        {
            flyout.Opening += (_, _) =>
            {
                if (DataContext is ListenerViewModel listener && listener.Outputs is { } outputs)
                {
                    _ = outputs.RescanAsync();
                }
            };
        }
    }
}
