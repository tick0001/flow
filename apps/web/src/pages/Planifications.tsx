import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { instantLisible } from '@/lib/executions';
import type { BotSummary, CronPreview, Schedule } from '@/lib/types';
import {
  ChampsDeSchema,
  nettoyerValeurs,
  valeursInitiales,
  type SchemaObjet,
} from '@/components/ChampsDeSchema';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Pastille,
  SectionTitle,
  Select,
  TableWrap,
} from '@/components/ui/primitives';

/**
 * Fuseau propose par defaut : celui du navigateur.
 *
 * Devine plutot que laisse vide. Quelqu'un qui planifie a neuf heures veut dire
 * neuf heures **chez lui** ; lui demander de choisir un fuseau dans une liste de
 * six cents entrees pour confirmer ce que sa machine sait deja serait une
 * question posee pour rien.
 */
function fuseauLocal(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Les planifications.
 *
 * Ce qui se declenche tout seul, et qu'on ne regarde donc que lorsque quelque
 * chose ne s'est pas passe. L'ecran montre pour cette raison le **prochain**
 * declenchement autant que le dernier : « pourquoi ca n'a pas tourne » se
 * repond plus souvent par « la cadence ne dit pas ce que vous croyez » que par
 * une panne.
 */
export function Planifications() {
  const { t, i18n } = useTranslation();
  const { droit } = useSession();
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);

  const { data: planifications, isPending } = useQuery({
    queryKey: ['planifications'],
    queryFn: () => api.get<Schedule[]>('/schedules'),
  });

  const bascule = useMutation({
    mutationFn: (cible: { id: string; isActive: boolean }) =>
      api.patch<Schedule>(`/schedules/${cible.id}`, { isActive: cible.isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planifications'] });
    },
  });

  const suppression = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/schedules/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planifications'] });
    },
  });

  const peutCreer = droit('schedule', 'create') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('planifications.titre')}
        description={t('planifications.intro')}
        action={
          peutCreer && (
            <Button
              variante={ouvert ? 'secondaire' : 'primaire'}
              onClick={() => {
                setOuvert(!ouvert);
              }}
            >
              {ouvert ? t('commun.annuler') : t('planifications.nouvelle')}
            </Button>
          )
        }
      />

      {ouvert && (
        <Formulaire
          onFini={() => {
            setOuvert(false);
          }}
        />
      )}

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {planifications && planifications.length === 0 && !ouvert && (
        <EmptyState
          title={t('planifications.aucune')}
          description={t('planifications.aucuneAide')}
        />
      )}

      {planifications && planifications.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-line text-faint border-b text-left text-[11px] tracking-wider uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">{t('planifications.nom')}</th>
                <th className="px-3 py-2 font-semibold">{t('planifications.bot')}</th>
                <th className="px-3 py-2 font-semibold">{t('planifications.cadence')}</th>
                <th className="px-3 py-2 font-semibold">{t('planifications.prochain')}</th>
                <th className="px-3 py-2 font-semibold">{t('planifications.dernier')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {planifications.map((planification) => (
                <tr key={planification.id} className="hover:bg-sunken">
                  <td className="px-3 py-2">
                    <Pastille ton={planification.isActive ? 'positif' : 'neutre'}>
                      {planification.name}
                    </Pastille>
                  </td>
                  <td className="px-3 py-2">
                    {planification.botName ? (
                      <span className="text-muted">{planification.botName}</span>
                    ) : (
                      // Un bot retire ne fait pas disparaitre la planification :
                      // elle reste visible, et dit pourquoi elle ne tourne plus.
                      <Badge ton="critique">{t('planifications.botRetire')}</Badge>
                    )}
                  </td>
                  <td className="text-muted px-3 py-2 font-mono text-xs">
                    {planification.cron}
                    <span className="text-faint block">{planification.timezone}</span>
                  </td>
                  <td className="text-muted px-3 py-2 whitespace-nowrap">
                    {planification.isActive
                      ? instantLisible(planification.nextRunAt, i18n.language)
                      : t('planifications.inactive')}
                  </td>
                  <td className="text-muted px-3 py-2 whitespace-nowrap">
                    {planification.lastRunAt
                      ? instantLisible(planification.lastRunAt, i18n.language)
                      : t('planifications.jamais')}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="flex items-center justify-end gap-3">
                      <Link
                        to={`/executions?planification=${planification.id}`}
                        className="text-muted text-xs hover:underline"
                      >
                        {t('planifications.derniersDeclenchements')}
                      </Link>
                      {planification.canManage && (
                        <>
                          <Button
                            taille="sm"
                            disabled={bascule.isPending}
                            onClick={() => {
                              bascule.mutate({
                                id: planification.id,
                                isActive: !planification.isActive,
                              });
                            }}
                          >
                            {planification.isActive
                              ? t('planifications.desactiver')
                              : t('planifications.activer')}
                          </Button>
                          <Button
                            variante="danger"
                            taille="sm"
                            onClick={() => {
                              if (window.confirm(t('planifications.confirmerSuppression'))) {
                                suppression.mutate(planification.id);
                              }
                            }}
                          >
                            {t('commun.supprimer')}
                          </Button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

/**
 * Le formulaire de creation.
 *
 * L'apercu de la cadence est demande **au serveur**, avec l'analyseur qui
 * declenchera reellement. Le calculer dans le navigateur aurait demande une
 * seconde bibliotheque cron, et deux analyseurs finissent toujours par ne plus
 * dire la meme chose -- ce qui ne se verrait qu'a trois heures du matin.
 */
function Formulaire({ onFini }: { onFini: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [nom, setNom] = useState('');
  const [botId, setBotId] = useState('');
  const [cron, setCron] = useState('0 9 * * 1-5');
  const [fuseau, setFuseau] = useState(fuseauLocal);
  const [valeurs, setValeurs] = useState<Record<string, unknown>>({});
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [refus, setRefus] = useState<string | null>(null);

  const { data: bots } = useQuery({
    queryKey: ['bots'],
    queryFn: () => api.get<BotSummary[]>('/bots'),
  });

  const disponibles = (bots ?? []).filter((bot) => bot.loaded);
  const bot = disponibles.find((candidat) => candidat.manifest.id === botId);
  const schema = (bot?.manifest.parameters ?? {}) as SchemaObjet;

  const { data: apercu } = useQuery({
    queryKey: ['apercu-cron', cron, fuseau],
    queryFn: () =>
      api.get<CronPreview>(
        `/schedules/apercu?cron=${encodeURIComponent(cron)}&timezone=${encodeURIComponent(fuseau)}`,
      ),
    enabled: cron.trim().length > 0,
    retry: false,
  });

  const creation = useMutation({
    mutationFn: () =>
      api.post<Schedule>('/schedules', {
        name: nom,
        botId,
        cron,
        timezone: fuseau,
        parameters: nettoyerValeurs(schema, valeurs),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planifications'] });
      onFini();
    },
    onError: (erreur: unknown) => {
      if (erreur instanceof ApiError && erreur.issues) {
        setErreurs(Object.fromEntries(erreur.issues.map((souci) => [souci.chemin, souci.message])));
        setRefus(null);

        return;
      }

      setErreurs({});
      setRefus(erreur instanceof ApiError ? erreur.message : t('commun.erreurInattendue'));
    },
  });

  return (
    <Card>
      <CardHeader title={t('planifications.nouvelle')} />
      <CardBody className="space-y-4">
        {refus && <Notice ton="critique">{refus}</Notice>}

        <form
          className="space-y-4"
          onSubmit={(evenement) => {
            evenement.preventDefault();
            creation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('planifications.nom')}>
              <Input
                value={nom}
                required
                onChange={(evenement) => {
                  setNom(evenement.target.value);
                }}
              />
            </Field>

            <Field label={t('planifications.bot')}>
              <Select
                value={botId}
                required
                onChange={(evenement) => {
                  const choisi = evenement.target.value;

                  setBotId(choisi);
                  // Les parametres suivent le bot : garder ceux du precedent
                  // produirait un refus dont la cause ne se verrait pas.
                  const suivant = disponibles.find((c) => c.manifest.id === choisi);

                  setValeurs(suivant ? valeursInitiales(suivant.manifest.parameters) : {});
                  setErreurs({});
                }}
              >
                <option value="" />
                {disponibles.map((candidat) => (
                  <option key={candidat.manifest.id} value={candidat.manifest.id}>
                    {candidat.manifest.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('planifications.cadence')} hint={t('planifications.cadenceAide')}>
              <Input
                value={cron}
                required
                className="font-mono"
                onChange={(evenement) => {
                  setCron(evenement.target.value);
                }}
              />
            </Field>

            <Field label={t('planifications.fuseau')}>
              <Input
                value={fuseau}
                required
                onChange={(evenement) => {
                  setFuseau(evenement.target.value);
                }}
              />
            </Field>
          </div>

          {erreurs['cron'] && <p className="text-critical-ink text-xs">{erreurs['cron']}</p>}

          <div className="border-line bg-sunken space-y-1 border p-3">
            <SectionTitle>{t('planifications.apercu')}</SectionTitle>
            {apercu?.valid ? (
              <ul className="text-muted space-y-0.5 text-xs">
                {apercu.next.map((instant) => (
                  <li key={instant}>{instantLisible(instant, i18n.language)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-critical-ink text-xs">
                {apercu?.error ?? t('planifications.apercuVide')}
              </p>
            )}
          </div>

          {bot && (
            <div className="space-y-2">
              <SectionTitle>{t('bots.parametres')}</SectionTitle>
              <ChampsDeSchema
                schema={schema}
                valeurs={valeurs}
                erreurs={erreurs}
                desactive={creation.isPending}
                onChange={(champ, valeur) => {
                  setValeurs((avant) => ({ ...avant, [champ]: valeur }));
                }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variante="primaire"
              disabled={creation.isPending || !apercu?.valid}
            >
              {t('planifications.creer')}
            </Button>
            <Button type="button" onClick={onFini}>
              {t('commun.annuler')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
