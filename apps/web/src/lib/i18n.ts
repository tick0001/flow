import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, negotiateLocale, resources, type Traductions } from '@flow/i18n';

const STORAGE_KEY = 'flow.locale';

/**
 * Initialisation d'i18next.
 *
 * Les ressources viennent du paquet partage plutot que d'un chargement HTTP :
 * elles sont typees, elles entrent dans le bundle, et une clef manquante est
 * une erreur de compilation au lieu d'un libelle brut a l'ecran.
 *
 * La langue choisie passe **avant** celle du navigateur. Sans la preference
 * enregistree, basculer en anglais tenait jusqu'au prochain rechargement, ou
 * l'en-tete du navigateur reprenait la main : le selecteur donnait alors
 * l'impression de ne pas fonctionner.
 *
 * `escapeValue: false` : React echappe deja ce qu'il rend, et laisser i18next le
 * refaire produirait des apostrophes en `&#39;` dans toute l'interface
 * francaise.
 */
void i18next.use(initReactI18next).init({
  lng: negotiateLocale(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
    typeof navigator === 'undefined' ? null : navigator.language,
  ),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...LOCALES],
  resources: Object.fromEntries(
    LOCALES.map((langue) => [langue, { translation: resources[langue] }]),
  ),
  interpolation: { escapeValue: false },
});

export function changerLangue(locale: string): void {
  void i18next.changeLanguage(locale);
  localStorage.setItem(STORAGE_KEY, locale);
}

/** Typage des clefs : `t('entites.titre')` est verifie a la compilation. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Traductions };
  }
}

export default i18next;
