using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace MaroonedSoftware.Deadair.Desktop.Views;

/// <summary>
/// Studio's view. Its code is the resting behaviour: the controls and the pointer go once nobody has
/// moved the mouse for a few seconds, and come back the moment somebody does.
/// </summary>
public partial class StudioView : UserControl
{
    private static readonly TimeSpan Still = TimeSpan.FromSeconds(3);
    private static readonly Cursor NoPointer = new(StandardCursorType.None);

    private DispatcherTimer? _rest;

    public StudioView()
    {
        InitializeComponent();
        PointerMoved += (_, _) => Wake();
        PointerPressed += (_, _) => Wake();
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property != IsVisibleProperty)
        {
            return;
        }

        if (IsVisible)
        {
            // Focus comes here so that whatever had it underneath, a search box most likely, gives
            // it up: the window's keys stand down while a text box is focused, and Space would type
            // into a box nobody can see instead of stopping the station.
            Focus();
            Wake();
        }
        else
        {
            _rest?.Stop();
            Classes.Remove("idle");
            Cursor = null;
        }
    }

    private void Wake()
    {
        Classes.Remove("idle");
        Cursor = null;

        if (_rest is null)
        {
            _rest = new DispatcherTimer { Interval = Still };
            _rest.Tick += (_, _) => Rest();
        }

        _rest.Stop();
        _rest.Start();
    }

    private void Rest()
    {
        _rest?.Stop();

        if (!IsVisible)
        {
            return;
        }

        // Not while the pointer is resting on a button somebody may be about to press.
        if (this.GetVisualDescendants().OfType<Button>().Any(button => button.IsPointerOver))
        {
            _rest?.Start();
            return;
        }

        Classes.Add("idle");
        Cursor = NoPointer;
    }
}
