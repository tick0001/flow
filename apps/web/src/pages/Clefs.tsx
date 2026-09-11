import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { instantLisible } from '@/lib/executions';
import type { ApiKey, IssuedApiKey } from '@/lib/types';
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
  TableWrap,
} from '@/components/ui/primitives';

/**
 * Les clefs d'API.
 *
 * Deux questions se posent devant cet ecran, et une seule a la fois : « qu'est-ce
 * qui peut appeler mon installation ? » et « puis-je couper celle-ci sans rien
 * casser ? ». D'ou les deux colonnes qui comptent -- ce a quoi la clef sert, et
 * quand elle a servi pour la derniere fois.
 *
 * Les clefs revoquees ne sont pas listees : une liste ou l'on doit distinguer
 * les vivantes des mortes se lit mal, et ce n'est jamais la question qu'on pose.
 */
export function Clefs() {
  const { t, i18n } = useTranslation();
  const { droit } = useSession();
  const queryClient = useQueryClient();
  const [emise, setEmise] = useState<IssuedApiKey | null>(null);

  const { data: clefs, isPending } = useQuery({
    queryKey: ['clefs'],
    queryFn: () => api.get<ApiKey[]>('/apikeys'),
  });

  const revocation = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/apikeys/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clefs'] });
    },
  });

  const peutCreer = droit('apikey', 'create') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('clefs.titre')} description={t('clefs.intro')} />

      {emise ? (
        <ClefEmise
          clef={emise}
          onFini={() => {
            setEmise(null);
          }}
        />
      ) : (
        peutCreer && (
          <Formulaire
            onEmise={(clef) => {
              setEmise(clef);
            }}
          />
        )
      )}

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {clefs && clefs.length === 0 && (
        <EmptyState title={t('clefs.aucune')} description={t('clefs.aucuneAide')} />
      )}

      {clefs && clefs.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-line text-faint border-b text-left text-[11px] tracking-wider uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">{t('clefs.nom')}</th>
                <th className="px-3 py-2 font-semibold">{t('clefs.perimetre')}</th>
                <th className="px-3 py-2 font-semibold">{t('clefs.derniereUtilisation')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {clefs.map((clef) => (
                <tr key={clef.id} className="hover:bg-sunken">
                  <td className="px-3 py-2">
                    <span className="text-ink">{clef.name}</span>
                    <span className="text-faint block font-mono text-xs">{clef.prefix}…</span>
                  </td>
                  <td className="text-muted px-3 py-2 text-xs">
                    {clef.entity.name} · {clef.profile.name}
                    {clef.includeSubEntities && (
                      <Badge ton="marque" className="ml-2">
                        {t('session.badgeSousEntites')}
                      </Badge>
                    )}
                    <span className="text-faint block">{clef.owner.displayName}</span>
                  </td>
                  <td className="text-muted px-3 py-2 text-xs whitespace-nowrap">
                    {clef.lastUsedAt
                      ? instantLisible(clef.lastUsedAt, i18n.language)
                      : t('clefs.jamaisUtilisee')}
                    <span className="text-faint block">
                      {clef.expiresAt
                        ? `${t('clefs.expire')} ${instantLisible(clef.expiresAt, i18n.language)}`
                        : t('clefs.sansExpiration')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {droit('apikey', 'delete') !== undefined && (
                      <Button
                        variante="danger"
                        taille="sm"
                        disabled={revocation.isPending}
                        onClick={() => {
                          if (window.confirm(t('clefs.confirmerRevocation'))) {
                            revocation.mutate(clef.id);
                          }
                        }}
                      >
                        {t('clefs.revoquer')}
                      </Button>
                    )}
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
 * La clef, montree une seule fois.
 *
 * Elle remplace le formulaire au lieu de s'ajouter sous lui : tant qu'on ne l'a
 * pas copiee, il n'y a rien d'autre a faire sur cet ecran, et proposer d'en
 * creer une seconde pendant qu'on regarde la premiere invite a la perdre.
 */
function ClefEmise({ clef, onFini }: { clef: IssuedApiKey; onFini: () => void }) {
  const { t } = useTranslation();
  const [copiee, setCopiee] = useState(false);

  return (
    <Card>
      <CardHeader title={`${t('clefs.creee')} — ${clef.name}`} />
      <CardBody className="space-y-3">
        <Notice ton="attention">{t('clefs.copierMaintenant')}</Notice>

        <div className="border-line bg-sunken flex flex-wrap items-center gap-3 border p-3">
          <code className="text-ink min-w-0 flex-1 font-mono text-xs break-all">{clef.token}</code>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(clef.token).then(() => {
                setCopiee(true);
              });
            }}
          >
            {copiee ? t('clefs.copiee') : t('clefs.copier')}
          </Button>
        </div>

        <Button variante="primaire" onClick={onFini}>
          {t('clefs.jaiCompris')}
        </Button>
      </CardBody>
    </Card>
  );
}

function Formulaire({ onEmise }: { onEmise: (clef: IssuedApiKey) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [nom, setNom] = useState('');
  const [jours, setJours] = useState('');
  const [refus, setRefus] = useState<string | null>(null);

  const creation = useMutation({
    mutationFn: () =>
      api.post<IssuedApiKey>('/apikeys', {
        name: nom,
        ...(jours.trim() === '' ? {} : { expiresInDays: Number(jours) }),
      }),
    onSuccess: async (clef) => {
      setNom('');
      setJours('');
      await queryClient.invalidateQueries({ queryKey: ['clefs'] });
      onEmise(clef);
    },
    onError: (erreur: unknown) => {
      setRefus(erreur instanceof ApiError ? erreur.message : t('commun.erreurInattendue'));
    },
  });

  return (
    <form
      className="border-line bg-sunken space-y-3 border p-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        creation.mutate();
      }}
    >
      {refus && <Notice ton="critique">{refus}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('clefs.nom')} hint={t('clefs.nomAide')} className="min-w-64 flex-1">
          <Input
            value={nom}
            required
            onChange={(evenement) => {
              setNom(evenement.target.value);
            }}
          />
        </Field>

        <Field label={t('clefs.expiration')} hint={t('clefs.expirationAide')} className="w-40">
          <Input
            type="number"
            min={1}
            max={3650}
            value={jours}
            placeholder={t('clefs.sansExpiration')}
            onChange={(evenement) => {
              setJours(evenement.target.value);
            }}
          />
        </Field>

        <Button type="submit" variante="primaire" disabled={creation.isPending}>
          {t('clefs.creer')}
        </Button>
      </div>
    </form>
  );
}
