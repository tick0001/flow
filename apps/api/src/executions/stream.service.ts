import { Injectable, Logger, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  isTerminal,
  type ExecutionDetail,
  type ExecutionEvent,
  type ExecutionStreamEvent,
} from '@flow/contracts';
import { requireContext, runWithContext, type FlowContext } from '../common/request-context.js';
import { SessionService } from '../auth/session.service.js';
import { ExecutionsService } from './executions.service.js';
import { ExecutionRelayService } from './relais.service.js';

/**
 * Cadence du battement du flux.
 *
 * Il sert deux choses a la fois. **Tenir la connexion ouverte** : une execution
 * peut ne rien produire pendant des minutes, et un relais inverse ferme un flux
 * silencieux -- sans rien dire, ce qui se diagnostique tres mal. Et **revalider
 * la session** : un flux vit bien plus longtemps qu'une requete, si bien qu'une
 * session fermee ou un compte desactive pendant qu'on regarde continueraient
 * autrement de recevoir jusqu'a la fin de l'execution.
 */
const BATTEMENT_MS = 15_000;

/** Lignes de journal rejouees au plus, a l'ouverture ou a la reprise. */
const REPRISE_MAX = 2000;

/**
 * Le flux d'un lecteur sur une execution.
 *
 * **Server-Sent Events, et non WebSocket** -- ce que l'architecture annoncait.
 * Le choix a change en l'ecrivant, pour trois raisons qui se tiennent :
 *
 *  - le trafic est **entierement descendant**. Le seul geste montant est
 *    « je regarde cette execution-ci », que l'URL dit deja. Un canal
 *    bidirectionnel aurait offert une moitie dont personne ne se sert ;
 *  - la reprise apres coupure est **dans le protocole**. Le navigateur
 *    reconnecte seul et renvoie `Last-Event-ID` ; il ne reste qu'a rejouer ce
 *    qui suit ce rang. En WebSocket, cette mecanique aurait ete a ecrire -- et
 *    c'est precisement le critere de sortie de ce jalon ;
 *  - c'est une **route HTTP ordinaire**. Le cookie de session, les gardes, les
 *    droits et le contexte de requete s'appliquent tels quels. Un WebSocket
 *    passe a cote du pipeline et aurait demande une seconde voie
 *    d'authentification -- c'est-a-dire un second endroit ou se tromper.
 *
 * Ce que cela coute : un flux occupe une des six connexions HTTP/1.1 qu'un
 * navigateur ouvre par origine. En HTTP/2 -- ce que sert n'importe quel relais
 * inverse en production -- la limite disparait. Le jour ou un geste montant
 * apparaitra, c'est ce jour-la qu'il faudra rouvrir la question.
 */
@Injectable()
export class ExecutionStreamService {
  private readonly logger = new Logger(ExecutionStreamService.name);

