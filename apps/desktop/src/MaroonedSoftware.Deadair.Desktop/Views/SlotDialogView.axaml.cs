using Avalonia;
using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class SlotDialogView : UserControl
{
    /// <summary>What the dialog's own chrome takes: its padding, the title, the problem line and the buttons.</summary>
    private const double Chrome = 240;

    public SlotDialogView() => InitializeComponent();

    /// <summary>
    /// Lets the fields have the window's height less the dialog's chrome, so the buttons stay on
    /// screen at the minimum window and the fields scroll.
    /// </summary>
    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);

        if (TopLevel.GetTopLevel(this) is { } top)
        {
            Fields.MaxHeight = Math.Max(200, top.ClientSize.Height - Chrome);
        }
    }
}
