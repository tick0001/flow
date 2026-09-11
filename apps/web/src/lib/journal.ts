import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ExecutionLog } from '@/lib/types';

/** Intervalle entre deux relectures du journal, tant que l'execution court. */
const PERIODE_MS = 1000;

/**
 * Le journal d'une execution, qui s'allonge.
 *
 * **Il s'ajoute, il ne se recharge pas.** Le client garde le rang de la derniere
 * ligne recue et redemande « ce qui suit ». Recharger tout a chaque tour ferait
 * grossir la requete avec le journal -- un run bavard en produit des milliers de
 * lignes --, et l'affichage sauterait a chaque reponse.
 *
 * Ce n'est pas encore du temps reel : la diffusion par WebSocket arrive au jalon
 * J4. La relecture periodique est ce qui tient en attendant, et le point de
 * reprise par rang est **exactement** ce dont la version WebSocket aura besoin
 * pour rattraper une coupure -- le mecanisme n'est donc pas du provisoire a jeter.
 *
 * Un `useQuery` n'irait pas ici : TanStack Query garde *une* reponse par clef,
 * alors qu'on accumule des reponses successives. Le faire entrer dans ce moule
 * demanderait une clef qui change a chaque tour, donc une entree de cache par
 * seconde d'execution.
 */
export function useJournal(
  executionId: string,
  suivre: boolean,
): { lignes: ExecutionLog[]; injoignable: boolean } {
  const [lignes, setLignes] = useState<ExecutionLog[]>([]);
  const [injoignable, setInjoignable] = useState(false);
  // Dans une reference et non dans l'etat : le tirage suivant est programme dans
  // une fermeture, et lire l'etat y donnerait la valeur du rendu ou la fermeture
  // a ete creee -- donc toujours le meme rang, donc les memes lignes en boucle.
  const dernierRang = useRef(-1);

  useEffect(() => {
    dernierRang.current = -1;
    setLignes([]);
  }, [executionId]);

  useEffect(() => {
    let vivant = true;
    let minuteur: number | undefined;

    const tirer = async (): Promise<void> => {
      try {
        const paquet = await api.get<ExecutionLog[]>(
          `/executions/${executionId}/logs?afterSeq=${String(dernierRang.current)}`,
        );

        if (!vivant) return;

        if (paquet.length > 0) {
          dernierRang.current = paquet[paquet.length - 1]?.seq ?? dernierRang.current;
          setLignes((avant) => [...avant, ...paquet]);
        }

        setInjoignable(false);
      } catch {
        // Une coupure ne vide pas ce qui est deja affiche : on le signale et on
        // reessaie au tour suivant. Effacer le journal a chaque hoquet reseau
        // ferait disparaitre precisement ce qu'on etait en train de lire.
        if (vivant) setInjoignable(true);
      }

      if (vivant && suivre) minuteur = window.setTimeout(() => void tirer(), PERIODE_MS);
    };

    // Un tirage immediat, puis la boucle si l'execution court encore. Quand
    // `suivre` passe a faux -- l'execution vient de se terminer --, cet effet se
    // rejoue et fait donc un dernier tirage : c'est ce qui ramene les lignes
    // ecrites juste avant la fin.
    void tirer();

    return () => {
      vivant = false;
      if (minuteur !== undefined) clearTimeout(minuteur);
    };
  }, [executionId, suivre]);

  return { lignes, injoignable };
}
