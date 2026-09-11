import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DirectoryRule, EntityRef, ProfileRef } from '@/lib/types';
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
  Select,
  TableWrap,
} from '@/components/ui/primitives';

/**
 * Les regles d'affectation depuis l'annuaire.
 *
 * L'ecran dit une chose et une seule : **ce qu'un groupe d'annuaire donne**.
 * Le reste -- qui est dans ce groupe, comment l'annuaire le sait -- appartient a
 * l'annuaire, et Flow& n'a pas a en tenir une seconde version.
 *
 * Un compte d'annuaire qui se connecte sans qu'aucune regle ne corresponde est
 * le cas le plus penible a diagnostiquer : le mot de passe etait bon, l'annuaire
 * a repondu, et pourtant l'application refuse. D'ou l'encart en tete, qui le dit
 * avant qu'on ne le vive.
 */
export function Annuaire() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);

  const regles = useQuery({
    queryKey: ['regles-annuaire'],
    queryFn: () => api.get<DirectoryRule[]>('/directory/rules'),
  });

  const profils = useQuery({
    queryKey: ['profils'],
    queryFn: () => api.get<ProfileRef[]>('/profiles'),
  });

  const entites = useQuery({
    queryKey: ['entites'],
    queryFn: () => api.get<EntityRef[]>('/entities'),
  });

  const rafraichir = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['regles-annuaire'] });

  const creer = useMutation({
    mutationFn: (corps: {
      groupName: string;
      profileId: number;
      entityId: number;
      isRecursive: boolean;
    }) => api.post<DirectoryRule>('/directory/rules', corps),
    onSuccess: async () => {
      setOuvert(false);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/directory/rules/${String(id)}`),
    onSuccess: rafraichir,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('annuaire.titre')}
        description={t('annuaire.intro')}
        action={
          <Button
            variante="primaire"
            onClick={() => {
              setOuvert((precedent) => !precedent);
            }}
          >
            {ouvert ? t('commun.annuler') : t('annuaire.nouvelle')}
          </Button>
        }
      />

      <Notice ton="info">{t('annuaire.sansRegle')}</Notice>

      {creer.error && <p className="text-critical-ink text-sm">{creer.error.message}</p>}
      {supprimer.error && <p className="text-critical-ink text-sm">{supprimer.error.message}</p>}

      {ouvert && (
        <Card>
          <CardHeader title={t('annuaire.nouvelle')} />
          <CardBody>
            <form
              className="space-y-4"
              onSubmit={(evenement) => {
                evenement.preventDefault();

                const formulaire = new FormData(evenement.currentTarget);
                // `FormData.get` rend aussi un `File` : la valeur d'un champ
                // texte ne l'est jamais, mais le type ne le sait pas.
                const champ = (nom: string): string => {
                  const valeur = formulaire.get(nom);

                  return typeof valeur === 'string' ? valeur : '';
                };

                creer.mutate({
                  groupName: champ('groupName'),
                  profileId: Number(champ('profileId')),
                  entityId: Number(champ('entityId')),
                  isRecursive: champ('isRecursive') === 'oui',
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('annuaire.groupe')} hint={t('annuaire.groupeAide')}>
                  <Input name="groupName" required maxLength={200} placeholder="Exploitation" />
                </Field>
                <Field label={t('annuaire.profil')}>
                  <Select name="profileId" required defaultValue="">
                    <option value="" disabled>
                      {t('commun.choisir')}
                    </option>
                    {(profils.data ?? []).map((profil) => (
                      <option key={profil.id} value={profil.id}>
                        {profil.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('annuaire.entite')}>
                  <Select name="entityId" required defaultValue="">
                    <option value="" disabled>
                      {t('commun.choisir')}
                    </option>
                    {(entites.data ?? []).map((entite) => (
                      <option key={entite.id} value={entite.id}>
                        {entite.completeName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('annuaire.portee')} hint={t('annuaire.porteeAide')}>
                  <Select name="isRecursive" defaultValue="non">
                    <option value="non">{t('annuaire.porteeEntite')}</option>
                    <option value="oui">{t('annuaire.porteeRecursive')}</option>
                  </Select>
                </Field>
              </div>

              <Button type="submit" variante="primaire" disabled={creer.isPending}>
                {t('commun.enregistrer')}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {regles.isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}
      {regles.error && <p className="text-critical-ink text-sm">{t('erreurs.serveur')}</p>}

      {regles.data && regles.data.length === 0 && (
        <EmptyState title={t('annuaire.aucune')} description={t('annuaire.aucuneAide')} />
      )}

      {regles.data && regles.data.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead className="border-line text-faint border-b text-left text-[11px] tracking-wider uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">{t('annuaire.groupe')}</th>
                <th className="px-3 py-2 font-semibold">{t('annuaire.profil')}</th>
                <th className="px-3 py-2 font-semibold">{t('annuaire.entite')}</th>
                <th className="px-3 py-2 font-semibold">{t('annuaire.portee')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {regles.data.map((regle) => (
                <tr key={regle.id} className="hover:bg-sunken">
                  <td className="text-ink px-3 py-2 font-mono">{regle.groupName}</td>
                  <td className="text-ink px-3 py-2">{regle.profile.name}</td>
                  <td className="text-muted px-3 py-2">{regle.entity.completeName}</td>
                  <td className="px-3 py-2">
                    {regle.isRecursive ? (
                      <Badge ton="marque">{t('annuaire.porteeRecursive')}</Badge>
                    ) : (
                      <span className="text-faint text-xs">{t('annuaire.porteeEntite')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      taille="sm"
                      variante="danger"
                      onClick={() => {
                        supprimer.mutate(regle.id);
                      }}
                    >
                      {t('commun.supprimer')}
                    </Button>
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
