import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, negotiateLocale, resources } from '@flow/i18n';

/**
 * Initialisation d'i18next.
 *
 * Les ressources viennent du paquet partage plutot que d'un chargement HTTP :
 * elles sont typees, elles entrent dans le bundle, et une clef manquante est
 * une erreur de compilation au lieu d'un libelle brut a l'ecran.
 *
 * `escapeValue: false` : React echappe deja ce qu'il rend, et laisser i18next le
 * refaire produirait des apostrophes en `&#39;` dans toute l'interface
 * francaise.
 */
void i18next.use(initReactI18next).init({
  resources: Object.fromEntries(
    LOCALES.map((langue) => [langue, { translation: resources[langue] }]),
  ),
  lng: negotiateLocale(typeof navigator === 'undefined' ? null : navigator.language),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

export default i18next;
