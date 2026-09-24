import 'i18next';

import type { en } from './en/en.catalog';

// Types `t()` against the English catalog, so a key that does not exist, or a plural called
// without `count`, fails `tsc` instead of rendering the key itself to an operator.
declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'common';
        resources: typeof en;
    }
}