  constructor(
    private readonly executions: ExecutionsService,
    private readonly relais: ExecutionRelayService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Ouvre le flux d'une execution pour le lecteur courant.
   *
   * Le contexte de requete est capture **maintenant**, synchroniquement : le flux
   * survit a la requete qui l'a ouvert, et le stockage par contexte asynchrone ne
   * le suivrait pas. Chaque lecture en base est ensuite rejouee sous ce contexte,
   * donc sous le meme cloisonnement que n'importe quelle requete.
   */
  ouvrir(executionId: string, dernierRang: number): Observable<MessageEvent> {
    const context = requireContext();

    return new Observable<MessageEvent>((lecteur) => {
      let vivant = true;
      let debrancher: (() => void) | undefined;
      let battement: NodeJS.Timeout | undefined;

      /**
       * Rang de la derniere ligne emise.
       *
       * C'est lui qui evite a la fois le trou et le doublon : les evenements
       * arrives pendant la relecture en base sont mis de cote, puis filtres sur
       * ce rang avant d'etre emis.
       */
      let rangEmis = dernierRang;
      let enDirect = false;
      const enAttente: ExecutionEvent[] = [];

      const emettre = (evenement: ExecutionStreamEvent, rang?: number): void => {
        if (!vivant) return;

        lecteur.next(
          rang === undefined ? { data: evenement } : { data: evenement, id: String(rang) },
        );
      };

      const fermer = (erreur?: unknown): void => {
        if (!vivant) return;

        vivant = false;
        debrancher?.();
        if (battement) clearInterval(battement);

        if (erreur === undefined) lecteur.complete();
        else lecteur.error(erreur);
      };

      const instantane = async (): Promise<ExecutionDetail> => {
        const detail = await runWithContext(context, () => this.executions.get(executionId));

        emettre({ kind: 'snapshot', payload: detail });

        return detail;
      };

      const traiter = (evenement: ExecutionEvent): void => {
        // Tant que la relecture en base n'est pas finie, on met de cote : emettre
        // tout de suite ferait apparaitre une ligne recente avant les anciennes.
        if (!enDirect) {
          enAttente.push(evenement);

          return;
        }

        if (evenement.kind === 'log') {
          if (evenement.payload.seq <= rangEmis) return;

          rangEmis = evenement.payload.seq;
          emettre({ kind: 'log', payload: evenement.payload }, rangEmis);

          return;
        }

        if (evenement.kind === 'status') {
          // L'etat a change : on renvoie l'instantane complet, relu sous le
          // contexte de **ce** lecteur. Le worker ne peut pas le calculer -- il ne
          // sait ni qui regarde, ni ce que chacun a le droit d'interrompre.
          void instantane()
            .then((detail) => {
              if (isTerminal(detail.status)) fermer();
            })
            .catch(() => {
              fermer();
            });

          return;
        }

        emettre(evenement);
      };

      void (async () => {
        try {
          // L'abonnement **avant** la relecture : dans l'autre ordre, une ligne
          // ecrite entre les deux ne serait ni relue ni recue.
          debrancher = await this.relais.abonner(executionId, traiter);

          const detail = await instantane();

          const rappel = await runWithContext(context, () =>
            this.executions.logs(executionId, { afterSeq: dernierRang, limit: REPRISE_MAX }),
          );

          for (const ligne of rappel) {
            rangEmis = ligne.seq;
            emettre({ kind: 'log', payload: ligne }, ligne.seq);
          }

          enDirect = true;

          for (const enRetard of enAttente.splice(0)) {
            traiter(enRetard);
          }

          // Une execution deja terminee n'emettra plus rien : on ferme plutot que
          // de tenir un flux ouvert pour l'eternite. Le navigateur ne reconnecte
          // pas sur une fermeture propre du serveur.
          if (isTerminal(detail.status)) {
            fermer();

            return;
          }

          battement = setInterval(() => {
            void this.battre(context, lecteur, fermer);
          }, BATTEMENT_MS);
        } catch (erreur: unknown) {
          // Execution invisible ou inexistante : le flux se ferme en erreur, et
          // le client verra un 404 sur la requete de detail qu'il fait par
          // ailleurs. Ouvrir un flux vide aurait ressemble a une execution muette.
          this.logger.debug(`Flux ${executionId} refuse : ${String(erreur)}`);
          fermer(erreur);
        }
      })();

      return () => {
        fermer();
      };
    });
  }

  /**
   * Un battement : tient la connexion ouverte et verifie que la session l'est
   * encore.
   *
   * L'evenement porte un **type**, et c'est ce qui le rend invisible : le
   * navigateur ne passe un evenement type qu'a un ecouteur du meme nom, jamais au
   * `onmessage` ordinaire. Le flux reste donc ouvert sans qu'une seule ligne de
   * code cliente ait a l'ignorer, et sans elargir le contrat des evenements.
   */
  private async battre(
    context: FlowContext,
    lecteur: { next: (message: MessageEvent) => void },
    fermer: (erreur?: unknown) => void,
  ): Promise<void> {
    try {
      if (!(await this.sessions.resolveById(context.sessionId))) {
        fermer();

        return;
      }
    } catch (erreur: unknown) {
      // Une base momentanement absente ne doit pas fermer le flux : le battement
      // suivant reessaiera. Fermer ici transformerait un hoquet en deconnexion.
      this.logger.debug(`Revalidation impossible : ${String(erreur)}`);
    }

    lecteur.next({ type: 'battement', data: '' });
  }
}
