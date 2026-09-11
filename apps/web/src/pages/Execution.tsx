import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import {
  dureeLisible,
  estTerminal,
  heureLisible,
  instantLisible,
  TON_DU_NIVEAU,
  TON_DU_STATUT,
} from '@/lib/executions';
import { useJournal } from '@/lib/journal';
import type { ExecutionDetail } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Notice,
  PageHeader,
  Pastille,
  SectionTitle,
} from '@/components/ui/primitives';

/** Cadence de relecture de l'execution elle-meme, tant qu'elle n'est pas terminee. */
const PERIODE_MS = 1000;

/**
 * Le detail d'une execution.
 *
 * Tout ce qui sert a comprendre un echec est sur cet ecran : le statut, le
 * message, les parametres qui ont reellement ete passes, le resultat, et le
 * journal ligne par ligne. C'est le critere de sortie du jalon J5 -- diagnostiquer
 * sans ouvrir un terminal -- et il se prepare ici.
 *
 * La relecture s'arrete d'elle-meme quand l'execution atteint un etat terminal :
 * un onglet laisse ouvert sur une execution d'hier n'a aucune raison d'interroger
 * le serveur toutes les secondes jusqu'a la fin des temps.
 */
export function Execution() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();

  const {
    data: execution,
    isPending,
    error,
  } = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api.get<ExecutionDetail>(`/executions/${id}`),
    refetchInterval: (requete) =>
      requete.state.data && !estTerminal(requete.state.data.status) ? PERIODE_MS : false,
  });

  const termine = execution ? estTerminal(execution.status) : false;
  const { lignes, injoignable } = useJournal(id, !termine);

  const interruption = useMutation({
    mutationFn: () => api.post<ExecutionDetail>(`/executions/${id}/cancel`),
    onSuccess: (apres) => {
      // La reponse porte deja l'etat d'apres : le poser directement evite un
      // aller-retour de plus, et surtout evite l'instant ou le bouton redevient
      // actif parce que la relecture n'est pas encore arrivee.
      queryClient.setQueryData(['execution', id], apres);
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
  });

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="space-y-4">
        <Notice ton="critique">{t('erreurs.introuvable')}</Notice>
        <Link to="/executions" className="text-brand-ink text-sm hover:underline">
          {t('executions.retour')}
        </Link>
      </div>
    );
  }

  if (isPending || !execution) {
    return <p className="text-muted text-sm">{t('commun.chargement')}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={execution.botName}
        description={t(`executions.statutAide.${execution.status}`)}
        action={
          <>
            <Link to="/executions" className="text-muted text-sm hover:underline">
              {t('executions.retour')}
            </Link>
            {execution.canCancel && (
              <Button
                variante="danger"
                taille="sm"
                disabled={interruption.isPending || execution.cancelRequested}
                onClick={() => {
                  if (window.confirm(t('executions.confirmerInterruption'))) {
                    interruption.mutate();
                  }
                }}
              >
                {execution.cancelRequested
                  ? t('executions.interruptionDemandee')
                  : t('executions.interrompre')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Pastille ton={TON_DU_STATUT[execution.status]}>
          {t(`executions.statut.${execution.status}`)}
        </Pastille>
        <Badge>v{execution.botVersion}</Badge>
        <span className="text-faint font-mono text-xs">{execution.botId}</span>
        {execution.headed && <Badge ton="info">{t('bots.avecFenetre')}</Badge>}
      </div>

      {/* L'interruption demandee et non encore prise en compte : une demande est
          asynchrone par nature -- le worker la voit entre deux etapes -- et sans
          cet etat le bouton semblerait n'avoir rien fait. */}
      {execution.cancelRequested && (
        <Notice ton="attention">{t('executions.interruptionEnCours')}</Notice>
      )}

      {execution.message && (
        <Notice ton={execution.status === 'failed' ? 'critique' : 'neutre'}>
          {execution.message}
        </Notice>
      )}

      {execution.progress && !termine && (
        <Progression step={execution.progress.step} percent={execution.progress.percent} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Renseignement intitule={t('executions.colonneEntite')} valeur={execution.entity.name} />
        <Renseignement
          intitule={t('executions.colonneDemandeur')}
          valeur={execution.requestedBy.displayName}
        />
        <Renseignement
          intitule={t('executions.colonneLancee')}
          valeur={instantLisible(execution.createdAt, i18n.language)}
        />
        <Renseignement
          intitule={t('executions.demarree')}
          valeur={
            execution.startedAt
              ? instantLisible(execution.startedAt, i18n.language)
              : t('executions.enAttenteDeWorker')
          }
        />
        <Renseignement
          intitule={t('executions.colonneDuree')}
          valeur={dureeLisible(execution.durationMs)}
        />
        <Renseignement
          intitule={t('executions.worker')}
          valeur={execution.worker ?? '—'}
          monospace
        />
      </div>

      <Card>
        <CardHeader title={t('executions.parametres')} />
        <CardBody>
          {/* Les parametres tels qu'ils ont ete passes, defauts appliques : relire
              une execution d'il y a six mois doit dire avec quelles valeurs elle a
              tourne, et non ce que le formulaire avait laisse vide. */}
          <dl className="divide-line border-line divide-y border">
            {Object.entries(execution.parameters).map(([nom, valeur]) => (
              <div key={nom} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <dt className="text-ink font-mono text-xs font-semibold">{nom}</dt>
                <dd className="text-muted min-w-0 font-mono text-xs break-all">
                  {JSON.stringify(valeur)}
                </dd>
              </div>
            ))}
            {Object.keys(execution.parameters).length === 0 && (
              <p className="text-faint px-3 py-2 text-sm">{t('bots.aucunParametre')}</p>
            )}
          </dl>
        </CardBody>
      </Card>

      {execution.output && (
        <Card>
          <CardHeader title={t('executions.resultat')} />
          <CardBody>
            {/* Rendu tel quel : le coeur ne sait rien de la forme de cette donnee,
                et pretendre la mettre en page inventerait une structure que le bot
                n'a pas promise. */}
            <pre className="bg-sunken border-line text-ink overflow-x-auto border p-3 font-mono text-xs">
              {JSON.stringify(execution.output, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      <div className="space-y-2">
        <SectionTitle
          action={!termine && <span className="text-faint text-xs">{t('executions.suivi')}</span>}
        >
          {t('executions.journal')}
        </SectionTitle>

        {injoignable && <Notice ton="attention">{t('erreurs.reseau')}</Notice>}

        {lignes.length === 0 ? (
          <p className="text-faint text-sm">{t('executions.journalVide')}</p>
        ) : (
          <div className="border-line bg-surface divide-line max-h-[28rem] divide-y overflow-y-auto border">
            {lignes.map((ligne) => (
              <div
                key={ligne.seq}
                className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-xs"
              >
                <span className="text-faint tabular-nums">
                  {heureLisible(ligne.at, i18n.language)}
                </span>
                <Badge ton={TON_DU_NIVEAU[ligne.level]}>{ligne.level}</Badge>
                <span className="text-ink min-w-0 break-words whitespace-pre-wrap">
                  {ligne.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Renseignement({
  intitule,
  valeur,
  monospace = false,
}: {
  intitule: string;
  valeur: string;
  monospace?: boolean;
}) {
  return (
    <div className="border-line bg-surface border px-3 py-2">
      <p className="text-faint text-[11px] font-semibold tracking-wider uppercase">{intitule}</p>
      <p className={monospace ? 'text-ink truncate font-mono text-xs' : 'text-ink text-sm'}>
        {valeur}
      </p>
    </div>
  );
}

/**
 * L'etape en cours.
 *
 * Sans pourcentage, l'etape s'affiche seule : beaucoup de bots savent nommer ou
 * ils en sont sans savoir combien il reste, et une barre a zero pour cent
 * pendant dix minutes ment plus qu'elle n'informe.
 */
function Progression({ step, percent }: { step: string; percent: number | null }) {
  return (
    <div className="border-line bg-surface space-y-1.5 border px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink text-sm">{step}</span>
        {percent !== null && <span className="text-muted text-xs tabular-nums">{percent} %</span>}
      </div>
      {percent !== null && (
        <div className="bg-sunken border-line h-1.5 w-full border">
          <div className="bg-brand h-full" style={{ width: `${String(percent)}%` }} />
        </div>
      )}
    </div>
  );
}
