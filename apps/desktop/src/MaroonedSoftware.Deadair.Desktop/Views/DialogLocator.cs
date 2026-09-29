using Avalonia.Controls;
using Avalonia.Controls.Templates;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace MaroonedSoftware.Deadair.Desktop.Views;

/// <summary>
/// Draws a dialog's view model as the view named after it.
/// </summary>
/// <remarks>
/// By name, so a new dialog is a view model and a view and nothing else: no list of templates in the
/// host that every page's dialogs have to be added to. <c>FooDialogViewModel</c> in ViewModels draws
/// as <c>FooDialogView</c> in Views, and one without a view says so on screen rather than drawing a
/// blank card, because a blank card over the page is a dialog nobody can answer.
/// </remarks>
public sealed class DialogLocator : IDataTemplate
{
    public Control? Build(object? param)
    {
        if (param is null)
        {
            return null;
        }

        var name = param.GetType().FullName!
            .Replace(".ViewModels.", ".Views.", StringComparison.Ordinal)
            .Replace("DialogViewModel", "DialogView", StringComparison.Ordinal);

        return Type.GetType(name) is { } type && Activator.CreateInstance(type) is Control view
            ? view
            : new TextBlock { Text = $"No view for {param.GetType().Name}." };
    }

    public bool Match(object? data) => data is DialogViewModel;
}
