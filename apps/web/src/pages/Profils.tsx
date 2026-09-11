import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ProfileDetail, ProfileRight, RightDefinition, RightScope } from '@/lib/types';
import {
  BOUTON_SM,
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
  Select,
} from '@/components/ui/primitives';

type Matrice = Record<string, RightScope | ''>;

const clef = (objet: string, action: string): string => `${objet}:${action}`;

/**
 * Administration des profils, et la matrice de droits.
 *
 * La matrice est dessinee a partir du **catalogue servi par l'API**, jamais
 * d'une liste ecrite ici : un objet ajoute au coeur -- ou par un plugin --
 * apparait sans rien reconstruire, et un droit retire cesse d'etre proposé au
 * lieu de rester cochable sans effet.
 *
 * Chaque droit est un selecteur de portee et non une case a cocher : un droit
 * n'est pas un booleen, et une case forcerait a choisir une portee par defaut
 * dans le dos de celui qui coche.
 */
export function Profils() {
  const { t } = useTranslation();
  const { droit } = useSession();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<number | 'nouveau' | null>(null);

  const { data: catalogue } = useQuery({
    queryKey: ['catalogue-droits'],
    queryFn: () => api.get<RightDefinition[]>('/profiles/catalog'),
    // Le catalogue ne change qu'au chargement d'un plugin : inutile de le
    // relire a chaque montage d'ecran.
    staleTime: 5 * 60_000,
  });

  const { data: profils, isPending } = useQuery({
    queryKey: ['profils'],
    queryFn: () => api.get<ProfileDetail[]>('/profiles'),
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['profils'] });
    // Les droits du profil actif ont pu changer : la session les porte.
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    setOuvert(null);
  };

  const surErreur = (cause: unknown): void => {
    setErreur(cause instanceof ApiError ? cause.message : t('commun.erreurInattendue'));
  };

  const creation = useMutation({
    mutationFn: (corps: unknown) => api.post<ProfileDetail>('/profiles', corps),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const modification = useMutation({
    mutationFn: ({ id, corps }: { id: number; corps: unknown }) =>
      api.patch<ProfileDetail>(`/profiles/${String(id)}`, corps),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const suppression = useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/profiles/${String(id)}`),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const peutCreer = droit('profile', 'create') !== undefined;
  const peutModifier = droit('profile', 'update') !== undefined;
  const peutSupprimer = droit('profile', 'delete') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('profils.titre')}
        description={t('profils.intro')}
        action={
          peutCreer && (
            <Button
              variante="primaire"
              onClick={() => {
                setErreur(null);
                setOuvert(ouvert === 'nouveau' ? null : 'nouveau');
              }}
            >
              {t('profils.nouveau')}
            </Button>
          )
        }
      />

      {erreur && <Notice ton="critique">{erreur}</Notice>}

      {ouvert === 'nouveau' && catalogue && (
        <Card>
          <CardHeader title={t('profils.nouveau')} />
          <CardBody>
            <Editeur
              catalogue={catalogue}
              enCours={creation.isPending}
              onSoumettre={(corps) => {
                setErreur(null);
                creation.mutate(corps);
              }}
              onAnnuler={() => {
                setOuvert(null);
              }}
            />
          </CardBody>
        </Card>
      )}

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {profils && profils.length === 0 && <EmptyState title={t('profils.aucun')} />}

      <div className="space-y-3">
        {(profils ?? []).map((profil) => (
          <Card key={profil.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{profil.name}</span>
                  {profil.isDefault && <Badge ton="marque">{t('profils.parDefaut')}</Badge>}
                  <Badge>{t('profils.usage', { count: profil.usageCount })}</Badge>
                  {profil.rights.length === 0 && (
                    <Badge ton="attention">{t('profils.aucunDroit')}</Badge>
                  )}
                </span>
              }
              action={
                peutModifier && (
                  <button
                    type="button"
                    className={BOUTON_SM}
                    onClick={() => {
                      setErreur(null);
                      setOuvert(ouvert === profil.id ? null : profil.id);
                    }}
                  >
                    {ouvert === profil.id ? t('commun.fermer') : t('commun.modifier')}
                  </button>
                )
              }
            />

            <CardBody className="space-y-3">
              {profil.comment && <p className="text-muted text-sm">{profil.comment}</p>}

              {ouvert === profil.id && catalogue ? (
                <Editeur
                  catalogue={catalogue}
                  profil={profil}
                  enCours={modification.isPending}
                  onSoumettre={(corps) => {
                    setErreur(null);
                    modification.mutate({ id: profil.id, corps });
                  }}
                  onAnnuler={() => {
                    setOuvert(null);
                  }}
                  onSupprimer={
                    peutSupprimer
                      ? () => {
                          if (!confirm(t('profils.confirmerSuppression'))) return;

                          setErreur(null);
                          suppression.mutate(profil.id);
                        }
                      : undefined
                  }
                />
              ) : (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {profil.rights.map((regle: ProfileRight) => (
                    <li key={clef(regle.object, regle.action)} className="text-muted">
                      {t(`droits.${regle.object}.${regle.action}`)}{' '}
                      <span className="text-faint">· {t(`droits.portees.${regle.scope}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Editeur({
  catalogue,
  profil,
  enCours,
  onSoumettre,
  onAnnuler,
  onSupprimer,
}: {
  catalogue: RightDefinition[];
  profil?: ProfileDetail;
  enCours: boolean;
  onSoumettre: (corps: unknown) => void;
  onAnnuler: () => void;
  onSupprimer?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const langue = i18n.language === 'en' ? 'en' : 'fr';
  const [nom, setNom] = useState(profil?.name ?? '');
  const [commentaire, setCommentaire] = useState(profil?.comment ?? '');
  const [matrice, setMatrice] = useState<Matrice>(() =>
    Object.fromEntries(
      (profil?.rights ?? []).map((regle: ProfileRight) => [
        clef(regle.object, regle.action),
        regle.scope,
      ]),
    ),
  );

  /** Le catalogue regroupe par objet, dans son ordre de declaration. */
  const groupes = useMemo(() => {
    const parObjet = new Map<string, RightDefinition[]>();

    for (const definition of catalogue) {
      const liste = parObjet.get(definition.object) ?? [];

      liste.push(definition);
      parObjet.set(definition.object, liste);
    }

    return [...parObjet.entries()];
  }, [catalogue]);

  return (
    <form
      className="space-y-4"
      onSubmit={(evenement) => {
        evenement.preventDefault();

        onSoumettre({
          name: nom.trim(),
          comment: commentaire.trim() || null,
          // La matrice se soumet entiere : un droit absent est un droit retire.
          rights: Object.entries(matrice)
            .filter(([, portee]) => portee !== '')
            .map(([cle, portee]) => {
              const [object, action] = cle.split(':');

              return { object: object ?? '', action: action ?? '', scope: portee as RightScope };
            }),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('profils.nom')}>
          <Input
            value={nom}
            onChange={(evenement) => {
              setNom(evenement.target.value);
            }}
            required
          />
        </Field>
        <Field label={t('profils.commentaire')}>
          <Input
            value={commentaire}
            onChange={(evenement) => {
              setCommentaire(evenement.target.value);
            }}
          />
        </Field>
      </div>

      <div className="space-y-4">
        {groupes.map(([objet, definitions]) => (
          <fieldset key={objet} className="border-line border">
            <legend className="text-faint mx-2 px-1 text-[11px] font-semibold tracking-wider uppercase">
              {libelleDuGroupe(objet, definitions, langue, t)}
            </legend>
            <div className="divide-line divide-y">
              {definitions.map((definition) => {
                const cle = clef(definition.object, definition.action);

                return (
                  <label
                    key={cle}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-ink">{libelle(definition, langue, t)}</span>
                    <Select
                      className="w-auto min-w-40"
                      value={matrice[cle] ?? ''}
                      onChange={(evenement) => {
                        setMatrice((precedente) => ({
                          ...precedente,
                          [cle]: evenement.target.value as RightScope | '',
                        }));
                      }}
                    >
                      <option value="">{t('droits.portees.aucune')}</option>
                      {definition.scopes.map((portee) => (
                        <option key={portee} value={portee}>
                          {t(`droits.portees.${portee}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {profil && profil.usageCount > 0 && (
        <Notice ton="attention">{t('profils.usageGlobal')}</Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variante="primaire" disabled={enCours}>
          {t('commun.enregistrer')}
        </Button>
        <Button onClick={onAnnuler}>{t('commun.annuler')}</Button>
        {onSupprimer && (
          <Button variante="danger" taille="sm" className="ml-auto" onClick={onSupprimer}>
            {t('commun.supprimer')}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Le libelle d'un droit.
 *
 * Un droit du coeur porte une clef, resolue dans les dictionnaires. Un droit de
 * plugin porte son libelle avec lui : il arrive apres la construction de
 * l'interface, et aucune clef ne peut donc l'attendre. Le libelle porte gagne
 * quand il est la -- sans quoi la matrice afficherait la clef brute, ce
 * qu'i18next rend faute de mieux.
 */
function libelle(
  definition: RightDefinition,
  langue: 'fr' | 'en',
  t: (clef: string) => string,
): string {
  return definition.label?.[langue] ?? t(definition.labelKey);
}

/** Le libelle d'un groupe : le nom du plugin, ou la clef du coeur. */
function libelleDuGroupe(
  objet: string,
  definitions: RightDefinition[],
  langue: 'fr' | 'en',
  t: (clef: string) => string,
): string {
  return definitions[0]?.groupLabel?.[langue] ?? t(`droits.objets.${objet}`);
}
