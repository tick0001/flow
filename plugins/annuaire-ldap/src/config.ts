/**
 * La configuration de l'annuaire, lue dans l'environnement.
 *
 * **Dans l'environnement, et non en base.** Le compte de service d'un annuaire
 * est un secret d'infrastructure : il se pose au deploiement, avec les autres,
 * et il vit la ou vivent deja l'URL de la base et le secret de session. Le
 * stocker en base aurait demande de le chiffrer, donc de gerer une clef, sa
 * rotation et sa perte -- pour une valeur que l'exploitant pose une fois.
 *
 * Le prix est reel et assume : changer d'annuaire demande de redemarrer l'API.
 * Un annuaire ne change pas toutes les semaines.
 */
export interface ConfigLdap {
  url: string;
  /** Compte de service, pour chercher la personne avant de la faire lier. */
  bindDn: string;
  bindPassword: string;
  /** Ou chercher les comptes. */
  userBaseDn: string;
  /**
   * Filtre de recherche, ou `{{identifiant}}` est remplace par la saisie.
   *
   * Un gabarit plutot qu'un attribut fige : `uid` chez OpenLDAP,
   * `sAMAccountName` chez Active Directory, et parfois une conjonction qui
   * exclut les comptes desactives.
   */
  userFilter: string;
  /** Attribut portant le nom affiche. */
  displayNameAttribute: string;
  /** Attribut portant l'adresse de courriel. */
  emailAttribute: string;
  /**
   * Ou chercher les groupes, quand l'annuaire ne les porte pas sur le compte.
   *
   * Vide, le plugin se contente de `memberOf` -- ce qu'Active Directory fournit
   * et qu'OpenLDAP ne fournit qu'avec une surcouche.
   */
  groupBaseDn: string;
  /** Filtre des groupes d'une personne, ou `{{dn}}` est remplace par son DN. */
  groupFilter: string;
  /** Refuser un certificat que l'on ne sait pas verifier. */
  rejectUnauthorized: boolean;
  /** Delai d'une operation, en millisecondes. */
  timeoutMs: number;
}

function lire(nom: string, defaut: string): string {
  const valeur = process.env[nom];

  return valeur === undefined || valeur === '' ? defaut : valeur;
}

/**
 * Lit la configuration, ou rend `null` si l'annuaire n'est pas configure.
 *
 * Rendre `null` plutot que lever : un plugin installe mais non configure ne doit
 * pas empecher les comptes locaux de se connecter. Il se contente de ne
 * reconnaitre personne -- ce qui est exactement ce qu'un hook d'identite fait
 * quand il ne sait pas repondre.
 */
export function lireConfig(): ConfigLdap | null {
  const url = lire('LDAP_URL', '');

  if (url === '') return null;

  return {
    url,
    bindDn: lire('LDAP_BIND_DN', ''),
    bindPassword: lire('LDAP_BIND_PASSWORD', ''),
    userBaseDn: lire('LDAP_USER_BASE_DN', ''),
    userFilter: lire('LDAP_USER_FILTER', '(uid={{identifiant}})'),
    displayNameAttribute: lire('LDAP_DISPLAY_NAME_ATTRIBUTE', 'cn'),
    emailAttribute: lire('LDAP_EMAIL_ATTRIBUTE', 'mail'),
    groupBaseDn: lire('LDAP_GROUP_BASE_DN', ''),
    groupFilter: lire('LDAP_GROUP_FILTER', '(member={{dn}})'),
    // Vrai par defaut : une connexion chiffree dont on ne verifie pas le
    // certificat protege du voisin de palier, pas de qui sait se placer entre
    // l'application et l'annuaire -- c'est-a-dire de personne d'interessant.
    rejectUnauthorized: lire('LDAP_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
    timeoutMs: Number(lire('LDAP_TIMEOUT_MS', '5000')),
  };
}

/**
 * Echappe une valeur destinee a un filtre LDAP.
 *
 * Sans cela, un identifiant contenant `*` ou `)` change le filtre lui-meme :
 * `(uid=*)` rend le premier compte venu, et l'application authentifierait
 * quelqu'un d'autre. C'est l'injection LDAP, et elle se corrige exactement
 * comme sa cousine SQL -- en ne laissant jamais une saisie devenir de la
 * syntaxe.
 *
 * Les caracteres sont remplaces par leur code hexadecimal, comme le veut la
 * RFC 4515.
 */
export function echapperFiltre(valeur: string): string {
  return [...valeur]
    .map((caractere) => {
      switch (caractere) {
        case '\\':
          return '\\5c';
        case '*':
          return '\\2a';
        case '(':
          return '\\28';
        case ')':
          return '\\29';
        case '\u0000':
          return '\\00';
        default:
          return caractere;
      }
    })
    .join('');
}

/**
 * Reduit un groupe a son nom.
 *
 * Un annuaire rend tantot un DN complet -- `CN=Exploitation,OU=Groupes,DC=...` --
 * tantot le seul nom. Les regles d'affectation sont ecrites par des humains, qui
 * ecrivent « Exploitation » : c'est donc au plugin de normaliser, et le contrat
 * le dit.
 */
export function nomDuGroupe(valeur: string): string {
  const premier = valeur.split(',')[0] ?? valeur;
  const separateur = premier.indexOf('=');

  return (separateur === -1 ? premier : premier.slice(separateur + 1)).trim();
}
