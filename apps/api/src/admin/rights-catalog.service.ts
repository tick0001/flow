import { Injectable } from '@nestjs/common';
import type { RightDefinition, RightsCatalog, RightScope } from '@flow/contracts';

/**
 * Portees applicables a un objet sans auteur ni proprietaire.
 *
 * Une entite, un profil ou un compte n'appartiennent a personne : `own` n'y
 * signifie rien, et le proposer donnerait un reglage qui ne filtre rien.
 */
const SANS_AUTEUR: RightScope[] = ['entity', 'recursive', 'all'];

/**
 * Portees applicables a un objet qui a un auteur -- une execution, une
 * planification.
 */
const AVEC_AUTEUR: RightScope[] = ['own', 'entity', 'recursive', 'all'];

function droit(
  object: string,
  action: string,
  scopes: RightScope[] = SANS_AUTEUR,
): RightDefinition {
  return { object, action, labelKey: `droits.${object}.${action}`, scopes };
}

/**
 * Catalogue des droits que l'application declare.
 *
 * L'interface dessine sa matrice a partir d'ici plutot que d'une liste ecrite en
 * dur cote client. Deux listes finiraient par diverger, et la divergence se
 * verrait mal : une case cochable pour un droit que le serveur ne consulte
 * jamais, ou un droit reel qu'aucun ecran ne permet d'accorder.
 *
 * Le registre est mutable pour que les plugins y ajoutent leurs objets au
 * chargement (jalon J8) -- d'ou un service plutot qu'une constante.
 */
@Injectable()
export class RightsCatalogService {
  private readonly coeur: RightDefinition[] = [
    droit('entity', 'read'),
    droit('entity', 'create'),
    droit('entity', 'update'),
    droit('entity', 'delete'),

    droit('user', 'read'),
    droit('user', 'create'),
    droit('user', 'update'),
    droit('user', 'delete'),

    // Les profils sont un referentiel **global** a l'installation : ils n'ont
    // pas d'entite. La portee n'y change donc rien, et seule la presence du
    // droit compte -- d'ou `all` comme unique valeur proposee, pour ne pas
    // laisser croire a un cloisonnement qui n'existe pas.
    //
    // C'est un droit puissant : qui modifie un profil modifie les droits de
    // toutes les branches ou ce profil est utilise. Documente dans
    // docs/03-entites-droits-securite.md.
    droit('profile', 'read', ['all']),
    droit('profile', 'create', ['all']),
    droit('profile', 'update', ['all']),
    droit('profile', 'delete', ['all']),

    droit('bot', 'read', AVEC_AUTEUR),
    droit('bot', 'execute', AVEC_AUTEUR),
    droit('bot', 'manage', SANS_AUTEUR),

    droit('execution', 'read', AVEC_AUTEUR),
    droit('execution', 'cancel', AVEC_AUTEUR),

    droit('schedule', 'read', AVEC_AUTEUR),
    droit('schedule', 'create', SANS_AUTEUR),
    droit('schedule', 'update', AVEC_AUTEUR),
    droit('schedule', 'delete', AVEC_AUTEUR),

    // Une clef d'API agit comme son createur : la portee `own` y designe donc
    // « les clefs que j'ai emises », ce qui est le reglage attendu pour quelqu'un
    // qui gere ses propres integrations sans avoir a voir celles des autres.
    droit('apikey', 'read', AVEC_AUTEUR),
    droit('apikey', 'create', SANS_AUTEUR),
    droit('apikey', 'delete', AVEC_AUTEUR),
  ];

  private readonly parPlugin = new Map<string, RightDefinition[]>();

  /** Le catalogue complet, coeur puis plugins, dans un ordre stable. */
  all(): RightsCatalog {
    return [...this.coeur, ...[...this.parPlugin.values()].flat()];
  }

  /** Un couple objet/action existe-t-il, et cette portee lui est-elle applicable ? */
  accepts(object: string, action: string, scope: RightScope): boolean {
    const definition = this.all().find(
      (candidat) => candidat.object === object && candidat.action === action,
    );

    return definition?.scopes.includes(scope) ?? false;
  }

  /** Declare les droits d'un plugin. Rejoue a chaque chargement. */
  register(pluginId: string, definitions: RightDefinition[]): void {
    this.parPlugin.set(pluginId, definitions);
  }

  /** Retire les droits d'un plugin desinstalle, et les lignes qui s'y referaient. */
  unregister(pluginId: string): void {
    this.parPlugin.delete(pluginId);
  }
}
