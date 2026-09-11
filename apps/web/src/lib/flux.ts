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
  /** Derniere image du navigateur. Nulle tant que personne n'a rien vu. */
  image: { data: string; width: number; height: number } | undefined;
  etat: EtatDuFlux;
}

/**
 * Le flux temps reel d'une execution.
 *
 * **`EventSource` et non WebSocket**, et c'est ce qui rend ce fichier court : le
 * navigateur reconnecte tout seul apres une coupure, et renvoie de lui-meme
 * l'identifiant du dernier evenement recu. Le serveur rejoue ce qui suit. Il n'y
 * a donc ici ni minuteur de reconnexion, ni recul progressif, ni suivi du dernier
 * rang -- trois choses qu'un WebSocket aurait fallu ecrire, et ou l'on se trompe.
 *
 * Une seule prudence, et elle n'est pas evidente : **le navigateur reconnecte
 * aussi quand le serveur ferme proprement.** Une execution terminee rouvrirait
 * donc son flux indefiniment, toutes les trois secondes. C'est au client de
 * fermer en voyant l'etat terminal -- ce qu'il recoit toujours avant la
 * fermeture, les evenements arrivant dans l'ordre.
 */
export function useFluxExecution(executionId: string): Flux {
  const [execution, setExecution] = useState<ExecutionDetail | undefined>(undefined);
  const [lignes, setLignes] = useState<ExecutionLog[]>([]);
  const [image, setImage] = useState<Flux['image']>(undefined);
  const [etat, setEtat] = useState<EtatDuFlux>('ouverture');

  // Dans une reference : les gestionnaires d'evenements sont crees une fois, et
  // lire l'etat dedans donnerait la valeur du rendu ou ils ont ete crees.
  const rangs = useRef(new Set<number>());

  useEffect(() => {
    rangs.current = new Set();
    setExecution(undefined);
    setLignes([]);
    setImage(undefined);
    setEtat('ouverture');

    const source = new EventSource(`/api/executions/${executionId}/stream`, {
      withCredentials: true,
    });

    source.onopen = () => {
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
          // Fermer soi-meme, sinon le navigateur rouvre le flux d'une execution
          // qui n'emettra plus jamais rien.
          source.close();
          setEtat('termine');
        }

        return;
      }

      if (evenement.kind === 'log') {
        const ligne = evenement.payload;

        // La reprise apres coupure rejoue a partir du dernier rang **recu**, et
        // le serveur peut en renvoyer un deja vu si la coupure est tombee entre
        // l'emission et sa prise en compte. Le rang est unique par execution :
        // c'est la seule verification necessaire.
        if (rangs.current.has(ligne.seq)) return;

        rangs.current.add(ligne.seq);
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
      // `EventSource` reconnecte de lui-meme : il n'y a rien a faire ici qu'a le
      // dire. Fermer serait exactement le contraire de ce qu'on veut.
      if (source.readyState !== EventSource.CLOSED) setEtat('coupe');
    };

    return () => {
      source.close();
    };
  }, [executionId]);

  return { execution, lignes, image, etat };
}
