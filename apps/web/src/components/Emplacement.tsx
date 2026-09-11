import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PluginAsset, PluginSlot } from '@/lib/types';

/**
 * Ce qu'un plugin recoit pour dessiner.
 *
 * Volontairement pauvre : de quoi savoir ou l'on est, dans quelle langue, et de
 * quoi interroger ses propres vues. Rien du reste de l'application -- ni
 * client HTTP, ni cache de requetes, ni composant. Tout ce qu'on y ajouterait
 * deviendrait une promesse de compatibilite a tenir.
 */
interface ContexteEmplacement extends Record<string, unknown> {
  locale: string;
  vue: (nom: string, parametres?: Record<string, string>) => Promise<unknown>;
}

interface ModuleDePlugin {
  render?: (cible: HTMLElement, contexte: ContexteEmplacement) => void | Promise<void>;
  default?: {
    render?: (cible: HTMLElement, contexte: ContexteEmplacement) => void | Promise<void>;
  };
}

/**
 * Un emplacement d'interface, rempli par les plugins qui l'ont declare.
 *
 * **Le contrat est un `render` sur un element du DOM, pas un composant React.**
 * C'est la regle de la collection, et elle se paie ici en quelques lignes
 * d'imperatif -- un `ref`, un `import()`, un appel. Elle rend en echange le
 * paquet d'un plugin autonome : pas de React a partager, pas de version a
 * accorder, pas de chaine de construction commune. Un fichier de JavaScript de
 * module ecrit a la main suffit, et le plugin de reference le montre.
 *
 * L'adresse du module est **donnee par l'API**, jamais devinee : le fichier vit
 * dans le dossier du plugin, que rien ne publie statiquement.
 *
 * Un plugin qui echoue a se charger ou a dessiner ne casse pas la page : il ne
 * dessine rien. Un encart est un supplement -- le faire tomber avec la page
 * qu'il accompagne serait donner a une extension le pouvoir de rendre
 * l'application inutilisable.
 */
export function Emplacement({
  slot,
  contexte,
}: {
  slot: PluginSlot;
  contexte: Record<string, string>;
}) {
  const { i18n } = useTranslation();
  const conteneur = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['emplacements'],
    queryFn: () => api.get<PluginAsset[]>('/plugins/emplacements'),
    // Les emplacements ne changent qu'a l'installation d'un plugin : les
    // relire a chaque montage d'un ecran serait une requete pour rien.
    staleTime: 5 * 60 * 1000,
  });

  const pourCetEmplacement = (data ?? []).filter((asset) => asset.slot === slot);
  // Les dependances d'un effet doivent se comparer par valeur : deux tableaux
  // d'objets identiques ne sont jamais egaux, et l'effet se rejouerait a chaque
  // rendu -- c'est-a-dire qu'il redessinerait l'encart en boucle.
  const declares = JSON.stringify(pourCetEmplacement);
  const parametres = JSON.stringify(contexte);

  useEffect(() => {
    const cible = conteneur.current;

    if (!cible) return;

    let vivant = true;

    cible.replaceChildren();

    const dessiner = async (): Promise<void> => {
      for (const asset of JSON.parse(declares) as PluginAsset[]) {
        try {
          const module = (await import(/* @vite-ignore */ asset.url)) as ModuleDePlugin;
          const render = module.render ?? module.default?.render;

          if (typeof render !== 'function' || !vivant) continue;

          const cadre = document.createElement('div');

          cible.append(cadre);

          await render(cadre, {
            ...(JSON.parse(parametres) as Record<string, string>),
            locale: i18n.language,
            vue: async (nom: string, valeurs: Record<string, string> = {}) => {
              const requete = new URLSearchParams(valeurs).toString();

              return api.get<unknown>(
                `/plugins/${asset.pluginId}/vues/${nom}${requete === '' ? '' : `?${requete}`}`,
              );
            },
          });
        } catch {
          // Un plugin qui ne se charge pas ou qui leve ne dessine rien. La page
          // qu'il accompagne, elle, continue d'exister.
        }
      }
    };

    void dessiner();

    return () => {
      vivant = false;
    };
  }, [declares, parametres, i18n.language]);

  if (pourCetEmplacement.length === 0) return null;

  return <div ref={conteneur} className="space-y-3" />;
}
