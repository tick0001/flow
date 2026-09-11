import type { CDPSession, Page } from 'playwright';
import type { ExecutionFrame } from '@flow/contracts';
import { journalDe } from './log.js';

const log = journalDe('Screencast');

/**
 * Qualite JPEG des images diffusees.
 *
 * Soixante : on regarde un navigateur travailler, pas une photographie. Au-dela,
 * le poids grimpe sans qu'on lise mieux un formulaire ; en deca, le texte des
 * champs devient illisible -- et c'est precisement ce qu'on vient verifier.
 */
const QUALITE = 60;

/**
 * Taille maximale d'une image.
 *
 * Le navigateur tourne en 1280x800 ; les images sont reduites de moitie. Une
 * vue en direct sert a voir **ou en est** le bot, pas a lire le code source de
 * la page -- et diviser la largeur par deux divise le poids par quatre.
 */
const LARGEUR_MAX = 640;
const HAUTEUR_MAX = 400;

/**
 * La vue en direct du navigateur, par le screencast du protocole Chrome DevTools.
 *
 * **Le navigateur produit les images lui-meme, a la cadence des changements
 * d'ecran.** C'est tout l'ecart avec l'outil remplace, qui bouclait sur des
 * captures toutes les 800 ms : il photographiait vingt fois la meme page
 * immobile, et manquait ce qui se passait entre deux prises. Ici, une page qui ne
 * bouge pas ne produit rien, et une page qui defile produit ce qu'il faut.
 *
 * Il faut **acquitter chaque image** : sans `screencastFrameAck`, Chromium cesse
 * d'en envoyer apres quelques-unes. Le piege est silencieux -- la vue se fige,
 * rien n'est journalise -- et c'est la premiere chose a verifier si elle
 * s'arrete.
 */
export class Screencast {
  private session: CDPSession | undefined;
  private demarrage: Promise<void> | undefined;

  constructor(
    private readonly page: Page,
    private readonly surImage: (image: Omit<ExecutionFrame, 'executionId'>) => void,
  ) {}

  get actif(): boolean {
    return this.session !== undefined;
  }

  /**
   * Ouvre la session CDP et lance la diffusion.
   *
   * Idempotente et serialisee : les demandes arrivent d'un message Redis, et deux
   * lecteurs qui ouvrent la page en meme temps produiraient autrement deux
   * sessions, dont une fuirait.
   */
  async demarrer(): Promise<void> {
    if (this.demarrage) return this.demarrage;

    this.demarrage = this.ouvrir().catch((erreur: unknown) => {
      // Une vue en direct qui ne s'ouvre pas ne doit pas emporter l'execution :
      // le bot fait un travail qui compte, et le regarder est un confort.
      log.warn(`Vue en direct impossible : ${String(erreur)}`);
      this.session = undefined;
    });

    return this.demarrage;
  }

  async arreter(): Promise<void> {
    const session = this.session;

    this.session = undefined;
    this.demarrage = undefined;

    if (!session) return;

    try {
      await session.send('Page.stopScreencast');
      await session.detach();
    } catch (erreur: unknown) {
      // Page deja fermee, navigateur deja mort : c'est le cas normal a la fin
      // d'une execution interrompue.
      log.debug(`Arret du screencast : ${String(erreur)}`);
    }
  }

  private async ouvrir(): Promise<void> {
    const session = await this.page.context().newCDPSession(this.page);

    this.session = session;

    session.on('Page.screencastFrame', (image) => {
      // L'acquittement d'abord, et sans attendre : c'est lui qui debloque l'image
      // suivante. Le faire apres la diffusion ferait dependre la cadence de la
      // vitesse de Redis.
      session
        .send('Page.screencastFrameAck', { sessionId: image.sessionId })
        .catch(() => undefined);

      this.surImage({
        data: image.data,
        width: image.metadata.deviceWidth,
        height: image.metadata.deviceHeight,
      });
    });

    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: QUALITE,
      maxWidth: LARGEUR_MAX,
      maxHeight: HAUTEUR_MAX,
    });

    log.debug('Vue en direct ouverte.');
  }
}
