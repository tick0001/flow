import { CronExpressionParser } from 'cron-parser';

/** Nombre de declenchements rendus par l'apercu. */
const APERCU = 5;

export interface Analyse {
  valid: boolean;
  error: string | null;
  next: Date[];
}

/**
 * Analyse une expression cron, et rend ses prochains declenchements.
 *
 * **Le meme analyseur sert l'apercu et le declenchement.** Un apercu calcule par
 * une autre bibliotheque -- ou par une regle ecrite a la main pour l'interface --
 * mentirait tot ou tard, et le mensonge ne se verrait qu'a trois heures du matin.
 */
export function analyser(expression: string, timezone: string, depuis = new Date()): Analyse {
  try {
    const iterateur = CronExpressionParser.parse(expression, {
      tz: timezone,
      currentDate: depuis,
    });

    const next: Date[] = [];

    for (let index = 0; index < APERCU; index += 1) {
      next.push(iterateur.next().toDate());
    }

    return { valid: true, error: null, next };
  } catch (erreur: unknown) {
    return {
      valid: false,
      error: erreur instanceof Error ? erreur.message : String(erreur),
      next: [],
    };
  }
}

/**
 * Le prochain declenchement apres un instant donne.
 *
 * **Calcule depuis maintenant, et non depuis l'occurrence manquee.** C'est la
 * decision qui compte dans tout ce fichier : une installation arretee tout un
 * week-end a manque des dizaines d'occurrences d'une planification horaire. Les
 * rattraper produirait une rafale au redemarrage -- des dizaines de navigateurs
 * lances d'un coup, sur des donnees dont la fenetre est passee.
 *
 * Une occurrence manquee est donc **perdue**, et c'est le bon comportement pour
 * de l'automatisation de navigateur : ce qu'un bot devait faire a neuf heures
 * n'a plus de sens a dix-sept. Un traitement qui doit imperativement passer se
 * declenche par l'API, ou l'appelant sait quoi faire d'un echec.
 */
export function prochain(expression: string, timezone: string, depuis = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(expression, { tz: timezone, currentDate: depuis })
      .next()
      .toDate();
  } catch {
    return null;
  }
}

/**
 * Le fuseau est-il connu de cette machine ?
 *
 * Verifie a la creation plutot qu'au declenchement : une planification posee
 * avec `Europe/Pris` se declencherait sinon jamais, en silence, et personne ne
 * saurait dire pourquoi avant d'avoir relu la ligne en base.
 */
export function fuseauConnu(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr', { timeZone: timezone });

    return true;
  } catch {
    return false;
  }
}
