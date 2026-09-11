import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { journalDe } from './log.js';

const log = journalDe('Navigateur');

/**
 * Les navigateurs du worker.
 *
 * **Un navigateur par worker, un contexte par execution.** C'est le partage qui
 * compte : lancer un Chromium par execution couterait une seconde et deux cents
 * mega-octets a chaque run, alors qu'un contexte s'ouvre en quelques
 * millisecondes et isole deja tout ce qui doit l'etre -- cookies, stockage local,
 * session, permissions. Deux executions ne se voient donc jamais, sans payer deux
 * navigateurs.
 *
 * Le lancement est **paresseux** : un worker qui ne recoit rien ne tient pas un
 * Chromium ouvert pour rien. Et il y a deux navigateurs possibles, sans fenetre et
 * avec : les deux modes ne se demandent pas au meme processus, et un seul
 * navigateur aurait oblige a choisir le mode une fois pour toutes au demarrage.
 */
export class Navigateurs {
  private readonly ouverts = new Map<boolean, Browser>();

  /**
   * Ouvre un contexte isole pour une execution.
   *
   * La fenetre est fixee a 1280x800 explicitement. La taille par defaut de
   * Playwright suffirait, mais la rendre explicite rend les runs comparables : un
   * selecteur qui ne trouve son element que sous une certaine largeur -- un menu
   * replie en affichage etroit -- echouerait autrement selon la version de
   * Playwright installee.
   */
  async ouvrirContexte(sansFenetre: boolean): Promise<{ context: BrowserContext; page: Page }> {
    const navigateur = await this.navigateur(sansFenetre);
    const context = await navigateur.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    return { context, page };
  }

  private async navigateur(sansFenetre: boolean): Promise<Browser> {
    const existant = this.ouverts.get(sansFenetre);

    if (existant?.isConnected() === true) return existant;

    log.log(`Lancement de Chromium (${sansFenetre ? 'sans fenetre' : 'avec fenetre'}).`);

    const navigateur = await chromium.launch({ headless: sansFenetre });

    this.ouverts.set(sansFenetre, navigateur);

    return navigateur;
  }

  /** Ferme ce qui est ouvert. Appele a l'arret du worker. */
  async fermerTout(): Promise<void> {
    const navigateurs = [...this.ouverts.values()];

    this.ouverts.clear();

    await Promise.all(
      navigateurs.map(async (navigateur) => {
        try {
          await navigateur.close();
        } catch (erreur: unknown) {
          // Un navigateur deja mort a l'arret n'est pas un probleme : on sort.
          log.debug(`Fermeture du navigateur : ${String(erreur)}`);
        }
      }),
    );
  }
}
