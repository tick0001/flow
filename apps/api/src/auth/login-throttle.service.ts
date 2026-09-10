import { Injectable } from '@nestjs/common';

const FENETRE_MS = 15 * 60 * 1000;
const TENTATIVES_MAX = 5;
/** Au-dela, on oublie les compteurs les plus anciens plutot que de grossir sans fin. */
const ENTREES_MAX = 10_000;

interface Compteur {
  echecs: number;
  premierEchecA: number;
}

/**
 * Limitation des tentatives de connexion.
 *
 * Cinq echecs par quart d'heure, comptes par couple (adresse, identifiant).
 * Compter par identifiant seul permettrait de verrouiller le compte de
 * quelqu'un d'autre depuis n'importe ou ; compter par adresse seule laisserait
 * un reseau entier -- tout un bureau derriere une meme sortie -- se bloquer
 * mutuellement.
 *
 * En memoire, donc par instance. Une installation a plusieurs instances de
 * l'API divise d'autant l'efficacite du garde-fou ; le jour ou cela arrivera, le
 * compteur passera dans Redis, et le point est isole ici pour que ce changement
 * reste local.
 */
@Injectable()
export class LoginThrottleService {
  private readonly compteurs = new Map<string, Compteur>();

  private static cle(ipAddress: string | undefined, username: string): string {
    return `${ipAddress ?? 'inconnue'}|${username.toLowerCase()}`;
  }

  /** Le couple est-il bloque en ce moment ? */
  isBlocked(ipAddress: string | undefined, username: string): boolean {
    const compteur = this.compteurs.get(LoginThrottleService.cle(ipAddress, username));

    if (!compteur) return false;

    if (Date.now() - compteur.premierEchecA > FENETRE_MS) {
      this.compteurs.delete(LoginThrottleService.cle(ipAddress, username));

      return false;
    }

    return compteur.echecs >= TENTATIVES_MAX;
  }

  registerFailure(ipAddress: string | undefined, username: string): void {
    const cle = LoginThrottleService.cle(ipAddress, username);
    const maintenant = Date.now();
    const compteur = this.compteurs.get(cle);

    if (!compteur || maintenant - compteur.premierEchecA > FENETRE_MS) {
      this.compteurs.set(cle, { echecs: 1, premierEchecA: maintenant });
    } else {
      compteur.echecs += 1;
    }

    // Purge opportuniste : sans elle, une campagne d'essais sur des milliers
    // d'identifiants inventes ferait grossir la table indefiniment.
    if (this.compteurs.size > ENTREES_MAX) {
      for (const [autre, valeur] of this.compteurs) {
        if (maintenant - valeur.premierEchecA > FENETRE_MS) this.compteurs.delete(autre);
      }
    }
  }

  /** Une connexion reussie efface l'ardoise. */
  reset(ipAddress: string | undefined, username: string): void {
    this.compteurs.delete(LoginThrottleService.cle(ipAddress, username));
  }
}
