import { useEffect, useRef, useState } from 'react';
import { estTerminal } from '@/lib/executions';
import type { ExecutionDetail, ExecutionLog } from '@/lib/types';

/** Ce que le serveur pousse sur le flux d'une execution. */
type EvenementDeFlux =
  | { kind: 'snapshot'; payload: ExecutionDetail }
  | { kind: 'log'; payload: ExecutionLog }
  | { kind: 'progress'; payload: { step: string; percent: number | null } }
  | { kind: 'frame'; payload: { data: string; width: number; height: number } };

export type EtatDuFlux = 'ouverture' | 'ouvert' | 'coupe' | 'termine';

export interface Flux {
  execution: ExecutionDetail | undefined;
  lignes: ExecutionLog[];
  /** Derniere image du navigateur. Nulle tant que rien n'est arrive. */
  image: { data: string; width: number; height: number } | undefined;
  etat: EtatDuFlux;
}

/** Attentes successives avant une reouverture, en millisecondes. */
const RECULS_MS = [1000, 2000, 4000, 8000, 10_000];

/**
 * Le flux temps reel d'une execution.
 *
 * **La reprise a deux declencheurs et un seul mecanisme.** `EventSource`
 * reconnecte de lui-meme sur une coupure passagere, et renvoie alors
 * l'identifiant du dernier evenement recu : c'est le protocole qui travaille, et
 * il n'y a rien a ecrire.
 *
 * Mais il **abandonne definitivement** des qu'une tentative recoit une erreur
 * HTTP -- ce qui arrive exactement quand l'API redemarre, le relais repondant
 * alors 502. Le navigateur ferme, cesse d'essayer, et la page se fige sans rien
 * dire. C'est le cas qu'on trouve en coupant pour de vrai, jamais en lisant la
 * documentation du protocole.
 *
 * Ce cas-la est donc rattrape ici : on rouvre soi-meme, avec recul progressif,
 * en disant dans la requete ou l'on en etait. Les deux chemins reprennent au
 * meme endroit -- le rang de la derniere ligne recue.
 */
export function useFluxExecution(executionId: string): Flux {
  const [execution, setExecution] = useState<ExecutionDetail | undefined>(undefined);
  const [lignes, setLignes] = useState<ExecutionLog[]>([]);
  const [image, setImage] = useState<Flux['image']>(undefined);
  const [etat, setEtat] = useState<EtatDuFlux>('ouverture');

  // Dans des references : les gestionnaires sont crees une fois, et lire l'etat
  // dedans donnerait la valeur du rendu ou ils ont ete crees.
  const rangs = useRef(new Set<number>());
  const dernierRang = useRef(-1);

  useEffect(() => {
    rangs.current = new Set();
    dernierRang.current = -1;
    setExecution(undefined);
    setLignes([]);
    setImage(undefined);
    setEtat('ouverture');

    let vivant = true;
    let source: EventSource | undefined;
    let reouverture: number | undefined;
    let echecs = 0;

    const ouvrir = (): void => {
      if (!vivant) return;

      // Le rang voyage dans la requete : sur une reouverture que nous decidons,
      // le navigateur n'envoie pas `Last-Event-ID` -- c'est une connexion neuve,
      // sans histoire.
      const depuis = dernierRang.current >= 0 ? `?afterSeq=${String(dernierRang.current)}` : '';

      source = new EventSource(`/api/executions/${executionId}/stream${depuis}`, {
        withCredentials: true,
      });

      source.onopen = () => {
        echecs = 0;
        setEtat('ouvert');
      };

      source.onmessage = (message: MessageEvent<string>) => {
        let evenement: EvenementDeFlux;

        try {
          evenement = JSON.parse(message.data) as EvenementDeFlux;
        } catch {
          return;
        }

        if (evenement.kind === 'snapshot') {
          setExecution(evenement.payload);

          if (estTerminal(evenement.payload.status)) {
            // Fermer soi-meme : sans cela le navigateur rouvrirait le flux d'une
            // execution qui n'emettra plus jamais rien, toutes les trois
            // secondes, indefiniment.
            vivant = false;
            source?.close();
            setEtat('termine');
          }

          return;
        }

        if (evenement.kind === 'log') {
          const ligne = evenement.payload;

          // La reprise rejoue a partir du dernier rang **recu**, et le serveur
          // peut en renvoyer un deja vu si la coupure est tombee entre
          // l'emission et sa prise en compte. Le rang est unique par execution :
          // c'est la seule verification necessaire.
          if (rangs.current.has(ligne.seq)) return;

          rangs.current.add(ligne.seq);
          dernierRang.current = Math.max(dernierRang.current, ligne.seq);
          setLignes((avant) => [...avant, ligne]);

          return;
        }

        if (evenement.kind === 'progress') {
          // La progression n'arrive pas dans l'instantane : on la pose sur
          // l'execution deja connue, pour que l'ecran n'ait qu'une source.
          setExecution((avant) => (avant ? { ...avant, progress: evenement.payload } : avant));

          return;
        }

        setImage(evenement.payload);
      };

      source.onerror = () => {
        if (!vivant) return;

        setEtat('coupe');

        // `CONNECTING` : le navigateur reessaie tout seul, et renverra
        // `Last-Event-ID`. Il n'y a rien a faire, et fermer serait exactement le
        // contraire de ce qu'on veut.
        if (source?.readyState === EventSource.CONNECTING) return;

        // `CLOSED` : il a renonce. A nous de rouvrir.
        source?.close();

        const recul = RECULS_MS[Math.min(echecs, RECULS_MS.length - 1)] ?? 10_000;

        echecs += 1;
        reouverture = window.setTimeout(ouvrir, recul);
      };
    };

    ouvrir();

    return () => {
      vivant = false;
      if (reouverture !== undefined) clearTimeout(reouverture);
      source?.close();
    };
  }, [executionId]);

  return { execution, lignes, image, etat };
}
