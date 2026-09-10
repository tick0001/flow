import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { BotSummary } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
  SectionTitle,
} from '@/components/ui/primitives';

/**
 * Forme minimale d'un JSON Schema d'objet, telle que le SDK la produit.
 *
 * Volontairement partielle : on ne lit que ce qu'on affiche. Traiter le JSON
 * Schema dans sa generalite -- `allOf`, `$ref`, unions -- demanderait une
 * bibliotheque entiere pour un gain nul tant que les schemas viennent tous de
 * Zod par le meme chemin.
 */
interface SchemaObjet {
  properties?: Record<
    string,
    { type?: string; description?: string; default?: unknown; format?: string }
  >;
  required?: string[];
}

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
        {(bots ?? []).map((bot) => (
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
                bot.canExecute && (
                  // Desactive tant que le lancement n'existe pas : un bouton qui
                  // ne fait rien est pire qu'un bouton absent, alors qu'un bouton
                  // eteint avec son motif annonce ce qui vient.
                  <Button variante="primaire" taille="sm" disabled title={t('bots.lancerBientot')}>
                    {t('bots.lancer')}
                  </Button>
                )
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

              <div className="space-y-2">
                <SectionTitle>{t('bots.parametres')}</SectionTitle>
                <Parametres schema={bot.manifest.parameters as SchemaObjet} />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Les parametres, en lecture.
 *
 * Le formulaire de saisie viendra avec le lancement, au jalon J3 : il se rendra
 * depuis le meme schema, ce qui garantit que ce qu'on voit ici est bien ce qui
 * sera demande -- et que le serveur validera exactement ce que l'ecran a
 * affiche.
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
