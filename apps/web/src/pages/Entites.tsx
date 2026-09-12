import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { EntityRef } from '@/lib/types';
import {
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';

/**
 * L'arbre des entites.
 *
 * Affiche a plat, avec une indentation tiree du niveau : la liste vient triee
 * par chemin, donc un parent precede toujours ses enfants et les fratries se
 * suivent. Un composant d'arbre repliable donnerait la meme information au prix
 * d'un etat a tenir, pour une profondeur qui depasse rarement trois.
 *
 * Ce que cette page ne montre pas est aussi important : les entites d'une autre
 * branche. Aucun filtre n'est ecrit ici -- c'est la base qui refuse.
 */
export function Entites() {
  const { t } = useTranslation();
  const { droit } = useSession();
  const queryClient = useQueryClient();
  const [nom, setNom] = useState('');
  const [parent, setParent] = useState<string>('');

  const { data: entites, isPending } = useQuery({
    queryKey: ['entites'],
    queryFn: () => api.get<EntityRef[]>('/entities'),
  });

  const creation = useMutation({
    mutationFn: (donnees: { name: string; parentId: number }) =>
      api.post<EntityRef>('/entities', donnees),
    onSuccess: async () => {
      setNom('');
      await queryClient.invalidateQueries({ queryKey: ['entites'] });
    },
  });

  const peutCreer = droit('entity', 'create') !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('entites.titre')} description={t('entites.intro')} />

      {peutCreer && (
        <form
          className="border-line bg-sunken flex flex-wrap items-end gap-3 border p-3"
          onSubmit={(evenement) => {
            evenement.preventDefault();

            const parentId = Number(parent);

            if (!nom.trim() || !Number.isInteger(parentId) || parentId <= 0) return;

            creation.mutate({ name: nom.trim(), parentId });
          }}
        >
          <Field label={t('entites.nom')} className="min-w-48 flex-1">
            <Input
              value={nom}
              onChange={(evenement) => {
                setNom(evenement.target.value);
              }}
              required
            />
          </Field>

          <Field label={t('entites.parent')} className="min-w-56 flex-1">
            <Select
              value={parent}
              onChange={(evenement) => {
                setParent(evenement.target.value);
              }}
              required
            >
              <option value="">—</option>
              {(entites ?? []).map((entite) => (
                <option key={entite.id} value={entite.id}>
                  {entite.completeName}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit" variante="primaire" disabled={creation.isPending}>
            {t('entites.nouvelle')}
          </Button>
        </form>
      )}

      {isPending && <p className="text-muted text-sm">{t('commun.chargement')}</p>}

      {entites && entites.length === 0 && <EmptyState title={t('entites.aucune')} />}

      {entites && entites.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('entites.nom')}</Th>
              <Th>Chemin</Th>
            </tr>
          </thead>
          <tbody>
            {entites.map((entite) => (
              <Tr key={entite.id}>
                <Td className="text-ink">
                  <span style={{ paddingLeft: `${String(entite.level * 16)}px` }}>
                    {entite.level > 0 && <span className="text-faint mr-1.5">└</span>}
                    {entite.name}
                  </span>
                </Td>
                <Td className="font-mono text-xs">{entite.path}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
