import { Client } from 'ldapts';
import { definirPlugin, type IdentiteExterne } from '@flow/plugin-sdk';
import { echapperFiltre, lireConfig, nomDuGroupe, type ConfigLdap } from './config.js';

/**
 * L'annuaire : LDAP et Active Directory, en plugin.
 *
 * **C'est la premiere extension reelle de Flow&, et c'est voulu.** Le perimetre
 * annonce depuis le debut que l'authentification est un point d'extension ;
 * l'ecrire dans le coeur aurait fait mentir cette phrase, et aurait pose la
 * question suivante -- OpenID Connect, SAML, un portail qui pose un en-tete --
 * comme un nouveau chantier du coeur a chaque fois.
 *
 * Le plugin ne decide de rien. Il dit **qui est la personne** et **a quels
 * groupes elle appartient** ; le coeur applique les regles d'affectation. Un
 * plugin qui resoudrait lui-meme un profil et une entite ferait de chacune de
 * ses erreurs une elevation de privileges.
 *
 * Il ne demande **ni schema, ni droit, ni emplacement** : c'est le plugin le
 * plus discret que cette surface d'extension permette, et la preuve qu'elle ne
 * force pas a tout declarer.
 */

/**
 * Un client, chiffre ou non selon le protocole de l'URL.
 *
 * **Les options TLS ne sont posees que pour `ldaps://`**, et c'est une
 * subtilite couteuse : `ldapts` deduit « connexion chiffree » de la seule
 * presence de `tlsOptions`. Les passer sur une URL `ldap://` fait tenter une
 * poignee de main TLS sur un port qui n'en attend pas, et l'annuaire de
 * developpement repondait « Client network socket disconnected before secure
 * TLS connection was established » -- une phrase qui ne designe ni le
 * protocole, ni l'option fautive.
 */
function clientPour(config: ConfigLdap): Client {
  const chiffre = config.url.startsWith('ldaps://');

  return new Client({
    url: config.url,
    timeout: config.timeoutMs,
    connectTimeout: config.timeoutMs,
    ...(chiffre ? { tlsOptions: { rejectUnauthorized: config.rejectUnauthorized } } : {}),
  });
}

/** Recherche puis liaison : le schema classique, et le seul qui tienne. */
async function identifier(
  config: ConfigLdap,
  username: string,
  password: string,
  journaliser: (message: string) => void,
): Promise<IdentiteExterne | null> {
  // Un mot de passe vide reussit une liaison anonyme sur la plupart des
  // annuaires : le serveur repond « lie », et l'application conclut a une
  // authentification. C'est le piege le plus connu de LDAP, et il se referme
  // ici, avant toute connexion.
  if (password === '') return null;

  const service = clientPour(config);

  try {
    await service.bind(config.bindDn, config.bindPassword);

    const filtre = config.userFilter.replaceAll('{{identifiant}}', echapperFiltre(username));
    const { searchEntries } = await service.search(config.userBaseDn, {
      filter: filtre,
      scope: 'sub',
      attributes: [
        'dn',
        config.displayNameAttribute,
        config.emailAttribute,
        'memberOf',
        'uid',
        'sAMAccountName',
      ],
    });

    const entree = searchEntries[0];

    if (!entree) {
      journaliser(`${username} : aucun compte ne correspond au filtre.`);

      return null;
    }

    // Deux comptes pour un identifiant : on refuse plutot que de choisir. Le
    // hasard de l'ordre de recherche deciderait sinon de qui se connecte.
    if (searchEntries.length > 1) {
      journaliser(`${username} : ${String(searchEntries.length)} comptes correspondent. Refuse.`);

      return null;
    }

    const dn = entree.dn;

    // La liaison au nom de la personne : c'est elle, et elle seule, qui
    // authentifie. Le compte de service n'a servi qu'a trouver le DN.
    const personne = clientPour(config);

    try {
      await personne.bind(dn, password);
    } catch {
      journaliser(`${username} : mot de passe refuse par l'annuaire.`);

      return null;
    } finally {
      await personne.unbind().catch(() => undefined);
    }

    const groupes = await lireLesGroupes(service, config, dn, entree['memberOf']);

    return {
      username,
      externalId: dn,
      displayName: texte(entree[config.displayNameAttribute]),
      email: texte(entree[config.emailAttribute]),
      groups: groupes,
    };
  } finally {
    await service.unbind().catch(() => undefined);
  }
}

/**
 * Les groupes, par `memberOf` quand l'annuaire le porte, par recherche sinon.
 *
 * Active Directory remplit `memberOf` ; OpenLDAP ne le fait qu'avec une
 * surcouche, et il faut alors chercher les groupes qui ont la personne pour
 * membre. Les deux chemins existent parce que les deux annuaires existent.
 */
async function lireLesGroupes(
  client: Client,
  config: ConfigLdap,
  dn: string,
  memberOf: unknown,
): Promise<string[]> {
  const directs = liste(memberOf).map(nomDuGroupe);

  if (config.groupBaseDn === '') return [...new Set(directs)];

  const filtre = config.groupFilter.replaceAll('{{dn}}', echapperFiltre(dn));
  const { searchEntries } = await client.search(config.groupBaseDn, {
    filter: filtre,
    scope: 'sub',
    attributes: ['cn'],
  });

  const trouves = searchEntries.map((entree) => texte(entree['cn']) ?? nomDuGroupe(entree.dn));

  return [...new Set([...directs, ...trouves.filter((nom): nom is string => nom !== undefined)])];
}

/** Une valeur d'attribut LDAP, ramenee a une chaine quand il y en a une. */
function texte(valeur: unknown): string | undefined {
  const premiere: unknown = Array.isArray(valeur) ? valeur[0] : valeur;

  if (typeof premiere === 'string') return premiere;
  if (Buffer.isBuffer(premiere)) return premiere.toString('utf8');

  return undefined;
}

/** Une valeur d'attribut LDAP, ramenee a une liste de chaines. */
function liste(valeur: unknown): string[] {
  const valeurs = Array.isArray(valeur) ? valeur : [valeur];

  return valeurs
    .map((element) => texte(element))
    .filter((element): element is string => element !== undefined);
}

export default definirPlugin({
  id: 'annuaire-ldap',
  name: 'Annuaire LDAP',
  description:
    "Authentifie les comptes contre un annuaire LDAP ou Active Directory, et rend leurs groupes. Les regles d'affectation du coeur decident de ce qu'ils valent.",
  version: '1.0.0',
  author: 'Flow&',

  hooks: {
    'authentification.verifier': async (contexte, charge) => {
      const config = lireConfig();

      if (!config) {
        // Installe mais pas configure : ne reconnaitre personne est la bonne
        // reponse. Lever ici empecherait les comptes locaux de se connecter,
        // ce qui est exactement ce que l'ordre « local d'abord » evite.
        contexte.log('debug', 'LDAP_URL absent : aucun annuaire interroge.');

        return null;
      }

      const identite = await identifier(config, charge.username, charge.password, (message) => {
        contexte.log('info', message);
      });

      if (identite) {
        contexte.log(
          'info',
          `${identite.username} reconnu : ${String(identite.groups.length)} groupe(s).`,
        );
      }

      return identite;
    },
  },
});
