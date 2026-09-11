import { Injectable } from '@nestjs/common';
import type {
  ApercuStats,
  BotStats,
  ExecutionStatus,
  GroupeEchec,
  JourStats,
  Pilotage,
  StatsQuery,
} from '@flow/contracts';
import { executions, sql, type SQL } from '@flow/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { SIGNATURE_SQL } from './signature.js';

/** Causes d'echec distinctes rendues. Au-dela, la liste cesse d'etre lisible. */
const GROUPES = 10;

/** Bots rendus dans le classement. */
const BOTS = 10;

@Injectable()
export class StatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rights: RightsService,
  ) {}

  /**
   * Tout l'ecran de pilotage, en un appel.
   *
   * Quatre requetes plutot que quatre routes : elles portent sur la meme periode
   * et le meme perimetre, et les separer ferait afficher des chiffres calcules a
   * des instants differents -- un total qui ne correspond pas a la somme de la
   * tendance juste en dessous.
   */
  async pilotage(requete: StatsQuery): Promise<Pilotage> {
    const bornes = await this.bornes(requete);

    const [apercu, tendance, bots, echecs] = await Promise.all([
      this.apercu(bornes),
      this.tendance(bornes, requete.jours),
      this.parBot(bornes),
      this.echecs(bornes),
    ]);

    return { jours: requete.jours, apercu, tendance, bots, echecs };
  }

  /**
   * Les conditions communes : la periode, la portee du droit, le bot vise.
   *
   * Le cloisonnement par entite, lui, ne figure pas ici : il vient des politiques
   * de Row-Level Security, alimentees par la transaction. Une clause de plus
   * serait une seconde verite, qui finirait par diverger de la premiere.
   */
  private async bornes(requete: StatsQuery): Promise<SQL> {
    const context = requireContext();
    const portee = await this.rights.scopeFor(context.profileId, 'stats', 'read');
    const conditions: SQL[] = [
      sql`x.created_at >= now() - ${`${String(requete.jours)} days`}::interval`,
    ];

    if (portee === 'own') conditions.push(sql`x.requested_by = ${context.userId}`);
    if (portee === 'entity') conditions.push(sql`x.entity_id = ${context.entityId}`);
    if (requete.botId) conditions.push(sql`x.bot_id = ${requete.botId}`);

    return sql.join(conditions, sql` AND `);
  }

  private async apercu(bornes: SQL): Promise<ApercuStats> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ status: ExecutionStatus; total: number }>(sql`
        SELECT x.status, count(*)::int AS total
          FROM ${executions} x
         WHERE ${bornes}
         GROUP BY x.status
      `);

      return resultat.rows;
    });

    const durees = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ mediane: number | null; p95: number | null }>(sql`
        SELECT
          percentile_cont(0.5)  WITHIN GROUP (ORDER BY x.duration_ms)::int AS mediane,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY x.duration_ms)::int AS p95
          FROM ${executions} x
         WHERE ${bornes}
           AND x.duration_ms IS NOT NULL
      `);

      return resultat.rows[0];
    });

    const parStatut: Partial<Record<ExecutionStatus, number>> = {};
    let total = 0;

    for (const ligne of lignes) {
      parStatut[ligne.status] = ligne.total;
      total += ligne.total;
    }

    // Le taux porte sur les executions **terminees** : celles qui courent encore
    // ne sont ni des reussites ni des echecs, et les compter d'un cote ou de
    // l'autre ferait bouger le chiffre a chaque rafale de lancements.
    const reussies = parStatut.succeeded ?? 0;
    const terminees =
      reussies + (parStatut.failed ?? 0) + (parStatut.cancelled ?? 0) + (parStatut.abandoned ?? 0);

    return {
      total,
      parStatut: parStatut as Record<ExecutionStatus, number>,
      tauxReussite: terminees === 0 ? null : reussies / terminees,
      medianeMs: durees?.mediane ?? null,
      p95Ms: durees?.p95 ?? null,
    };
  }

  /**
   * La tendance jour par jour.
   *
   * `generate_series` fournit **tous** les jours de la periode, y compris ceux
   * sans execution. Sans lui, une courbe sauterait les week-ends et les jours
   * calmes, ce qui la rendrait non seulement fausse mais rassurante : un creux
   * disparait, et l'on ne voit pas que rien n'a tourne.
   */
  private async tendance(bornes: SQL, jours: number): Promise<JourStats[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{
        jour: string;
        reussies: number;
        echouees: number;
        autres: number;
      }>(sql`
        WITH calendrier AS (
          SELECT generate_series(
            date_trunc('day', now() - ${`${String(jours - 1)} days`}::interval),
            date_trunc('day', now()),
            '1 day'::interval
          ) AS jour
        ),
        comptes AS (
          SELECT date_trunc('day', x.created_at) AS jour,
                 count(*) FILTER (WHERE x.status = 'succeeded')::int AS reussies,
                 count(*) FILTER (WHERE x.status = 'failed')::int    AS echouees,
                 count(*) FILTER (WHERE x.status NOT IN ('succeeded', 'failed'))::int AS autres
            FROM ${executions} x
           WHERE ${bornes}
           GROUP BY 1
        )
        SELECT to_char(c.jour, 'YYYY-MM-DD') AS jour,
               COALESCE(k.reussies, 0) AS reussies,
               COALESCE(k.echouees, 0) AS echouees,
               COALESCE(k.autres, 0)   AS autres
          FROM calendrier c
          LEFT JOIN comptes k ON k.jour = c.jour
         ORDER BY c.jour
      `);

      return resultat.rows.map((ligne) => ({
        jour: new Date(`${ligne.jour}T00:00:00Z`),
        reussies: ligne.reussies,
        echouees: ligne.echouees,
        autres: ligne.autres,
      }));
    });
  }

  /** Ce que chaque bot a produit, du plus lance au moins lance. */
  private async parBot(bornes: SQL): Promise<BotStats[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{
        botId: string;
        botName: string;
        total: number;
        echouees: number;
        terminees: number;
        medianeMs: number | null;
        dernierEchec: string | null;
      }>(sql`
        SELECT x.bot_id AS "botId",
               -- Le nom le plus recent : un bot renomme doit apparaitre une
               -- fois, sous son nom d'aujourd'hui, et non deux fois.
               (array_agg(x.bot_name ORDER BY x.created_at DESC))[1] AS "botName",
               count(*)::int AS total,
               count(*) FILTER (WHERE x.status = 'failed')::int AS echouees,
               count(*) FILTER (WHERE x.status IN ('succeeded','failed','cancelled','abandoned'))::int
                 AS terminees,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY x.duration_ms)::int AS "medianeMs",
               to_char(max(x.finished_at) FILTER (WHERE x.status = 'failed'),
                       'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "dernierEchec"
          FROM ${executions} x
         WHERE ${bornes}
         GROUP BY x.bot_id
         ORDER BY total DESC
         LIMIT ${BOTS}
      `);

      return resultat.rows.map((ligne) => ({
        botId: ligne.botId,
        botName: ligne.botName,
        total: ligne.total,
        echouees: ligne.echouees,
        tauxReussite:
          ligne.terminees === 0 ? null : (ligne.terminees - ligne.echouees) / ligne.terminees,
        medianeMs: ligne.medianeMs,
        dernierEchec: ligne.dernierEchec === null ? null : new Date(ligne.dernierEchec),
      }));
    });
  }

  /**
   * Les causes d'echec, regroupees par signature.
   *
   * **C'est la reponse a « qu'est-ce qui casse le plus souvent, et depuis
   * quand »** : le compte donne la premiere moitie, `premierVu` la seconde.
   *
   * Un exemple reel accompagne chaque groupe. La signature seule --
   * « page.goto: Timeout <n>ms exceeded. Call log: - navigating to <adresse> » --
   * se reconnait mal ; le message d'origine la rend immediatement familiere.
   */
  private async echecs(bornes: SQL): Promise<GroupeEchec[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{
        signature: string;
        exemple: string;
        exempleExecutionId: string;
        bots: { botId: string; botName: string; total: number }[];
        total: number;
        premierVu: string;
        dernierVu: string;
      }>(sql`
        WITH causes AS (
          SELECT ${sql.raw(SIGNATURE_SQL)} AS signature,
                 x.id, x.message, x.bot_id, x.bot_name, x.created_at
            FROM ${executions} x
           WHERE ${bornes}
             AND x.status = 'failed'
             AND x.message IS NOT NULL
        ),
        par_bot AS (
          SELECT c.signature,
                 c.bot_id,
                 (array_agg(c.bot_name ORDER BY c.created_at DESC))[1] AS bot_name,
                 count(*)::int AS total
            FROM causes c
           GROUP BY c.signature, c.bot_id
        )
        SELECT c.signature,
               (array_agg(c.message ORDER BY c.created_at DESC))[1] AS exemple,
               (array_agg(c.id::text ORDER BY c.created_at DESC))[1] AS "exempleExecutionId",
               count(*)::int AS total,
               to_char(min(c.created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "premierVu",
               to_char(max(c.created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "dernierVu",
               (SELECT jsonb_agg(
                         jsonb_build_object('botId', p.bot_id, 'botName', p.bot_name, 'total', p.total)
                         ORDER BY p.total DESC, p.bot_name
                       )
                  FROM par_bot p
                 WHERE p.signature = c.signature) AS bots
          FROM causes c
         GROUP BY c.signature
         ORDER BY total DESC, "dernierVu" DESC
         LIMIT ${GROUPES}
      `);

      return resultat.rows.map((ligne) => ({
        signature: ligne.signature,
        exemple: ligne.exemple,
        exempleExecutionId: ligne.exempleExecutionId,
        bots: ligne.bots,
        total: ligne.total,
        premierVu: new Date(ligne.premierVu),
        dernierVu: new Date(ligne.dernierVu),
      }));
    });
  }

  /**
   * Les executions de la periode, en CSV.
   *
   * **Borne, et le dit.** Un export silencieusement tronque est pire qu'un export
   * refuse : on ouvre le fichier, on compte, et l'on conclut que le mois a ete
   * calme. L'appelant recoit donc un en-tete qui l'annonce, et la derniere ligne
   * du fichier le repete -- parce que l'en-tete se perd dans un navigateur.
   */
  async exporterCsv(
    requete: StatsQuery,
    plafond: number,
  ): Promise<{ csv: string; tronque: boolean }> {
    const bornes = await this.bornes(requete);

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, string | number | null>>(sql`
        SELECT to_char(x.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lancee",
               x.bot_id       AS "bot",
               x.bot_version  AS "version",
               x.status::text AS "statut",
               x.duration_ms  AS "dureeMs",
               e.name         AS "entite",
               u.username     AS "demandeur",
               CASE WHEN x.schedule_id IS NULL THEN 'manuel' ELSE 'planifie' END AS "origine",
               x.message      AS "message"
          FROM ${executions} x
          JOIN entities e ON e.id = x.entity_id
          JOIN users u ON u.id = x.requested_by
         WHERE ${bornes}
         ORDER BY x.created_at DESC
         LIMIT ${plafond + 1}
      `);

      return resultat.rows;
    });

    const tronque = lignes.length > plafond;
    const retenues = tronque ? lignes.slice(0, plafond) : lignes;
    const colonnes = [
      'lancee',
      'bot',
      'version',
      'statut',
      'dureeMs',
      'entite',
      'demandeur',
      'origine',
      'message',
    ];

    const corps = retenues.map((ligne) =>
      colonnes.map((colonne) => echapperCsv(ligne[colonne])).join(','),
    );

    if (tronque) {
      corps.push(`# export tronque a ${String(plafond)} lignes ; affinez la periode ou le bot`);
    }

    return { csv: [colonnes.join(','), ...corps].join('\r\n'), tronque };
  }
}

