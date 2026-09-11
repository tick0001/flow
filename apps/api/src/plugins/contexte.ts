import { Logger } from '@nestjs/common';
import { sql, type RequestContext, type SQL, type Transaction } from '@flow/db';
import type { ContextePlugin, NiveauJournal } from '@flow/plugin-sdk';
import type { DatabaseService } from '../database/database.service.js';

/** Un identifiant de schema sur, verifie avant d'etre concatene. */
const SCHEMA_VALIDE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Transforme une requete a parametres positionnels en requete Drizzle.
 *
 * Le plugin ecrit `$1`, `$2`, comme il le ferait avec le pilote PostgreSQL. Le
 * texte litteral passe tel quel ; **les valeurs, elles, sont liees** -- jamais
 * concatenees. C'est la seule forme offerte au plugin, et c'est ce qui empeche
 * qu'un plugin mal ecrit ouvre une injection dans la base de quelqu'un d'autre.
 *
 * `$$` d'une chaine dollar-quotee n'est pas touche : le motif exige des chiffres
 * apres le dollar.
 */
export function lier(texte: string, valeurs: readonly unknown[]): SQL {
  const morceaux = texte.split(/\$(\d+)/);
  const parties: SQL[] = [];

  for (const [index, morceau] of morceaux.entries()) {
    if (index % 2 === 0) {
      if (morceau !== '') parties.push(sql.raw(morceau));

      continue;
    }

    const rang = Number(morceau);
    const valeur = valeurs[rang - 1];

    if (rang > valeurs.length) {
      throw new Error(`Parametre $${morceau} sans valeur : ${String(valeurs.length)} fournie(s).`);
    }

    parties.push(sql`${valeur}`);
  }

  return sql.join(parties);
}

/**
 * Pose le chemin de recherche sur le schema du plugin, puis sur `public`.
 *
 * Ses tables se nomment donc sans prefixe, et celles du coeur restent lisibles.
 * `LOCAL` borne le reglage a la transaction : une connexion rendue au pool ne
 * garde pas le chemin d'un plugin pour la requete suivante, qui serait celle de
 * quelqu'un d'autre.
 */
async function poserLeChemin(tx: Transaction, schema: string | null): Promise<void> {
  if (schema === null) return;

  if (!SCHEMA_VALIDE.test(schema)) {
    throw new Error(`Nom de schema refuse : ${schema}`);
  }

  await tx.execute(sql.raw(`SET LOCAL search_path TO ${schema}, public`));
}

/**
 * Fabrique le contexte remis a un plugin.
 *
 * Deux modes, et la difference est celle qui compte :
 *
 *  - **avec contexte de requete** -- un hook, un evenement : la transaction passe
 *    par le role applicatif et porte les parametres de session. Les politiques
 *    de Row-Level Security s'appliquent aux tables du plugin comme a celles du
 *    coeur. Un plugin ne voit alors que ce que voit la personne au nom de qui il
 *    travaille ;
 *
 *  - **sans contexte** -- une tache de fond : personne ne l'a demandee, il n'y a
 *    donc pas de perimetre a poser. La transaction passe par le role
 *    proprietaire et **voit tout**. C'est assume et non subi : une purge
 *    periodique qui ne verrait rien ne purgerait rien. Un plugin qui ecrit une
 *    tache doit savoir qu'il y travaille sur l'installation entiere.
 */
export function contextePour(
  db: DatabaseService,
  pluginId: string,
  schema: string | null,
  contexte: RequestContext | null,
): ContextePlugin {
  const logger = new Logger(`Plugin:${pluginId}`);

  const executer = async <L extends Record<string, unknown>>(
    texte: string,
    valeurs: readonly unknown[],
  ): Promise<L[]> => {
    const travail = async (tx: Transaction): Promise<L[]> => {
      await poserLeChemin(tx, schema);

      const resultat = await tx.execute(lier(texte, valeurs));

      // Drizzle contraint ses lignes a sa propre forme ; le plugin annonce la
      // sienne. Personne ne peut verifier la seconde a la compilation -- elle
      // depend d'un SQL ecrit ailleurs --, et la forcer ici est plus honnete
      // que d'exiger du plugin qu'il la redecrive deux fois.
      return resultat.rows as unknown as L[];
    };

    return contexte === null ? db.asOwner(travail) : db.asContext(contexte, travail);
  };

  return {
    log: (niveau: NiveauJournal, message: string) => {
      // Le journal du plugin est celui de l'API, prefixe de son identifiant : un
      // plugin bavard se retrouve et se coupe sans avoir a deviner qui parle.
      if (niveau === 'error') logger.error(message);
      else if (niveau === 'warn') logger.warn(message);
      else if (niveau === 'debug') logger.debug(message);
      else logger.log(message);
    },
    requete: <L extends Record<string, unknown> = Record<string, unknown>>(
      texte: string,
      valeurs: readonly unknown[] = [],
    ): Promise<L[]> => executer<L>(texte, valeurs),
    acteur:
      contexte === null
        ? null
        : {
            userId: contexte.userId,
            profileId: contexte.profileId,
            entityPath: contexte.entityPath,
          },
  };
}
