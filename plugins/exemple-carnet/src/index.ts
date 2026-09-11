import { definirPlugin, RefusPlugin, type ContextePlugin } from '@flow/plugin-sdk';

/**
 * Le carnet : un plugin de reference, qui exerce **chaque** point d'extension.
 *
 * Il ne cherche pas a etre utile : il cherche a etre complet. Un plugin
 * d'exemple qui n'exercerait qu'un point sur cinq laisserait les quatre autres
 * sans preuve -- et c'est toujours celui qu'on n'a pas eprouve qui casse.
 *
 * Ce qu'il fait, pris ensemble, se tient tout de meme : il tient un carnet de
 * notes sur les executions, et permet de geler un bot dans une branche.
 *
 * | Point d'extension      | Ici                                              |
 * | ---------------------- | ------------------------------------------------ |
 * | schema PostgreSQL      | `notes` et `bots_geles`, avec leurs politiques    |
 * | droits declares        | `note:read`, `note:write`                         |
 * | hook synchrone         | refuse le lancement d'un bot gele                 |
 * | evenements             | note le depart et l'issue de chaque execution     |
 * | emplacement d'interface| le carnet sur la page d'une execution             |
 * | vue                    | `notes`, que l'encart interroge                   |
 * | tache de fond          | efface les notes de plus de trente jours          |
 */

/** Age au-dela duquel une note s'efface, en jours. */
const RETENTION_JOURS = 30;

interface LigneGel extends Record<string, unknown> {
  motif: string;
}

interface LigneCompte extends Record<string, unknown> {
  efface: number;
}

interface LigneNote extends Record<string, unknown> {
  texte: string;
  cree: string;
}

/**
 * Ecrit une note.
 *
 * L'entite vient de l'acteur : une note appartient a la branche au nom de
 * laquelle on travaille, et c'est ce que la politique de la table verifiera.
 */
async function noter(contexte: ContextePlugin, executionId: string, texte: string): Promise<void> {
  const acteur = contexte.acteur;

  if (!acteur) return;

  await contexte.requete(
    'INSERT INTO notes (execution_id, entity_path, texte) VALUES ($1, $2::public.ltree, $3)',
    [executionId, acteur.entityPath, texte],
  );
}

export default definirPlugin({
  id: 'exemple-carnet',
  name: 'Carnet',
  description:
    "Tient un carnet sur les executions, et permet de geler un bot dans une branche. Plugin de reference : il exerce chaque point d'extension.",
  version: '1.0.0',
  author: 'Flow&',

  schema: true,

  rights: [
    {
      object: 'note',
      action: 'read',
      scopes: ['entity', 'recursive', 'all'],
      label: { fr: 'Voir le carnet', en: 'View the notebook' },
    },
    {
      object: 'note',
      action: 'write',
      scopes: ['entity', 'recursive', 'all'],
      label: { fr: 'Ecrire dans le carnet', en: 'Write in the notebook' },
    },
  ],

  surfaces: [{ slot: 'execution.detail', entry: 'interface/carnet.js' }],

  views: [
    {
      name: 'notes',
      // La vue est **sous droit**, et l'encart le sera donc aussi : une note
      // peut dire pourquoi une execution a ete relancee trois fois, ce qui
      // n'est pas destine a tout le monde.
      right: 'note:read',
      run: async (contexte, parametres) => {
        const executionId = parametres['executionId'];

        if (typeof executionId !== 'string' || executionId === '') return [];

        // Aucune clause d'entite : la politique de la table s'en charge, et
        // c'est precisement ce qu'un plugin gagne a declarer la sienne.
        return contexte.requete<LigneNote>(
          `SELECT texte, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS cree
             FROM notes
            WHERE execution_id = $1::uuid
            ORDER BY created_at`,
          [executionId],
        );
      },
    },
  ],

  hooks: {
    /**
     * Refuse le lancement d'un bot gele dans cette branche.
     *
     * Le hook **lit ses propres tables sous le contexte de l'appelant** : la
     * politique de `bots_geles` ne laisse voir que les gels du perimetre. Un gel
     * pose au siege ne bloque donc pas la filiale nord, sans que ce code n'ait
     * une seule clause d'entite.
     */
    'execution.avant-lancement': async (contexte, charge) => {
      const gels = await contexte.requete<LigneGel>(
        'SELECT motif FROM bots_geles WHERE bot_id = $1 AND entity_path = $2::public.ltree',
        [charge.botId, charge.entityPath],
      );

      const gel = gels[0];

      if (gel) {
        // Un refus, pas une panne : le motif est ecrit pour la personne qui
        // vient de cliquer, et c'est elle qui le lira.
        throw new RefusPlugin(`${charge.botName} est gele ici : ${gel.motif}`);
      }
    },
  },

  events: {
    'execution.lancee': async (contexte, charge) => {
      await noter(contexte, charge.executionId, `Lancement de ${charge.botId}.`);
    },

    'execution.terminee': async (contexte, charge) => {
      const duree =
        charge.durationMs === null ? '' : ` en ${String(Math.round(charge.durationMs / 1000))} s`;

      await noter(contexte, charge.executionId, `Issue : ${charge.status}${duree}.`);
    },
  },

  tasks: [
    {
      id: 'purge',
      // Une heure : la retention se compte en jours, et regarder plus souvent ne
      // changerait rien qu'une charge de plus sur la base.
      intervalSeconds: 3600,
      run: async (contexte) => {
        // Une tache tourne **sans acteur** : elle voit toute l'installation.
        // C'est ce qu'il faut pour purger, et c'est pour cela que la requete
        // n'a pas de clause d'entite -- l'absence est ici deliberee.
        const lignes = await contexte.requete<LigneCompte>(
          `WITH partantes AS (
             DELETE FROM notes
              WHERE created_at < now() - ($1 || ' days')::interval
              RETURNING 1
           )
           SELECT count(*)::int AS efface FROM partantes`,
          [String(RETENTION_JOURS)],
        );

        const efface = lignes[0]?.efface ?? 0;

        if (efface > 0) contexte.log('info', `${String(efface)} note(s) effacee(s).`);
      },
    },
  ],
});
