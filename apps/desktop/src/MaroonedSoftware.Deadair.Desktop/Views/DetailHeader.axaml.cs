using Avalonia;
using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class DetailHeader : UserControl
{
    /// <summary>What a page adds under its rating: a link onward, a menu of repairs.</summary>
    public static readonly StyledProperty<object?> ExtraProperty =
        AvaloniaProperty.Register<DetailHeader, object?>(nameof(Extra));

    public DetailHeader() => InitializeComponent();

    public object? Extra
    {
        get => GetValue(ExtraProperty);
        set => SetValue(ExtraProperty, value);
    }
}
