using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class JumpDialogView : UserControl
{
    public JumpDialogView() => InitializeComponent();

    /// <remarks>
    /// The one piece of code-behind a view here has: a palette is a box you type into, and one that
    /// opened without the keyboard would make its own shortcut pointless. Posted, because the box is
    /// not focusable until the dialog layer has been laid out.
    /// </remarks>
    protected override void OnLoaded(RoutedEventArgs e)
    {
        base.OnLoaded(e);
        Dispatcher.UIThread.Post(() => this.FindControl<TextBox>("Box")?.Focus());
    }
}
