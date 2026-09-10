import { Injectable } from '@nestjs/common';
import type { RightScope } from '@flow/contracts';
import { eq, profileRights } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';

export type { RightScope };

/** Cle stable d'un droit : `objet:action`. */
export function rightKey(object: string, action: string): string {
  return `${object}:${action}`;
}

/**
 * Resolution des droits du profil actif.
 *
 * Un droit est un triplet objet x action x portee, et l'absence de ligne vaut
 * refus : aucune permission n'est implicite. La portee ne suffit jamais seule,
 * elle se combine toujours avec l'entite active du contexte.
 *
 * Le cache est en memoire, ce qui suppose une instance unique de l'API. Le
 * passage a plusieurs instances imposera une invalidation partagee par Redis ;
 * le point est isole ici pour que ce changement reste local.
 */
@Injectable()
export class RightsService {
  private readonly cache = new Map<number, Map<string, RightScope>>();

  constructor(private readonly db: DatabaseService) {}

  async rightsFor(profileId: number): Promise<Map<string, RightScope>> {
    const enCache = this.cache.get(profileId);
    if (enCache) return enCache;

    const lignes = await this.db.asOwner((tx) =>
      tx.select().from(profileRights).where(eq(profileRights.profileId, profileId)),
    );

    const droits = new Map<string, RightScope>(
      lignes.map((ligne) => [rightKey(ligne.object, ligne.action), ligne.scope]),
    );

    this.cache.set(profileId, droits);

    return droits;
  }

  async scopeFor(
    profileId: number,
    object: string,
    action: string,
  ): Promise<RightScope | undefined> {
    return (await this.rightsFor(profileId)).get(rightKey(object, action));
  }

  async can(profileId: number, object: string, action: string): Promise<boolean> {
    return (await this.scopeFor(profileId, object, action)) !== undefined;
  }

  /** A appeler des qu'un profil ou ses droits changent. */
  invalidate(profileId?: number): void {
    if (profileId === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(profileId);
    }
  }
}
