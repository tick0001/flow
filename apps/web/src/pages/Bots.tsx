import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type SouciDeChamp } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { BotSummary, ExecutionSummary } from '@/lib/types';
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
  Checkbox,
  EmptyState,
  Notice,
  PageHeader,
  SectionTitle,
} from '@/components/ui/primitives';

/**
 * Le catalogue des bots.
 *
 * Ce que l'ecran affiche vient du manifeste que le serveur a lu sur disque, et
 * de rien d'autre : ni base, ni recompilation. Deposer un dossier et demander la
 * relecture suffit a l'y faire apparaitre.
 *
 * Un bot **refuse** reste affiche, avec son motif. Le faire disparaitre
 * enverrait chercher dans les journaux du conteneur une reponse qui tient en une
 * ligne a l'ecran.
 */
export function Bots() {
  const { t } = useTranslation();
  const { droit } = useSession();
  const queryClient = useQueryClient();
  // Un seul formulaire ouvert a la fois. Les ouvrir tous ferait d'un catalogue de
  // vingt bots un mur de champs qu'on ne parcourt plus.
  const [ouvert, setOuvert] = useState<string | null>(null);

  const { data: bots, isPending } = useQuery({
    queryKey: ['bots'],
    queryFn: () => api.get<BotSummary[]>('/bots'),
  });

  const relecture = useMutation({
    mutationFn: () => api.post<BotSummary[]>('/bots/reload'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bots'] });
    },
  });

  const peutRelire = droit('bot', 'manage') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('bots.titre')}
        description={t('bots.intro')}
        action={
          peutRelire && (
            <Button
              disabled={relecture.isPending}
              onClick={() => {
                relecture.mutate();
              }}
            >
              {t('bots.relire')}
            </Button>
          )
        }
      />

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {bots && bots.length === 0 && (
        <EmptyState title={t('bots.aucun')} description={t('bots.aucunAide')} />
      )}

      <div className="space-y-3">
        {(bots ?? []).map((bot) => {
          const schema = bot.manifest.parameters as SchemaObjet;
          const enLancement = ouvert === bot.manifest.id;

          return (
            <Card key={bot.manifest.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{bot.manifest.name}</span>
                    <Badge>v{bot.manifest.version}</Badge>
                    {bot.manifest.tags.map((etiquette) => (
                      <Badge key={etiquette} ton="info">
                        {etiquette}
                      </Badge>
                    ))}
                    {!bot.loaded && <Badge ton="critique">{t('bots.refuse')}</Badge>}
                  </span>
                }
                action={
                  <span className="flex items-center gap-3">
                    <Link
                      to={`/executions?bot=${encodeURIComponent(bot.manifest.id)}`}
                      className="text-muted text-xs hover:underline"
                    >
                      {t('bots.sesExecutions')}
                    </Link>
                    {bot.canExecute && (
                      <Button
                        variante={enLancement ? 'secondaire' : 'primaire'}
                        taille="sm"
                        onClick={() => {
                          setOuvert(enLancement ? null : bot.manifest.id);
                        }}
                      >
                        {enLancement ? t('commun.annuler') : t('bots.lancer')}
                      </Button>
                    )}
                  </span>
                }
              />

              <CardBody className="space-y-4">
                {bot.loadError && <Notice ton="critique">{bot.loadError}</Notice>}

                {bot.manifest.description && (
                  <p className="text-muted text-sm">{bot.manifest.description}</p>
                )}

                <p className="text-faint font-mono text-xs">
                  {bot.manifest.id}
                  {bot.manifest.author && ` · ${t('bots.par')} ${bot.manifest.author}`}
                </p>

                {enLancement ? (
                  <Lancement
                    botId={bot.manifest.id}
                    schema={schema}
                    onFini={() => {
                      setOuvert(null);
                    }}
                  />
                ) : (
                  <div className="space-y-2">
                    <SectionTitle>{t('bots.parametres')}</SectionTitle>
                    <Parametres schema={schema} />
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Le formulaire de lancement, rendu depuis le schema du bot.
 *
 * Les champs viennent du **meme** schema que le serveur valide : ce qu'on voit ici
 * est exactement ce qui sera demande, et ce qui sera verifie. Les messages du
 * serveur reviennent par champ, sous le controle qui les a causes.
 */
function Lancement({
  botId,
  schema,
  onFini,
}: {
  botId: string;
  schema: SchemaObjet;
  onFini: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [valeurs, setValeurs] = useState<Record<string, unknown>>(() => valeursInitiales(schema));
  const [avecFenetre, setAvecFenetre] = useState(false);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [refus, setRefus] = useState<string | null>(null);

  const lancement = useMutation({
    mutationFn: () =>
      api.post<ExecutionSummary>('/executions', {
        botId,
        parameters: nettoyerValeurs(schema, valeurs),
        headed: avecFenetre,
      }),
    onSuccess: async (execution) => {
      await queryClient.invalidateQueries({ queryKey: ['executions'] });
      onFini();
      // Droit sur l'execution qu'on vient de lancer : c'est la qu'on veut etre,
      // et non de retour sur un catalogue qui ne dit rien de ce qui se passe.
      void navigate(`/executions/${execution.id}`);
    },
    onError: (erreur: unknown) => {
      if (erreur instanceof ApiError && erreur.issues) {
        setErreurs(
          Object.fromEntries(
            erreur.issues.map((souci) => [souci.chemin, messageDeSouci(souci, t)]),
          ),
        );
        setRefus(null);

        return;
      }

      // Un refus sans detail par champ : bot retire entre-temps, droit manquant,
      // serveur muet. Il se dit en clair plutot que de laisser le formulaire
      // semblant n'avoir rien fait.
      setErreurs({});
      setRefus(erreur instanceof ApiError ? erreur.message : t('commun.erreurInattendue'));
    },
  });

  return (
    <form
      className="border-line bg-sunken space-y-4 border p-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        lancement.mutate();
      }}
    >
      <SectionTitle>{t('bots.lancerTitre')}</SectionTitle>

      {refus && <Notice ton="critique">{refus}</Notice>}

      <ChampsDeSchema
        schema={schema}
        valeurs={valeurs}
        erreurs={erreurs}
        desactive={lancement.isPending}
        onChange={(nom, valeur) => {
          setValeurs((avant) => ({ ...avant, [nom]: valeur }));
          // Le message du serveur disparait des qu'on touche au champ : le laisser
          // ferait croire que la correction n'a pas ete prise.
          setErreurs((avant) => {
            if (!(nom in avant)) return avant;

            const suite = { ...avant };

            delete suite[nom];

            return suite;
          });
        }}
      />

      <Checkbox
        label={t('bots.avecFenetre')}
        checked={avecFenetre}
        disabled={lancement.isPending}
        onChange={(evenement) => {
          setAvecFenetre(evenement.target.checked);
        }}
      />
      <p className="text-faint text-xs">{t('bots.avecFenetreAide')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variante="primaire" disabled={lancement.isPending}>
          {lancement.isPending ? t('bots.lancementEnCours') : t('bots.lancer')}
        </Button>
        <Button type="button" onClick={onFini} disabled={lancement.isPending}>
          {t('commun.annuler')}
        </Button>
        <span className="text-faint text-xs">{t('bots.obligatoireAide')}</span>
      </div>
    </form>
  );
}

/**
 * Les parametres, en lecture.
 *
 * Le catalogue reste parcourable : on voit ce qu'un bot demande sans deplier son
 * formulaire, et sans que vingt bots fassent vingt formulaires ouverts.
 */
function Parametres({ schema }: { schema: SchemaObjet }) {
  const { t } = useTranslation();
  const proprietes = Object.entries(schema.properties ?? {});
  const obligatoires = new Set(schema.required ?? []);

  if (proprietes.length === 0) {
    return <p className="text-faint text-sm">{t('bots.aucunParametre')}</p>;
  }

  return (
    <dl className="divide-line border-line divide-y border">
      {proprietes.map(([nom, definition]) => (
        <div key={nom} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          <dt className="text-ink font-mono text-xs font-semibold">{nom}</dt>
          <dd className="text-faint font-mono text-xs">{definition.format ?? definition.type}</dd>
          {obligatoires.has(nom) ? (
            <dd>
              <Badge ton="attention">{t('bots.obligatoire')}</Badge>
            </dd>
          ) : (
            definition.default !== undefined && (
              <dd className="text-faint text-xs">
                {t('bots.defaut')} : <code>{JSON.stringify(definition.default)}</code>
              </dd>
            )
          )}
          {definition.description && (
            <dd className="text-muted w-full text-xs">{definition.description}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * Le message a montrer sous un champ refuse.
 *
 * **La contrainte se traduit, pas le texte du serveur.** Le validateur du serveur
 * rend le motif dans sa propre langue -- « must match format "uri" » --, ce qui
 * ferait de l'anglais au milieu d'une interface francaise, sur le champ le plus
 * courant d'un bot de navigateur. Le code de la contrainte et ses parametres
 * traversent donc, et c'est ici que la phrase se fabrique.
 *
 * Le texte du serveur reste le dernier recours : une contrainte qu'on n'a pas
 * encore nommee vaut mieux affichee en anglais que pas affichee du tout.
 */
function messageDeSouci(souci: SouciDeChamp, t: TFunction): string {
  if (!souci.code) return souci.message;

  const clef = `contraintes.${souci.code}`;
  // i18next rend la clef elle-meme quand elle n'existe pas : c'est ce qui permet
  // de retomber sur le texte du serveur sans avoir a tenir la liste des
  // contraintes connues a deux endroits.
  const traduit = t(clef, { ...souci.params });

  return traduit === clef ? souci.message : traduit;
}
