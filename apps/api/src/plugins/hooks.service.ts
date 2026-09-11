import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { ChargeAvantLancement } from '@flow/plugin-sdk';
import { loadEnv } from '../config/env.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { contextePour } from './contexte.js';
import { PluginHostService } from './hote.service.js';

/** Ce que leve un hook qui refuse, ou qui ne repond pas. */
export class RefusDeHook extends ForbiddenException {}

/**
 * Le bus des hooks.
 *
 * Un hook s'execute **dans le chemin de l'operation**, il est attendu, et il
 * peut la refuser. C'est ce qui le distingue d'un evenement -- et ce qui en fait
 * le point le plus delicat du jalon : un plugin lent ralentit tout le monde, un
 * plugin casse arrete tout le monde.
 *
 * D'ou deux regles.
 *
 * **Un delai.** Sans borne, un plugin qui attend un service injoignable
 * bloquerait chaque lancement de l'installation, sans rien dans aucun journal.
 *
 * **Le depassement refuse, il ne laisse pas passer.** C'est le choix qui compte.
 * Un hook est la pour dire oui ou non ; celui qui n'a pas repondu n'a pas dit
 * oui, et poursuivre reviendrait a decider a sa place -- exactement l'inverse de
 * ce qu'on lui a demande. Un plugin qui verifierait une regle metier avant
 * chaque lancement cesserait silencieusement de l'appliquer le jour ou il
 * devient lent. Le refus, lui, se voit tout de suite.
 *
 * Les hooks sont appeles **en serie et dans un ordre stable** : deux plugins qui
 * refusent pour des raisons differentes doivent donner le meme message deux fois
 * de suite, sinon l'exploitant croit a une intermittence.
 */
@Injectable()
export class PluginHooksService {
  private readonly logger = new Logger(PluginHooksService.name);

  constructor(
    private readonly hote: PluginHostService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Demande aux plugins s'ils laissent partir cette execution.
   *
   * Rend la main sans rien dire quand aucun plugin n'accroche : le cas courant
   * ne coute alors rien du tout.
   */
  async avantLancement(charge: ChargeAvantLancement): Promise<void> {
    const abonnes = this.hote.pourHook('execution.avant-lancement');

    if (abonnes.length === 0) return;

    const contexte = requireContext();
    const delai = loadEnv().PLUGIN_HOOK_TIMEOUT_MS;

    for (const plugin of abonnes) {
      const fonction = plugin.instance.hooks?.['execution.avant-lancement'];

      if (!fonction) continue;

      const contextePlugin = contextePour(this.db, plugin.manifest.id, plugin.schema, contexte);

      try {
        await this.borner(Promise.resolve(fonction(contextePlugin, charge)), delai);
      } catch (erreur: unknown) {
        throw this.refus(plugin.manifest.id, plugin.manifest.name, erreur);
      }
    }
  }

  /**
   * Borne une promesse dans le temps.
   *
   * Le minuteur est relache dans les deux cas : un `setTimeout` laisse pendant
   * retient le processus jusqu'a son echeance, et une API qui met cinq secondes
   * a s'arreter pour chaque hook appele serait insupportable a redemarrer.
   */
  private async borner<T>(promesse: Promise<T>, delai: number): Promise<T> {
    let minuteur: NodeJS.Timeout | undefined;

    const echeance = new Promise<never>((_resoudre, rejeter) => {
      minuteur = setTimeout(() => {
        rejeter(new Error(`aucune reponse en ${String(delai)} ms`));
      }, delai);
    });

    try {
      return await Promise.race([promesse, echeance]);
    } finally {
      if (minuteur) clearTimeout(minuteur);
      // La promesse du plugin continue de tourner : rien ne permet de
      // l'interrompre. Son resultat sera ignore, et une exception tardive ne
      // doit pas remonter en « unhandled rejection » -- d'ou ce filet.
      void promesse.catch(() => undefined);
    }
  }

  /**
   * Traduit l'echec d'un hook en refus.
   *
   * Un `RefusPlugin` porte un motif ecrit pour la personne qui lance : il est
   * repris tel quel. Toute autre exception est une panne du plugin, et le
   * message le dit -- sans quoi l'utilisateur chercherait ce qu'il a mal fait
   * devant une erreur qui ne le concerne pas.
   */
  private refus(id: string, nom: string, erreur: unknown): RefusDeHook {
    const estRefus = erreur instanceof Error && erreur.name === 'RefusPlugin';

    if (estRefus) {
      return new RefusDeHook(`${nom} : ${erreur.message}`);
    }

    const detail = erreur instanceof Error ? erreur.message : String(erreur);

    this.logger.error(`${id} a fait echouer un lancement : ${detail}`);

    return new RefusDeHook(
      `Le plugin ${nom} n'a pas pu se prononcer (${detail}). Le lancement est refuse.`,
    );
  }
}
