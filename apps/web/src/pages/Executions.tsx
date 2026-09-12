import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dureeLisible, estTerminal, instantLisible, TON_DU_STATUT } from '@/lib/executions';
import type { EntityRef, ExecutionStatus, ExecutionSummary, Page } from '@/lib/types';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FilterBar,
  LinkButton,
  Notice,
  PageHeader,
  Pastille,
  Select,
  TableWrap,
  Td,
  Th,
  Tr,
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
  const planification = parametres.get('planification') ?? '';
  const entite = parametres.get('entite') ?? '';

  const requete = new URLSearchParams();

  if (statut) requete.set('status', statut);
  if (botId) requete.set('botId', botId);
  if (planification) requete.set('scheduleId', planification);
  if (entite) requete.set('entityId', entite);
  if (seulementLesMiennes) requete.set('mine', 'true');

  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['executions', statut, botId, planification, entite, seulementLesMiennes],
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

  // Les entites ou il y a quelque chose a filtrer, deduites des executions
  // visibles : l'arbre complet demande `entity:read`, que la plupart des
  // operateurs n'ont pas.
  const entites = useQuery({
    queryKey: ['executions-entites'],
    queryFn: () => api.get<EntityRef[]>('/executions/entites'),
    staleTime: 60_000,
  });

  const changerFiltre = (clef: string, valeur: string): void => {
    const suivant = new URLSearchParams(parametres);

    if (valeur) suivant.set(clef, valeur);
    else suivant.delete(clef);

    setParametres(suivant, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('executions.titre')} description={t('executions.intro')} />

      <FilterBar>
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

        {/* Le selecteur n'apparait qu'a partir de deux entites : en proposer une
            seule, deja la seule visible, serait un controle sans effet. */}
        {entites.data && entites.data.length > 1 && (
          <Field label={t('executions.filtreEntite')} className="w-64">
            <Select
              value={entite}
              onChange={(evenement) => {
                changerFiltre('entite', evenement.target.value);
              }}
            >
              <option value="">{t('executions.toutesLesEntites')}</option>
              {entites.data.map((choix) => (
                <option key={choix.id} value={choix.id}>
                  {choix.completeName}
                </option>
              ))}
            </Select>
          </Field>
        )}

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
      </FilterBar>

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
          <thead>
            <tr>
              <Th>{t('executions.colonneStatut')}</Th>
              <Th>{t('executions.colonneBot')}</Th>
              <Th>{t('executions.colonneEntite')}</Th>
              <Th>{t('executions.colonneDemandeur')}</Th>
              <Th>{t('executions.colonneLancee')}</Th>
              <Th className="text-right">{t('executions.colonneDuree')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {executions.map((execution) => (
              <Tr key={execution.id}>
                <Td className="whitespace-nowrap">
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
                </Td>
                <Td>
                  <span className="text-ink">{execution.botName}</span>
                  <Badge className="ml-2">v{execution.botVersion}</Badge>
                </Td>
                <Td className="text-muted">{execution.entity.name}</Td>
                <Td className="text-muted">{execution.requestedBy.displayName}</Td>
                <Td className="text-muted whitespace-nowrap">
                  {instantLisible(execution.createdAt, i18n.language)}
                </Td>
                <Td className="text-muted text-right whitespace-nowrap tabular-nums">
                  {dureeLisible(execution.durationMs)}
                </Td>
                <Td className="text-right">
                  <Link
                    to={`/executions/${execution.id}`}
                    className="text-brand-ink text-xs font-medium hover:underline"
                  >
                    {t('executions.ouvrir')}
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
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
