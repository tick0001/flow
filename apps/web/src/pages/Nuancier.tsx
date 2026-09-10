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
  Pastille,
  SectionTitle,
  type Ton,
} from '@/components/ui/primitives';

/**
 * Le nuancier : les jetons et les briques, à l'écran.
 *
 * Une palette décrite dans un fichier CSS ne se juge pas. Cette page la montre,
 * dans les deux thèmes, avec les briques qui s'en servent — c'est ce qui permet de
 * voir qu'un jeton de sens tient sur le fond sombre, ou qu'un badge violet ne se
 * confond pas avec un badge d'information.
 *
 * Elle reste dans le dépôt après le jalon J0 : elle deviendra un écran de
 * réglages, et elle sert entre-temps de contrôle visuel à chaque retouche de la
 * direction artistique.
 */

const FONDS = ['canvas', 'surface', 'sunken', 'raised'] as const;
const TEXTES = ['ink', 'muted', 'faint'] as const;
const MARQUE = ['brand', 'brand-hover', 'brand-soft', 'brand-ink'] as const;
const SENS = ['positive', 'caution', 'critical', 'info'] as const;

const CLASSES_FOND: Record<string, string> = {
  canvas: 'bg-canvas',
  surface: 'bg-surface',
  sunken: 'bg-sunken',
  raised: 'bg-raised',
  brand: 'bg-brand',
  'brand-hover': 'bg-brand-hover',
  'brand-soft': 'bg-brand-soft',
  'brand-ink': 'bg-brand-ink',
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
  info: 'bg-info',
};

const CLASSES_TEXTE: Record<string, string> = {
  ink: 'text-ink',
  muted: 'text-muted',
  faint: 'text-faint',
};

function Echantillon({ jeton }: { jeton: string }) {
  return (
    <div className="space-y-1">
      <div className={`border-line h-12 border ${CLASSES_FOND[jeton] ?? ''}`} />
      <p className="text-faint font-mono text-[11px]">{jeton}</p>
    </div>
  );
}

/**
 * Les six statuts et leur ton.
 *
 * Cinq tons pour six statuts, et c'est voulu : le violet de marque n'en est pas.
 * Il ne sert qu'à ce sur quoi on agit, et un état n'est pas une action — l'y
 * dépenser affaiblirait le seul signal de l'interface.
 *
 * `queued` et `cancelled` partagent donc le ton neutre. Ni l'un ni l'autre n'est
 * une alerte : on attend dans le premier cas, quelqu'un a décidé dans le second.
 * Le mot suffit à les distinguer.
 *
 * `abandoned` porte l'attention alors que `failed` porte le critique : le bot a
 * échoué dans un cas, l'infrastructure a lâché dans l'autre. Ce ne sont pas les
 * mêmes journaux qu'on va lire.
 */
const ETATS: { ton: Ton; libelle: string }[] = [
  { ton: 'neutre', libelle: 'En attente' },
  { ton: 'info', libelle: 'En cours' },
  { ton: 'positif', libelle: 'Réussie' },
  { ton: 'critique', libelle: 'En échec' },
  { ton: 'neutre', libelle: 'Interrompue' },
  { ton: 'attention', libelle: 'Abandonnée' },
];

export function Nuancier() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Nuancier"
        description="Les jetons de la direction artistique et les briques qui s'en servent. Bascule le thème en haut à droite : aucune couleur n'est écrite en dur, tout suit les propriétés personnalisées."
        action={<Button variante="primaire">Action principale</Button>}
      />

      <section className="space-y-3">
        <SectionTitle>Fonds</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FONDS.map((jeton) => (
            <Echantillon key={jeton} jeton={jeton} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Marque</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MARQUE.map((jeton) => (
            <Echantillon key={jeton} jeton={jeton} />
          ))}
        </div>
        <p className="text-muted text-sm">
          Le violet encre est la seule couleur de signal, et elle est rare : elle ne sert qu'à ce
          sur quoi on agit. Elle ne croise aucun jeton de sens — c'est ce qui a décidé de la teinte.
        </p>
      </section>

      <section className="space-y-3">
        <SectionTitle>Sens</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SENS.map((jeton) => (
            <Echantillon key={jeton} jeton={jeton} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Textes</SectionTitle>
        <div className="space-y-1">
          {TEXTES.map((jeton) => (
            <p key={jeton} className={`text-sm ${CLASSES_TEXTE[jeton] ?? ''}`}>
              <span className="font-mono text-[11px]">{jeton}</span> — du plus lisible au plus
              discret, jamais l'inverse.
            </p>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>États d'exécution</SectionTitle>
        <Card>
          <CardHeader title="Pastilles" action={<Badge>6 statuts</Badge>} />
          <CardBody className="flex flex-wrap gap-x-6 gap-y-3">
            {ETATS.map(({ ton, libelle }) => (
              <Pastille key={libelle} ton={ton}>
                {libelle}
              </Pastille>
            ))}
          </CardBody>
        </Card>
        <p className="text-muted text-sm">
          Un point coloré et un mot, jamais un aplat plein : sur une liste de quarante exécutions,
          quarante aplats se neutraliseraient.
        </p>
      </section>

      <section className="space-y-3">
        <SectionTitle>Briques</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Saisie" />
            <CardBody className="space-y-3">
              <Field label="Adresse à visiter" hint="Le champ ne colore pas sa bordure au focus.">
                <Input placeholder="https://exemple.invalid" />
              </Field>
              <div className="flex gap-2">
                <Button variante="primaire" taille="sm">
                  Lancer
                </Button>
                <Button taille="sm">Annuler</Button>
                <Button variante="danger" taille="sm">
                  Supprimer
                </Button>
              </div>
            </CardBody>
          </Card>

          <div className="space-y-3">
            <Notice ton="info">Un encadré de document, cerné d'un filet et non d'une ombre.</Notice>
            <Notice ton="critique">
              Le rouge critique est plus sombre et plus bleu que la marque : ils ne se confondent
              pas.
            </Notice>
            <EmptyState
              title="Aucune exécution"
              description="Dit pourquoi c'est vide, et non seulement que ça l'est."
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Journal</SectionTitle>
        <div className="journal max-h-40 p-3">
          <div>
            <span className="journal-heure">14:02:11</span>ouverture du contexte navigateur
          </div>
          <div>
            <span className="journal-heure">14:02:12</span>navigation vers https://exemple.invalid
          </div>
          <div className="text-caution-ink">
            <span className="journal-heure">14:02:14</span>sélecteur introuvable, nouvelle tentative
          </div>
          <div className="text-critical-ink">
            <span className="journal-heure">14:02:44</span>délai dépassé après 30 s
          </div>
        </div>
        <p className="text-muted text-sm">
          Le seul endroit qui appelle une écriture de terminal, et il la mérite : du texte machine,
          horodaté, dense, que l'on parcourt en cherchant une ligne.
        </p>
      </section>
    </div>
  );
}
