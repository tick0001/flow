import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dureeLisible, estTerminal, instantLisible, TON_DU_STATUT } from '@/lib/executions';
import type { ExecutionStatus, ExecutionSummary, Page } from '@/lib/types';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  LinkButton,
  Notice,
  PageHeader,
  Pastille,
  Select,
  TableWrap,
} from '@/components/ui/primitives';

/** Cadence de relecture tant qu'une execution de la page n'est pas terminee. */
const PERIODE_MS = 2000;

const STATUTS: ExecutionStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'abandoned',
];

/**
 * L'historique des executions.
 *
 * La liste se relit d'elle-meme **tant qu'une de ses lignes bouge**, et s'arrete
 * des que tout est termine : une page d'historique figee qui interroge le serveur
 * toutes les deux secondes pour rien est le genre de detail qui se paie en
 * charge sur une installation de cinquante personnes.
 *
 * La pagination est par curseur et non par numero de page. Une installation qui
 * tourne accumule des executions sans jamais en supprimer d'elle-meme : un
 * `OFFSET` s'effondrerait le jour ou l'on voudrait remonter loin, c'est-a-dire le
 * jour d'un incident.
 */
export function Executions() {
  const { t, i18n } = useTranslation();
  const [parametres, setParametres] = useSearchParams();
  const [seulementLesMiennes, setSeulementLesMiennes] = useState(false);

  const statut = parametres.get('statut') ?? '';
  const botId = parametres.get('bot') ?? '';

  const requete = new URLSearchParams();

  if (statut) requete.set('status', statut);
  if (botId) requete.set('botId', botId);
  if (seulementLesMiennes) requete.set('mine', 'true');

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['executions', statut, botId, seulementLesMiennes],
      queryFn: ({ pageParam }) => {
        const avec = new URLSearchParams(requete);

        if (pageParam) avec.set('cursor', pageParam);

        return api.get<Page<ExecutionSummary>>(`/executions?${avec.toString()}`);
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (derniere) => derniere.nextCursor ?? undefined,
      refetchInterval: (requeteEnCours) => {
        const pages = requeteEnCours.state.data?.pages ?? [];
        const enMouvement = pages
          .flatMap((page) => page.items)
          .some((execution) => !estTerminal(execution.status));

        return enMouvement ? PERIODE_MS : false;
      },
    });

  const executions = (data?.pages ?? []).flatMap((page) => page.items);

  const changerFiltre = (clef: string, valeur: string): void => {
    const suivant = new URLSearchParams(parametres);

    if (valeur) suivant.set(clef, valeur);
    else suivant.delete(clef);

    setParametres(suivant, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('executions.titre')} description={t('executions.intro')} />

      <div className="border-line bg-sunken flex flex-wrap items-end gap-4 border p-3">
        <Field label={t('executions.filtreStatut')} className="w-48">
          <Select
            value={statut}
            onChange={(evenement) => {
              changerFiltre('statut', evenement.target.value);
            }}
          >
            <option value="">{t('executions.tousLesStatuts')}</option>
            {STATUTS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(`executions.statut.${valeur}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Checkbox
          label={t('executions.seulementLesMiennes')}
          checked={seulementLesMiennes}
          onChange={(evenement) => {
            setSeulementLesMiennes(evenement.target.checked);
          }}
        />

        {/* Le filtre par bot arrive par un lien depuis le catalogue : il se
            retire, mais il ne se choisit pas ici -- une liste deroulante de tous
            les bots deposes ferait un doublon du catalogue. */}
        {botId && (
          <Button
            taille="sm"
            onClick={() => {
              changerFiltre('bot', '');
            }}
          >
            {t('executions.retirerFiltreBot', { bot: botId })}
          </Button>
        )}
      </div>

      {error && <Notice ton="critique">{t('erreurs.serveur')}</Notice>}
      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {!isPending && executions.length === 0 && (
        <EmptyState
          title={t('executions.aucune')}
          description={t('executions.aucuneAide')}
          action={<LinkButton href="/bots">{t('navigation.bots')}</LinkButton>}
        />
      )}

      {executions.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-line text-faint border-b text-left text-[11px] tracking-wider uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">{t('executions.colonneStatut')}</th>
                <th className="px-3 py-2 font-semibold">{t('executions.colonneBot')}</th>
                <th className="px-3 py-2 font-semibold">{t('executions.colonneEntite')}</th>
                <th className="px-3 py-2 font-semibold">{t('executions.colonneDemandeur')}</th>
                <th className="px-3 py-2 font-semibold">{t('executions.colonneLancee')}</th>
                <th className="px-3 py-2 text-right font-semibold">
                  {t('executions.colonneDuree')}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {executions.map((execution) => (
                <tr key={execution.id} className="hover:bg-sunken">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Pastille ton={TON_DU_STATUT[execution.status]}>
                      {t(`executions.statut.${execution.status}`)}
                    </Pastille>
                    {/* L'etape en cours sous le statut : c'est l'information qui
                        change, et la seule qui distingue deux lignes « en
                        cours ». */}
                    {execution.progress && !estTerminal(execution.status) && (
                      <span className="text-faint mt-0.5 block text-xs">
                        {execution.progress.step}
                        {execution.progress.percent !== null &&
                          ` · ${String(execution.progress.percent)} %`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-ink">{execution.botName}</span>
                    <Badge className="ml-2">v{execution.botVersion}</Badge>
                  </td>
                  <td className="text-muted px-3 py-2">{execution.entity.name}</td>
                  <td className="text-muted px-3 py-2">{execution.requestedBy.displayName}</td>
                  <td className="text-muted px-3 py-2 whitespace-nowrap">
                    {instantLisible(execution.createdAt, i18n.language)}
                  </td>
                  <td className="text-muted px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {dureeLisible(execution.durationMs)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/executions/${execution.id}`}
                      className="text-brand-ink text-xs font-medium hover:underline"
                    >
                      {t('executions.ouvrir')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {hasNextPage && (
        <Button
          disabled={isFetchingNextPage}
          onClick={() => {
            void fetchNextPage();
          }}
        >
          {isFetchingNextPage ? t('commun.chargement') : t('executions.chargerLaSuite')}
        </Button>
      )}
    </div>
  );
}