/**
 * Une valeur, prete a etre posee dans une cellule.
 *
 * Deux dangers, pas un.
 *
 * Le premier est connu : une virgule, un guillemet ou un retour a la ligne
 * cassent la colonne s'ils ne sont pas cites.
 *
 * Le second l'est moins. Un tableur traite une cellule commencant par `=`,
 * `+`, `-` ou `@` comme une **formule** et l'evalue a l'ouverture ; certaines
 * formules atteignent le reseau ou le systeme de fichiers. Or la colonne
 * `message` porte du texte lu sur les pages que le bot a visitees, c'est-a-dire
 * du texte que quelqu'un d'autre ecrit. Un export est justement ce qu'on ouvre
 * sans y penser, sur un poste d'exploitation. La cellule est donc citee et
 * prefixee d'une apostrophe, que le tableur mange en affichant le texte tel
 * quel.
 *
 * Seules les chaines passent par cette garde : un nombre negatif est un nombre,
 * et le prefixer en ferait du texte que plus personne ne saurait additionner.
 */
export function echapperCsv(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined) return '';

  const texte = String(valeur);
  // Le tiret est en derniere position de la classe : ailleurs il y ouvrirait
  // un intervalle, et « [=+-@] » couvrirait alors les chiffres.
  const formule = typeof valeur === 'string' && /^[=+@\t\r-]/.test(texte);

  if (!formule && !/[",\r\n]/.test(texte)) return texte;

  return `"${formule ? "'" : ''}${texte.replace(/"/g, '""')}"`;
}
