import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  dureeLisible,
  estTerminal,
  heureLisible,
  instantLisible,
  TON_DU_NIVEAU,
  TON_DU_STATUT,
} from '@/lib/executions';
import { useFluxExecution, type EtatDuFlux } from '@/lib/flux';
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

/**
 * Le detail d'une execution, en direct.
 *
 * **Un seul flux alimente tout l'ecran** : l'etat, la progression, le journal et
 * la vue du navigateur arrivent par la meme connexion, dans l'ordre ou ils se
 * produisent. Trois sondages separes -- ce que faisait le jalon precedent pour
 * deux d'entre eux -- auraient affiche un journal en avance sur son statut, ou
 * l'inverse, selon celui qui revient le premier.
 *
 * Tout ce qui sert a comprendre un echec est ici : le statut, le message, les
 * parametres reellement passes, le resultat et le journal ligne par ligne.
 */
export function Execution() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();

  const { execution, lignes, image, etat } = useFluxExecution(id);

  const interruption = useMutation({
    mutationFn: () => api.post<ExecutionDetail>(`/executions/${id}/cancel`),
    onSuccess: () => {
      // L'etat d'apres arrive par le flux, pour tous les lecteurs a la fois. On
      // ne pose rien ici : ce serait une seconde verite, qui divergerait de ce
      // que voit le navigateur d'a cote.
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
  });

  if (etat === 'ouverture' && !execution) {
    return <p className="text-muted text-sm">{t('commun.chargement')}</p>;
  }

  if (!execution) {
    return (
      <div className="space-y-4">
        <Notice ton="critique">{t('erreurs.introuvable')}</Notice>
        <Link to="/executions" className="text-brand-ink text-sm hover:underline">
          {t('executions.retour')}
        </Link>
      </div>
    );
  }

  const termine = estTerminal(execution.status);

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
        <EtatDuLien etat={etat} />
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

      <VueEnDirect image={image} visible={!termine} />

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

/**
 * L'etat de la connexion au flux.
 *
 * Affiche seulement quand il y a quelque chose a dire. Un temoin permanent
 * « connecte » sur un ecran qui l'est presque toujours devient invisible a force,
 * et ne sert alors plus a rien le jour ou il change.
 */
function EtatDuLien({ etat }: { etat: EtatDuFlux }) {
  const { t } = useTranslation();

  if (etat !== 'coupe') return null;

  return <Badge ton="attention">{t('executions.fluxCoupe')}</Badge>;
}

/**
 * La vue en direct du navigateur.
 *
 * Elle n'apparait **que lorsqu'une image est arrivee**. Un cadre vide en
 * permanence ferait croire a une panne sur les executions qui n'ont pas encore
 * ouvert de page -- et sur celles, terminees, qui n'en ouvriront plus.
 *
 * Le navigateur du worker ne produit des images que pendant qu'on regarde : le
 * serveur le lui dit quand ce flux s'ouvre, et le lui redit tant qu'il reste
 * ouvert.
 */
function VueEnDirect({
  image,
  visible,
}: {
  image: { data: string; width: number; height: number } | undefined;
  visible: boolean;
}) {
  const { t } = useTranslation();

  if (!image || !visible) return null;

  return (
    <Card>
      <CardHeader
        title={t('executions.vueEnDirect')}
        action={<span className="text-faint text-xs">{t('executions.vueEnDirectAide')}</span>}
      />
      <CardBody>
        <img
          src={`data:image/jpeg;base64,${image.data}`}
          alt={t('executions.vueEnDirect')}
          width={image.width}
          height={image.height}
          className="border-line bg-sunken w-full border"
        />
      </CardBody>
    </Card>
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
          <div
            className="bg-brand h-full transition-all"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      )}
    </div>
  );
}
