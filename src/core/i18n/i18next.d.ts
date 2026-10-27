import 'i18next';
import type { IndonesianCopy } from './locales/id';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    returnNull: false;
    resources: {
      translation: IndonesianCopy;
    };
  }
}
