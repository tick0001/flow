import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dureeLisible, instantLisible } from '@/lib/executions';
import type { Pilotage as Donnees } from '@/lib/types';
import { Tendance } from '@/components/Tendance';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  SectionTitle,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';

/** Fenetres proposees. Quatre boutons plutot que deux selecteurs de date. */
const PERIODES = [7, 30, 90] as const;

/**
 * Le pilotage.
 *
 * L'ecran doit repondre a une question et une seule : **qu'est-ce qui casse le
 * plus souvent, et depuis quand**. Tout ce qui est au-dessus -- le taux, les
 * durees, la tendance -- sert a savoir s'il faut se la poser ; le tableau des
 * causes y repond.
 *
 * D'ou l'ordre de la page : d'abord de quoi decider qu'il y a un probleme,
 * ensuite de quoi le nommer, et un lien pour aller voir une execution reelle.
 */
export function Pilotage() {
  const { t, i18n } = useTranslation();
  const [jours, setJours] = useState<number>(30);

  const { data, isPending, error } = useQuery({
    queryKey: ['pilotage', jours],
    queryFn: () => api.get<Donnees>(`/stats?jours=${String(jours)}`),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pilotage.titre')}
        description={t('pilotage.intro')}
        action={
          <span className="flex flex-wrap items-center gap-2">
            {PERIODES.map((valeur) => (
              <button
                key={valeur}
                type="button"
                onClick={() => {
                  setJours(valeur);
                }}
                className={
                  valeur === jours
                    ? 'border-ink bg-brand-soft text-brand-ink rounded-[2px] border px-2.5 py-1 text-xs font-medium'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink rounded-[2px] border px-2.5 py-1 text-xs'
                }
              >
                {t('pilotage.jours', { count: valeur })}
              </button>
            ))}
            <LinkButton taille="sm" href={`/api/stats/export.csv?jours=${String(jours)}`} download>
              {t('pilotage.exporter')}
            </LinkButton>
          </span>
        }
      />

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}
      {error && <p className="text-critical-ink text-sm">{t('erreurs.serveur')}</p>}

      {data && data.apercu.total === 0 && (
        <EmptyState title={t('pilotage.aucune')} description={t('pilotage.aucuneAide')} />
      )}

      {data && data.apercu.total > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Chiffre intitule={t('pilotage.total')} valeur={String(data.apercu.total)} />
            <Chiffre
              intitule={t('pilotage.tauxReussite')}
              valeur={
                data.apercu.tauxReussite === null
                  ? '—'
                  : `${String(Math.round(data.apercu.tauxReussite * 100))} %`
              }
              // Le taux est le seul chiffre qu'on lit comme un jugement : il
              // porte donc une couleur, et les autres non.
              ton={
                data.apercu.tauxReussite === null
                  ? undefined
                  : data.apercu.tauxReussite >= 0.95
                    ? 'positif'
                    : data.apercu.tauxReussite >= 0.8
                      ? 'attention'
                      : 'critique'
              }
            />
            <Chiffre
              intitule={t('pilotage.mediane')}
              valeur={dureeLisible(data.apercu.medianeMs)}
              aide={t('pilotage.medianeAide')}
            />
            <Chiffre intitule={t('pilotage.p95')} valeur={dureeLisible(data.apercu.p95Ms)} />
          </div>

          <Tendance jours={data.tendance} />

          <Card>
            <CardHeader title={t('pilotage.echecs')} />
            <CardBody>
              {data.echecs.length === 0 ? (
                <p className="text-muted text-sm">{t('pilotage.aucunEchec')}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-faint text-xs">{t('pilotage.echecsAide')}</p>
                  {data.echecs.map((groupe) => (
                    <div key={groupe.signature} className="border-line space-y-1 border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <Badge ton="critique">
                            {t('pilotage.fois', { count: groupe.total })}
                          </Badge>
                          <span className="text-ink text-sm">{bots(groupe.bots)}</span>
                        </span>
                        <Link
                          to={`/executions/${groupe.exempleExecutionId}`}
                          className="text-brand-ink text-xs font-medium hover:underline"
                        >
                          {t('pilotage.voirUnExemple')}
                        </Link>
                      </div>

                      {/* La signature d'abord : c'est elle qui regroupe. Le
                          message reel dessous la rend reconnaissable -- une
                          signature seule se lit mal. */}
                      <p className="text-ink font-mono text-xs break-words">{groupe.signature}</p>
                      <p className="text-faint font-mono text-[11px] break-words">
                        {groupe.exemple}
                      </p>
                      <p className="text-muted text-xs">
                        {t('pilotage.depuis', {
                          premier: instantLisible(groupe.premierVu, i18n.language),
                          dernier: instantLisible(groupe.dernierVu, i18n.language),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="space-y-2">
            <SectionTitle>{t('pilotage.parBot')}</SectionTitle>
            <TableWrap>
              <thead>
                <tr>
                  <Th>{t('executions.colonneBot')}</Th>
                  <Th className="text-right">{t('pilotage.total')}</Th>
                  <Th className="text-right">{t('pilotage.tauxReussite')}</Th>
                  <Th className="text-right">{t('pilotage.mediane')}</Th>
                  <Th>{t('pilotage.dernierEchec')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.bots.map((bot) => (
                  <Tr key={bot.botId}>
                    <Td>
                      <Link
                        to={`/executions?bot=${encodeURIComponent(bot.botId)}`}
                        className="text-ink hover:underline"
                      >
                        {bot.botName}
                      </Link>
                    </Td>
                    <Td className="text-muted text-right tabular-nums">{bot.total}</Td>
                    <Td className="text-right tabular-nums">
                      {bot.tauxReussite === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span
                          className={bot.tauxReussite >= 0.95 ? 'text-muted' : 'text-critical-ink'}
                        >
                          {Math.round(bot.tauxReussite * 100)} %
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted text-right tabular-nums">
                      {dureeLisible(bot.medianeMs)}
                    </Td>
                    <Td className="text-muted text-xs whitespace-nowrap">
                      {bot.dernierEchec
                        ? instantLisible(bot.dernierEchec, i18n.language)
                        : t('pilotage.aucunEchecBot')}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Les bots touches par une cause, en une ligne.
 *
 * Au-dela de deux noms la ligne cesse d'etre lisible et l'information utile
 * change : ce n'est plus « lequel », c'est « combien ». On bascule donc sur un
 * compte plutot que de tout enumerer.
 */
function bots(liste: Donnees['echecs'][number]['bots']): string {
  const noms = liste.map((bot) => bot.botName);

  return noms.length <= 2
    ? noms.join(', ')
    : `${noms.slice(0, 2).join(', ')} +${String(noms.length - 2)}`;
}

/**
 * Un chiffre de tete.
 *
 * Le ton est facultatif et volontairement rare : si les quatre cases etaient
 * colorees, aucune ne dirait plus rien. Seul le taux de reussite se lit comme un
 * jugement.
 */
function Chiffre({
  intitule,
  valeur,
  aide,
  ton,
}: {
  intitule: string;
  valeur: string;
  aide?: string | undefined;
  ton?: 'positif' | 'attention' | 'critique' | undefined;
}) {
  const couleur =
    ton === 'positif'
      ? 'text-positive-ink'
      : ton === 'attention'
        ? 'text-caution-ink'
        : ton === 'critique'
          ? 'text-critical-ink'
          : 'text-ink';

  return (
    <div className="border-line bg-surface border px-3 py-2">
      <p className="text-faint text-[11px] font-semibold tracking-wider uppercase">{intitule}</p>
      <p className={`text-xl font-bold tabular-nums ${couleur}`}>{valeur}</p>
      {aide && <p className="text-faint text-xs">{aide}</p>}
    </div>
  );
}
