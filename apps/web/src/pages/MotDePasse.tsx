import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import { Button, Field, Input, Marque, Notice } from '@/components/ui/primitives';

/**
 * Changement de mot de passe impose.
 *
 * Cet ecran **remplace** l'application tant que le drapeau est pose : proposer
 * une navigation a cote laisserait quelqu'un travailler des mois avec le mot de
 * passe qu'un guide d'installation publie.
 */
export function MotDePasse() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement: FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);

    // Verifie ici parce que le serveur ne peut pas le faire : il ne recoit que
    // le nouveau mot de passe, pas sa confirmation. Le lui envoyer pour qu'il
    // compare deux valeurs identiques n'apporterait rien.
    if (nouveau !== confirmation) {
      setErreur(t('motDePasse.discordance'));

      return;
    }

    if (nouveau.length < 12) {
      setErreur(t('motDePasse.tropCourt'));

      return;
    }

    setEnCours(true);

    try {
      await api.post('/auth/password', { currentPassword: actuel, newPassword: nouveau });
      // Relire la session plutot que modifier le cache a la main : c'est le
      // serveur qui decide si le drapeau tombe.
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.status === 401) {
        setErreur(t('motDePasse.actuelIncorrect'));
      } else if (cause instanceof ApiError && cause.status === 400) {
        setErreur(t('motDePasse.identiqueALAncien'));
      } else {
        setErreur(t('commun.erreurInattendue'));
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={(evenement) => {
          void soumettre(evenement);
        }}
        className="w-full max-w-md space-y-5"
      >
        <div className="flex items-center gap-3">
          <Marque />
          <h1 className="text-ink text-lg font-bold tracking-tight">{t('motDePasse.titre')}</h1>
        </div>

        <Notice ton="attention">{t('motDePasse.impose')}</Notice>

        {erreur && <Notice ton="critique">{erreur}</Notice>}

        <Field label={t('motDePasse.actuel')}>
          <Input
            type="password"
            value={actuel}
            onChange={(evenement) => {
              setActuel(evenement.target.value);
            }}
            autoComplete="current-password"
            autoFocus
            required
          />
        </Field>

        <Field label={t('motDePasse.nouveau')} hint={t('motDePasse.tropCourt')}>
          <Input
            type="password"
            value={nouveau}
            onChange={(evenement) => {
              setNouveau(evenement.target.value);
            }}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label={t('motDePasse.confirmation')}>
          <Input
            type="password"
            value={confirmation}
            onChange={(evenement) => {
              setConfirmation(evenement.target.value);
            }}
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" variante="primaire" className="w-full" disabled={enCours}>
          {t('motDePasse.valider')}
        </Button>
      </form>
    </div>
  );
}
