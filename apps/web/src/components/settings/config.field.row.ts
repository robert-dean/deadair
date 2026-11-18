import classes from './config.fields.form.module.css';

/**
 * The `classNames` that lay a Mantine input out as one settings row: label and help on the left, the
 * control on the right, once the form is wide enough for both.
 *
 * One object handed to every input rather than a wrapper component, because the inputs are many
 * (a text box, a select, a slider inside `Input.Wrapper`, a password field, a pill input) and every
 * one of them already accepts the same four slot names. A wrapper would have to re-implement the
 * label and the error that each of them draws for itself.
 */
export const fieldRowClassNames = {
    root: classes.row,
    label: classes.label,
    description: classes.description,
    error: classes.error,
};

/** The same split for a `Switch`, whose label and track are siblings inside its body. */
export const switchRowClassNames = {
    body: classes.switchBody,
    labelWrapper: classes.switchLabelWrapper,
    track: classes.switchTrack,
};

/** The class for a line that belongs under the control rather than under the whole row. */
export const underControlClass = classes.under;

export type FieldRowClassNames = typeof fieldRowClassNames;
