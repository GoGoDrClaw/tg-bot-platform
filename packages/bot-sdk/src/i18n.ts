/**
 * I18n system for multi-language bot support
 */

export type Translations<T extends string = string> = Record<string, Record<T, string>>;

export class I18n<T extends string = string> {
  private lang: string;
  private translations: Translations<T>;
  private fallbackLang: string;

  constructor(translations: Translations<T>, defaultLang: string = 'en-US') {
    this.translations = translations;
    this.fallbackLang = defaultLang;
    this.lang = defaultLang;
  }

  /**
   * Set current language
   * Supports various formats: ru-RU, ru-ru, ruRU, ru, en, en-US, etc.
   */
  setLanguage(language: string): void {
    const normalized = this.normalizeLanguage(language);

    // Check if language exists in translations
    if (this.translations[normalized]) {
      this.lang = normalized;
    } else {
      // Try to find by language code only (e.g., "ru" -> "ru-RU")
      const langCode = normalized.split('-')[0];
      const found = Object.keys(this.translations).find(key => key.toLowerCase().startsWith(langCode));

      if (found) {
        this.lang = found;
      } else {
        this.lang = this.fallbackLang;
      }
    }
  }

  /**
   * Normalize language code to standard format
   * Examples: ru -> ru-RU, en -> en-US, ruRU -> ru-RU
   */
  private normalizeLanguage(lang: string): string {
    const lower = lang.toLowerCase().replace(/[_]/g, '-');

    // Common mappings
    const mappings: Record<string, string> = {
      'ru': 'ru-RU',
      'en': 'en-US',
      'de': 'de-DE',
      'fr': 'fr-FR',
      'es': 'es-ES',
      'it': 'it-IT',
      'pt': 'pt-BR',
      'zh': 'zh-CN',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
    };

    // If it's just language code, use mapping
    if (mappings[lower]) {
      return mappings[lower];
    }

    // If it's already in format xx-XX, normalize it
    if (lower.includes('-')) {
      const [langCode, countryCode] = lower.split('-');
      return `${langCode}-${countryCode.toUpperCase()}`;
    }

    // If it's in format xxXX, convert to xx-XX
    if (lower.length === 4 || lower.length === 5) {
      const langCode = lower.slice(0, 2);
      const countryCode = lower.slice(2).replace(/^[-_]/, '');
      return `${langCode}-${countryCode.toUpperCase()}`;
    }

    return lower;
  }

  /**
   * Translate a key with optional parameter substitution
   * @param key - Translation key
   * @param params - Parameters to substitute in translation string
   */
  t(key: T, params?: Record<string, string | number>): string {
    let text = this.translations[this.lang]?.[key];

    // Fallback to default language if key not found
    if (text === undefined) {
      text = this.translations[this.fallbackLang]?.[key];
    }

    // If still not found, return key itself
    if (text === undefined) {
      return key;
    }

    // Replace parameters
    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
      });
    }

    return text;
  }

  /**
   * Format date/time according to current language locale
   */
  formatDateTime(date: Date, options?: Intl.DateTimeFormatOptions): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    };

    return date.toLocaleString(this.lang, defaultOptions);
  }

  /**
   * Format date only (without time)
   */
  formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...options,
    };

    return date.toLocaleDateString(this.lang, defaultOptions);
  }

  /**
   * Format time only (without date)
   */
  formatTime(date: Date, options?: Intl.DateTimeFormatOptions): string {
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    };

    return date.toLocaleTimeString(this.lang, defaultOptions);
  }

  /**
   * Format number according to current language locale
   */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return value.toLocaleString(this.lang, options);
  }

  /**
   * Get current language code
   */
  get language(): string {
    return this.lang;
  }

  /**
   * Get available languages
   */
  get availableLanguages(): string[] {
    return Object.keys(this.translations);
  }

  /**
   * Check if translation key exists
   */
  has(key: T): boolean {
    return this.translations[this.lang]?.[key] !== undefined ||
           this.translations[this.fallbackLang]?.[key] !== undefined;
  }
}

/**
 * Create i18n instance with type-safe translation keys
 *
 * @example
 * ```typescript
 * const translations = {
 *   'en-US': {
 *     welcome: 'Welcome!',
 *     greeting: 'Hello, {name}!',
 *   },
 *   'ru-RU': {
 *     welcome: 'Добро пожаловать!',
 *     greeting: 'Привет, {name}!',
 *   },
 * };
 *
 * const i18n = createI18n(translations, 'en-US');
 * i18n.t('welcome'); // "Welcome!"
 * i18n.t('greeting', { name: 'John' }); // "Hello, John!"
 *
 * i18n.setLanguage('ru');
 * i18n.t('welcome'); // "Добро пожаловать!"
 * ```
 */
export function createI18n<T extends string>(
  translations: Translations<T>,
  defaultLang: string = 'en-US'
): I18n<T> {
  return new I18n<T>(translations, defaultLang);
}
