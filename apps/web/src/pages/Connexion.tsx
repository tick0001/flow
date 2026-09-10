import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Field, Input, Marque, Notice } from '@/components/ui/primitives';

/**
 * Ecran de connexion.
 *
 * Le seul endroit ou l'on s'adresse a quelqu'un qui n'est pas encore entre. La
 * colonne de gauche porte l'identite, celle de droite le formulaire : sur un
 * ecran large, un formulaire seul au centre d'une page vide ne dit pas dans quel
 * outil on entre.
 */
export function Connexion() {
  const { t } = useTranslation();
  const { connecter } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement: FormEvent): Promise<void> {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);

    try {
      await connecter(identifiant, motDePasse);
    } catch (cause: unknown) {
      // Le serveur rend le meme message pour un identifiant inconnu, un mot de
      // passe faux et un compte desactive : les distinguer ici reintroduirait
      // l'oracle d'existence de comptes que le serveur prend soin d'eviter.
      if (cause instanceof ApiError) {
        if (cause.status === 429) setErreur(t('connexion.tropDeTentatives'));
        else if (cause.status === 0) setErreur(t('erreurs.reseau'));
        else if (cause.message.includes('habilitation'))
          setErreur(t('connexion.aucuneHabilitation'));
        else if (cause.status === 401) setErreur(t('connexion.echec'));
        else setErreur(t('connexion.indisponible'));
      } else {
        setErreur(t('commun.erreurInattendue'));
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="border-line bg-sunken hidden flex-col justify-between border-r p-10 lg:flex">
        <div className="flex items-center gap-3">
          <Marque taille="lg" />
          <div>
            <p className="text-ink text-2xl leading-tight font-bold tracking-tight">Flow&amp;</p>
            <p className="text-muted text-sm">{t('connexion.sousTitre')}</p>
          </div>
        </div>

        <div className="max-w-md space-y-3">
          <p className="text-ink text-xl font-semibold tracking-tight">{t('connexion.accroche')}</p>
          <p className="text-muted text-sm leading-relaxed">{t('connexion.accrocheDetail')}</p>
        </div>

        <p className="text-faint text-xs">AGPL-3.0-or-later · tick&amp;</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <form
          onSubmit={(evenement) => {
            void soumettre(evenement);
          }}
          className="w-full max-w-sm space-y-5"
        >
          <div className="flex items-center gap-3 lg:hidden">
            <Marque />
            <p className="text-ink text-lg font-bold">Flow&amp;</p>
          </div>

          <h1 className="text-ink border-ink border-b-2 pb-3 text-xl font-bold tracking-tight">
            {t('connexion.valider')}
          </h1>

          {erreur && <Notice ton="critique">{erreur}</Notice>}

          <Field label={t('connexion.identifiant')}>
            <Input
              value={identifiant}
              onChange={(evenement) => {
                setIdentifiant(evenement.target.value);
              }}
              autoComplete="username"
              autoFocus
              required
            />
          </Field>

          <Field label={t('connexion.motDePasse')}>
            <Input
              type="password"
              value={motDePasse}
              onChange={(evenement) => {
                setMotDePasse(evenement.target.value);
              }}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" variante="primaire" className="w-full" disabled={enCours}>
            {enCours ? t('connexion.enCours') : t('connexion.valider')}
          </Button>
        </form>
      </section>
    </div>
  );
}
