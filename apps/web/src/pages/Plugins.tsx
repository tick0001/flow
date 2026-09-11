import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PluginState, PluginSummary } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';

/** Le ton d'un etat. Un seul est alarmant, et deux sont seulement informatifs. */
const TONS: Record<PluginState, 'neutre' | 'positif' | 'attention' | 'critique'> = {
  disponible: 'neutre',
  actif: 'positif',
  inactif: 'neutre',
  refuse: 'critique',
  orphelin: 'attention',
};

/**
 * Les extensions.
 *
 * L'ecran dit deux choses, et la seconde compte autant que la premiere : ce qui
 * est installe, et **ce que chaque plugin touche**. Un plugin qui accroche le
 * lancement des bots, qui pose des tables et qui declare des droits n'est pas
 * une case a cocher : c'est du code qui tourne dans le processus de l'API. La
 * liste de ses points d'accroche est donc affichee avant qu'on ne l'installe,
 * pas apres.
 */
export function Plugins() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.get<PluginSummary[]>('/plugins'),
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['plugins'] });
    // Les emplacements changent avec l'installation : les oublier laisserait un
    // encart affiche pour un plugin qu'on vient de desinstaller.
    await queryClient.invalidateQueries({ queryKey: ['emplacements'] });
  };

  const agir = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      if (action === 'desinstaller') return api.delete<void>(`/plugins/${id}`);

      return api.post<void>(`/plugins/${id}/${action}`);
    },
    onSuccess: rafraichir,
  });

  const relire = useMutation({
    mutationFn: () => api.post<PluginSummary[]>('/plugins/relire'),
    onSuccess: rafraichir,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('plugins.titre')}
        description={t('plugins.intro')}
        action={
          <Button
            variante="secondaire"
            onClick={() => {
              relire.mutate();
            }}
            disabled={relire.isPending}
          >
            {t('plugins.relire')}
          </Button>
        }
      />

      <Notice ton="attention">
        <strong className="font-semibold">{t('plugins.avertissementTitre')}</strong>{' '}
        {t('plugins.avertissement')}
      </Notice>

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}
      {error && <p className="text-critical-ink text-sm">{t('erreurs.serveur')}</p>}
      {agir.error && <p className="text-critical-ink text-sm">{agir.error.message}</p>}

      {data && data.length === 0 && (
        <EmptyState title={t('plugins.aucun')} description={t('plugins.aucunAide')} />
      )}

      {data?.map((plugin) => (
        <Card key={plugin.id}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{plugin.name}</span>
                <Badge ton={TONS[plugin.state]}>{t(`plugins.etat.${plugin.state}`)}</Badge>
                {plugin.version !== null && (
                  <span className="text-faint font-mono text-xs">{plugin.version}</span>
                )}
              </span>
            }
            action={
              <span className="flex flex-wrap gap-2">
                {plugin.state === 'disponible' && (
                  <Button
                    taille="sm"
                    variante="primaire"
                    onClick={() => {
                      agir.mutate({ id: plugin.id, action: 'installer' });
                    }}
                  >
                    {t('plugins.installer')}
                  </Button>
                )}
                {plugin.state === 'actif' && (
                  <Button
                    taille="sm"
                    onClick={() => {
                      agir.mutate({ id: plugin.id, action: 'desactiver' });
                    }}
                  >
                    {t('plugins.desactiver')}
                  </Button>
                )}
                {plugin.state === 'inactif' && (
                  <Button
                    taille="sm"
                    onClick={() => {
                      agir.mutate({ id: plugin.id, action: 'activer' });
                    }}
                  >
                    {t('plugins.activer')}
                  </Button>
                )}
                {(plugin.state === 'actif' ||
                  plugin.state === 'inactif' ||
                  plugin.state === 'orphelin') &&
                  (aConfirmer === plugin.id ? (
                    <Button
                      taille="sm"
                      variante="danger"
                      onClick={() => {
                        agir.mutate({ id: plugin.id, action: 'desinstaller' });
                        setAConfirmer(null);
                      }}
                    >
                      {t('plugins.confirmerDesinstallation')}
                    </Button>
                  ) : (
                    <Button
                      taille="sm"
                      variante="danger"
                      onClick={() => {
                        setAConfirmer(plugin.id);
                      }}
                    >
                      {t('plugins.desinstaller')}
                    </Button>
                  ))}
              </span>
            }
          />
          <CardBody className="space-y-3">
            {plugin.description !== '' && (
              <p className="text-muted text-sm">{plugin.description}</p>
            )}

            {plugin.reason !== null && <p className="text-critical-ink text-sm">{plugin.reason}</p>}

            {aConfirmer === plugin.id && (
              <p className="text-critical-ink text-sm">{t('plugins.avantDeDesinstaller')}</p>
            )}

            {/* Ce que le plugin touche. Avant l'installation, pas apres : c'est
                sur cette liste qu'on decide, et la lire ensuite ne sert plus. */}
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {plugin.schema && (
                <Ligne intitule={t('plugins.schema')} valeur={t('plugins.schemaOui')} />
              )}
              {plugin.rights.length > 0 && (
                <Ligne
                  intitule={t('plugins.droits')}
                  valeur={plugin.rights
                    .map(
                      (droit) =>
                        droit.label[i18n.language === 'en' ? 'en' : 'fr'] ??
                        `${droit.object}:${droit.action}`,
                    )
                    .join(', ')}
                />
              )}
              {plugin.hooks.length > 0 && (
                <Ligne intitule={t('plugins.hooks')} valeur={plugin.hooks.join(', ')} />
              )}
              {plugin.events.length > 0 && (
                <Ligne intitule={t('plugins.evenements')} valeur={plugin.events.join(', ')} />
              )}
              {plugin.surfaces.length > 0 && (
                <Ligne
                  intitule={t('plugins.emplacements')}
                  valeur={plugin.surfaces.map((surface) => surface.slot).join(', ')}
                />
              )}
              {plugin.views.length > 0 && (
                <Ligne
                  intitule={t('plugins.vues')}
                  valeur={plugin.views
                    .map((vue) =>
                      vue.right === undefined ? vue.name : `${vue.name} (${vue.right})`,
                    )
                    .join(', ')}
                />
              )}
              {plugin.tasks.length > 0 && (
                <Ligne
                  intitule={t('plugins.taches')}
                  valeur={plugin.tasks
                    .map(
                      (tache) =>
                        `${tache.id} — ${t('plugins.toutesLes', {
                          minutes: Math.round(tache.intervalSeconds / 60),
                        })}`,
                    )
                    .join(', ')}
                />
              )}
            </dl>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function Ligne({ intitule, valeur }: { intitule: string; valeur: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-faint shrink-0 font-semibold tracking-wider uppercase">{intitule}</dt>
      <dd className="text-muted font-mono break-words">{valeur}</dd>
    </div>
  );
}
