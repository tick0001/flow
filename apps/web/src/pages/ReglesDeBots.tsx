import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BotRule, BotSummary, EntityRef, ProfileRef } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';

/**
 * Ou chaque bot est propose, et a qui.
 *
 * Le catalogue des bots est **global a l'installation** : un bot est un dossier
 * sur le disque, pas un objet rattache a une entite. Cet ecran est donc le seul
 * endroit qui decide de sa mise a disposition, sur deux axes qui repondent a
 * deux questions distinctes : l'entite dit *ou* le bot a le droit de tourner, le
 * profil dit *qui*, la-bas, peut le lancer.
 *
 * **L'absence de regle vaut refus**, comme partout ailleurs dans le modele de
 * droits. C'est ce qui rend l'encart de tete necessaire : un bot depose et
 * jamais ouvert n'apparait dans aucun catalogue, et rien, vu du poste de
 * quelqu'un d'autre, ne distingue ce refus d'une panne.
 */
export function ReglesDeBots() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);

  const regles = useQuery({
    queryKey: ['regles-de-bots'],
    queryFn: () => api.get<BotRule[]>('/bots/regles'),
  });

  // Le catalogue sert a proposer les identifiants de bots plutot qu'a les faire
  // taper : un identifiant mal orthographie produit une regle qui n'ouvre rien,
  // et rien ne le signale -- la table `bot_rules` accepte un `bot_id` libre,
  // puisqu'on prepare parfois l'ouverture avant la livraison.
  const bots = useQuery({
    queryKey: ['bots'],
    queryFn: () => api.get<BotSummary[]>('/bots'),
  });

  const profils = useQuery({
    queryKey: ['profils'],
    queryFn: () => api.get<ProfileRef[]>('/profiles'),
  });

  const entites = useQuery({
    queryKey: ['entites'],
    queryFn: () => api.get<EntityRef[]>('/entities'),
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['regles-de-bots'] });
    // Le catalogue change avec les regles : sans cela, un bot ouvert a l'instant
    // resterait marque ferme jusqu'au prochain passage sur l'ecran des bots.
    await queryClient.invalidateQueries({ queryKey: ['bots'] });
  };

  const creer = useMutation({
    mutationFn: (corps: {
      botId: string;
      entityId: number;
      isRecursive: boolean;
      profileId: number | null;
    }) => api.post<BotRule>('/bots/regles', corps),
    onSuccess: async () => {
      setOuvert(false);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.delete<void>(`/bots/regles/${String(id)}`),
    onSuccess: rafraichir,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('reglesDeBots.titre')}
        description={t('reglesDeBots.intro')}
        action={
          <Button
            variante="primaire"
            onClick={() => {
              setOuvert((precedent) => !precedent);
            }}
          >
            {ouvert ? t('commun.annuler') : t('reglesDeBots.nouvelle')}
          </Button>
        }
      />

      <Notice ton="info">{t('reglesDeBots.sansRegle')}</Notice>

      {creer.error && <p className="text-critical-ink text-sm">{creer.error.message}</p>}
      {supprimer.error && <p className="text-critical-ink text-sm">{supprimer.error.message}</p>}

      {ouvert && (
        <Card>
          <CardHeader title={t('reglesDeBots.nouvelle')} />
          <CardBody>
            <form
              className="space-y-4"
              onSubmit={(evenement) => {
                evenement.preventDefault();

                const formulaire = new FormData(evenement.currentTarget);
                const champ = (nom: string): string => {
                  const valeur = formulaire.get(nom);

                  return typeof valeur === 'string' ? valeur : '';
                };

                const profil = champ('profileId');

                creer.mutate({
                  botId: champ('botId'),
                  entityId: Number(champ('entityId')),
                  isRecursive: champ('isRecursive') !== 'non',
                  // Chaine vide : tous les profils. Le contrat l'attend a nul.
                  profileId: profil === '' ? null : Number(profil),
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('reglesDeBots.bot')} hint={t('reglesDeBots.botAide')}>
                  <Select name="botId" required defaultValue="">
                    <option value="" disabled>
                      {t('commun.choisir')}
                    </option>
                    {(bots.data ?? []).map((bot) => (
                      <option key={bot.manifest.id} value={bot.manifest.id}>
                        {bot.manifest.name} — {bot.manifest.id}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('reglesDeBots.entite')}>
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
                <Field label={t('reglesDeBots.profil')} hint={t('reglesDeBots.profilAide')}>
                  <Select name="profileId" defaultValue="">
                    <option value="">{t('reglesDeBots.tousLesProfils')}</option>
                    {(profils.data ?? []).map((profil) => (
                      <option key={profil.id} value={profil.id}>
                        {profil.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('reglesDeBots.portee')} hint={t('reglesDeBots.porteeAide')}>
                  <Select name="isRecursive" defaultValue="oui">
                    <option value="oui">{t('reglesDeBots.porteeRecursive')}</option>
                    <option value="non">{t('reglesDeBots.porteeEntite')}</option>
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
        <EmptyState title={t('reglesDeBots.aucune')} description={t('reglesDeBots.aucuneAide')} />
      )}

      {regles.data && regles.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('reglesDeBots.bot')}</Th>
              <Th>{t('reglesDeBots.entite')}</Th>
              <Th>{t('reglesDeBots.profil')}</Th>
              <Th>{t('reglesDeBots.portee')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {regles.data.map((regle) => (
              <Tr key={regle.id}>
                <Td className="text-ink font-mono text-xs">{regle.botId}</Td>
                <Td className="text-muted">{regle.entity.completeName}</Td>
                <Td>
                  {regle.profile ? (
                    <span className="text-ink">{regle.profile.name}</span>
                  ) : (
                    <Badge>{t('reglesDeBots.tousLesProfils')}</Badge>
                  )}
                </Td>
                <Td>
                  {regle.isRecursive ? (
                    <Badge ton="marque">{t('reglesDeBots.porteeRecursive')}</Badge>
                  ) : (
                    <span className="text-faint text-xs">{t('reglesDeBots.porteeEntite')}</span>
                  )}
                </Td>
                <Td className="text-right">
                  <Button
                    taille="sm"
                    variante="danger"
                    onClick={() => {
                      supprimer.mutate(regle.id);
                    }}
                  >
                    {t('commun.supprimer')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
