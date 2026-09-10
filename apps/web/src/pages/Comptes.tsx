import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Authorization, EntityRef, ProfileDetail, UserSummary } from '@/lib/types';
import {
  BOUTON_SM,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Pastille,
  Select,
} from '@/components/ui/primitives';

/**
 * Administration des comptes.
 *
 * Ce que l'ecran montre est deja filtre par le serveur : la liste passe par une
 * jointure sur les habilitations, si bien qu'un administrateur de branche ne voit
 * que sa branche. L'interface ne refiltre rien -- elle afficherait autre chose
 * que le serveur, et l'un des deux aurait tort.
 */
export function Comptes() {
  const { t } = useTranslation();
  const { droit, context } = useSession();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);

  const { data: comptes, isPending } = useQuery({
    queryKey: ['comptes'],
    queryFn: () => api.get<UserSummary[]>('/users'),
  });

  const { data: entites } = useQuery({
    queryKey: ['entites'],
    queryFn: () => api.get<EntityRef[]>('/entities'),
  });

  const { data: profils } = useQuery({
    queryKey: ['profils'],
    queryFn: () => api.get<ProfileDetail[]>('/profiles'),
    // Sans le droit de lire les profils, le selecteur reste vide plutot que de
    // faire echouer l'ecran entier sur un 403.
    enabled: droit('profile', 'read') !== undefined,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['comptes'] });
  };

  const surErreur = (cause: unknown): void => {
    setErreur(cause instanceof ApiError ? cause.message : t('commun.erreurInattendue'));
  };

  const creation = useMutation({
    mutationFn: (corps: unknown) => api.post<UserSummary>('/users', corps),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const modification = useMutation({
    mutationFn: ({ id, corps }: { id: number; corps: unknown }) =>
      api.patch<UserSummary>(`/users/${String(id)}`, corps),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const suppression = useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/users/${String(id)}`),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const habilitation = useMutation({
    mutationFn: ({ id, corps }: { id: number; corps: unknown }) =>
      api.post<UserSummary>(`/users/${String(id)}/authorizations`, corps),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const retrait = useMutation({
    mutationFn: ({
      id,
      entityId,
      profileId,
    }: {
      id: number;
      entityId: number;
      profileId: number;
    }) =>
      api.delete<UserSummary>(
        `/users/${String(id)}/authorizations/${String(entityId)}/${String(profileId)}`,
      ),
    onSuccess: rafraichir,
    onError: surErreur,
  });

  const reinitialisation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api.post<{ ok: true }>(`/users/${String(id)}/password`, { password }),
    onSuccess: async () => {
      setErreur(null);
      await rafraichir();
    },
    onError: surErreur,
  });

  const peutCreer = droit('user', 'create') !== undefined;
  const peutModifier = droit('user', 'update') !== undefined;
  const peutSupprimer = droit('user', 'delete') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('comptes.titre')} description={t('comptes.intro')} />

      {erreur && <Notice ton="critique">{erreur}</Notice>}

      {peutCreer && (
        <FormulaireCreation
          entites={entites ?? []}
          profils={profils ?? []}
          enCours={creation.isPending}
          onSoumettre={(corps) => {
            setErreur(null);
            creation.mutate(corps);
          }}
        />
      )}

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {comptes && comptes.length === 0 && (
        <EmptyState title={t('comptes.aucun')} description={t('comptes.aucunAide')} />
      )}

      <div className="space-y-3">
        {(comptes ?? []).map((compte) => (
          <Card key={compte.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{compte.displayName}</span>
                  <span className="text-faint font-mono text-xs">{compte.username}</span>
                  {compte.isActive ? (
                    <Pastille ton="positif">{t('comptes.actif')}</Pastille>
                  ) : (
                    <Pastille ton="attention">{t('comptes.inactif')}</Pastille>
                  )}
                  {compte.mustChangePassword && (
                    <Badge ton="attention">{t('comptes.changementImpose')}</Badge>
                  )}
                  {compte.authSource === 'ldap' && (
                    <Badge ton="info">{t('comptes.annuaire')}</Badge>
                  )}
                  {/* Se reconnaitre dans la liste evite de se desactiver soi-meme
                      par distraction -- ce que le serveur refuse, mais apres coup. */}
                  {compte.id === context?.user.id && <Badge ton="marque">vous</Badge>}
                </span>
              }
              action={
                <button
                  type="button"
                  className={BOUTON_SM}
                  onClick={() => {
                    setOuvert(ouvert === compte.id ? null : compte.id);
                  }}
                >
                  {ouvert === compte.id ? t('commun.fermer') : t('commun.modifier')}
                </button>
              }
            />

            {ouvert === compte.id && (
              <CardBody className="space-y-4">
                <Habilitations
                  compte={compte}
                  entites={entites ?? []}
                  profils={profils ?? []}
                  modifiable={peutModifier}
                  onAjouter={(corps) => {
                    setErreur(null);
                    habilitation.mutate({ id: compte.id, corps });
                  }}
                  onRetirer={(entityId, profileId) => {
                    setErreur(null);
                    retrait.mutate({ id: compte.id, entityId, profileId });
                  }}
                />

                {peutModifier && (
                  <div className="border-line flex flex-wrap items-end gap-3 border-t pt-4">
                    {compte.authSource === 'local' ? (
                      <ReinitialisationMotDePasse
                        enCours={reinitialisation.isPending}
                        onSoumettre={(password) => {
                          setErreur(null);
                          reinitialisation.mutate({ id: compte.id, password });
                        }}
                      />
                    ) : (
                      <p className="text-muted text-sm">{t('comptes.annuaireAide')}</p>
                    )}

                    <Button
                      taille="sm"
                      onClick={() => {
                        setErreur(null);
                        modification.mutate({
                          id: compte.id,
                          corps: { isActive: !compte.isActive },
                        });
                      }}
                    >
                      {compte.isActive ? t('comptes.desactiver') : t('comptes.reactiver')}
                    </Button>

                    {peutSupprimer && (
                      <Button
                        variante="danger"
                        taille="sm"
                        onClick={() => {
                          if (!confirm(t('comptes.confirmerSuppression'))) return;

                          setErreur(null);
                          suppression.mutate(compte.id);
                        }}
                      >
                        {t('commun.supprimer')}
                      </Button>
                    )}
                  </div>
                )}
              </CardBody>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function FormulaireCreation({
  entites,
  profils,
  enCours,
  onSoumettre,
}: {
  entites: EntityRef[];
  profils: ProfileDetail[];
  enCours: boolean;
  onSoumettre: (corps: unknown) => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [entityId, setEntityId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [isRecursive, setIsRecursive] = useState(false);

  return (
    <Card>
      <CardHeader title={t('comptes.nouveau')} />
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(evenement) => {
            evenement.preventDefault();

            onSoumettre({
              username: username.trim(),
              password,
              firstName: firstName.trim() || null,
              lastName: lastName.trim() || null,
              authorization: {
                entityId: Number(entityId),
                profileId: Number(profileId),
                isRecursive,
              },
            });

            setUsername('');
            setPassword('');
            setFirstName('');
            setLastName('');
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('comptes.identifiant')}>
              <Input
                value={username}
                onChange={(evenement) => {
                  setUsername(evenement.target.value);
                }}
                autoComplete="off"
                required
              />
            </Field>
            <Field label={t('comptes.motDePasseInitial')} hint={t('comptes.motDePasseInitialAide')}>
              <Input
                type="password"
                value={password}
                onChange={(evenement) => {
                  setPassword(evenement.target.value);
                }}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <Field label={t('comptes.prenom')}>
              <Input
                value={firstName}
                onChange={(evenement) => {
                  setFirstName(evenement.target.value);
                }}
              />
            </Field>
            <Field label={t('comptes.nom')}>
              <Input
                value={lastName}
                onChange={(evenement) => {
                  setLastName(evenement.target.value);
                }}
              />
            </Field>
          </div>

          <fieldset className="border-line bg-sunken space-y-3 border p-3">
            <legend className="text-faint px-1 text-[11px] font-semibold tracking-wider uppercase">
              {t('comptes.habilitationInitiale')}
            </legend>
            <p className="text-muted text-xs">{t('comptes.habilitationInitialeAide')}</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('comptes.entite')} className="min-w-56 flex-1">
                <Select
                  value={entityId}
                  onChange={(evenement) => {
                    setEntityId(evenement.target.value);
                  }}
                  required
                >
                  <option value="">—</option>
                  {entites.map((entite) => (
                    <option key={entite.id} value={entite.id}>
                      {entite.completeName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('comptes.profil')} className="min-w-48 flex-1">
                <Select
                  value={profileId}
                  onChange={(evenement) => {
                    setProfileId(evenement.target.value);
                  }}
                  required
                >
                  <option value="">—</option>
                  {profils.map((profil) => (
                    <option key={profil.id} value={profil.id}>
                      {profil.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox
                label={t('comptes.recursif')}
                checked={isRecursive}
                onChange={(evenement) => {
                  setIsRecursive(evenement.target.checked);
                }}
              />
            </div>
          </fieldset>

          <Button type="submit" variante="primaire" disabled={enCours}>
            {t('comptes.nouveau')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Habilitations({
  compte,
  entites,
  profils,
  modifiable,
  onAjouter,
  onRetirer,
}: {
  compte: UserSummary;
  entites: EntityRef[];
  profils: ProfileDetail[];
  modifiable: boolean;
  onAjouter: (corps: unknown) => void;
  onRetirer: (entityId: number, profileId: number) => void;
}) {
  const { t } = useTranslation();
  const [entityId, setEntityId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [isRecursive, setIsRecursive] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-faint text-[11px] font-semibold tracking-wider uppercase">
        {t('comptes.habilitations')}
      </p>

      <ul className="space-y-1.5">
        {compte.authorizations.map((droit: Authorization) => (
          <li
            key={`${String(droit.entity.id)}:${String(droit.profile.id)}`}
            className="border-line flex flex-wrap items-center gap-2 border-b pb-1.5 text-sm last:border-b-0"
          >
            <span className="text-ink">{droit.entity.completeName}</span>
            <Badge>{droit.profile.name}</Badge>
            {droit.isRecursive && <Badge ton="marque">{t('session.badgeSousEntites')}</Badge>}
            {/* Une habilitation d'annuaire ne se retire pas ici : elle
                reviendrait a la prochaine synchronisation. */}
            {droit.isDynamic && <Badge ton="info">{t('comptes.annuaire')}</Badge>}
            {modifiable && !droit.isDynamic && (
              <button
                type="button"
                className="text-muted hover:text-critical ml-auto text-xs underline-offset-2 hover:underline"
                onClick={() => {
                  onRetirer(droit.entity.id, droit.profile.id);
                }}
              >
                {t('comptes.retirer')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {modifiable && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(evenement) => {
            evenement.preventDefault();

            onAjouter({
              entityId: Number(entityId),
              profileId: Number(profileId),
              isRecursive,
            });
          }}
        >
          <Field label={t('comptes.entite')} className="min-w-48 flex-1">
            <Select
              value={entityId}
              onChange={(evenement) => {
                setEntityId(evenement.target.value);
              }}
              required
            >
              <option value="">—</option>
              {entites.map((entite) => (
                <option key={entite.id} value={entite.id}>
                  {entite.completeName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('comptes.profil')} className="min-w-40 flex-1">
            <Select
              value={profileId}
              onChange={(evenement) => {
                setProfileId(evenement.target.value);
              }}
              required
            >
              <option value="">—</option>
              {profils.map((profil) => (
                <option key={profil.id} value={profil.id}>
                  {profil.name}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label={t('comptes.recursif')}
            checked={isRecursive}
            onChange={(evenement) => {
              setIsRecursive(evenement.target.checked);
            }}
          />
          <Button type="submit" taille="sm">
            {t('comptes.ajouter')}
          </Button>
        </form>
      )}
    </div>
  );
}

function ReinitialisationMotDePasse({
  enCours,
  onSoumettre,
}: {
  enCours: boolean;
  onSoumettre: (motDePasse: string) => void;
}) {
  const { t } = useTranslation();
  const [motDePasse, setMotDePasse] = useState('');

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        onSoumettre(motDePasse);
        setMotDePasse('');
      }}
    >
      <Field label={t('comptes.nouveauMotDePasse')} className="min-w-56">
        <Input
          type="password"
          value={motDePasse}
          onChange={(evenement) => {
            setMotDePasse(evenement.target.value);
          }}
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <Button type="submit" taille="sm" disabled={enCours}>
        {t('comptes.reinitialiser')}
      </Button>
    </form>
  );
}
