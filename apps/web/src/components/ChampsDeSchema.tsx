import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/primitives';

/**
 * Forme minimale d'un JSON Schema d'objet, telle que le SDK la produit.
 *
 * Volontairement partielle : on ne lit que ce qu'on affiche. Traiter le JSON
 * Schema dans sa generalite -- `allOf`, `$ref`, unions, objets imbriques --
 * demanderait une bibliotheque entiere pour un gain nul tant que les schemas
 * viennent tous de Zod par le meme chemin. Le jour ou un bot aura besoin d'un
 * parametre en forme d'objet, c'est ici que cela se saura, et pas avant.
 */
export interface DefinitionChamp {
  type?: string | undefined;
  description?: string | undefined;
  default?: unknown;
  format?: string | undefined;
  enum?: unknown[] | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
}

export interface SchemaObjet {
  properties?: Record<string, DefinitionChamp> | undefined;
  required?: string[] | undefined;
}

/** Les valeurs par defaut du schema, pour prégarnir le formulaire. */
export function valeursInitiales(schema: SchemaObjet): Record<string, unknown> {
  const valeurs: Record<string, unknown> = {};

  for (const [nom, definition] of Object.entries(schema.properties ?? {})) {
    if (definition.default !== undefined) valeurs[nom] = definition.default;
    // Une case a cocher sans defaut part decochee : `undefined` la rendrait
    // indeterminee, etat que React signale et dont personne ne veut ici.
    else if (definition.type === 'boolean') valeurs[nom] = false;
  }

  return valeurs;
}

/**
 * Les champs d'un formulaire, rendus depuis le JSON Schema d'un bot.
 *
 * C'est le meme schema que le serveur valide, et c'est tout l'interet : ce que
 * l'ecran demande et ce que le serveur accepte ne peuvent pas diverger, puisque
 * les deux viennent du schema Zod de l'auteur. L'outil remplace avait un type
 * `BotParameter` avec un enumere de controles et une expression reguliere de
 * validation -- un langage de description de formulaire reinvente a cote du
 * systeme de types, et les deux pouvaient se contredire.
 *
 * La validation fine reste au serveur. Les contraintes du schema sont posees sur
 * les controles -- `required`, `min`, `max`, `type="url"` -- parce qu'elles
 * evitent un aller-retour evident, mais le message qui compte est celui que le
 * serveur rend, champ par champ.
 */
export function ChampsDeSchema({
  schema,
  valeurs,
  onChange,
  erreurs,
  desactive = false,
}: {
  schema: SchemaObjet;
  valeurs: Record<string, unknown>;
  onChange: (nom: string, valeur: unknown) => void;
  /** Messages du serveur, par nom de champ. */
  erreurs?: Record<string, string> | undefined;
  desactive?: boolean;
}) {
  const proprietes = Object.entries(schema.properties ?? {});
  const obligatoires = new Set(schema.required ?? []);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {proprietes.map(([nom, definition]) => {
        const erreur = erreurs?.[nom];
        const aide = definition.description;

        return (
          <div key={nom} className={definition.type === 'boolean' ? 'sm:col-span-2' : undefined}>
            <Champ
              nom={nom}
              definition={definition}
              obligatoire={obligatoires.has(nom)}
              valeur={valeurs[nom]}
              onChange={onChange}
              aide={aide}
              desactive={desactive}
            />
            {/* Le message du serveur sous le champ qu'il concerne : un bandeau
                general obligerait a deviner lequel des huit parametres est en
                cause. */}
            {erreur && <p className="text-critical-ink mt-1 text-xs">{erreur}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Champ({
  nom,
  definition,
  obligatoire,
  valeur,
  onChange,
  aide,
  desactive,
}: {
  nom: string;
  definition: DefinitionChamp;
  obligatoire: boolean;
  valeur: unknown;
  onChange: (nom: string, valeur: unknown) => void;
  aide: string | undefined;
  desactive: boolean;
}) {
  // Le nom technique fait l'etiquette. Il vient de l'auteur du bot, qui l'a
  // choisi lisible (`attendreReseau`) : le deguiser en « Attendre reseau »
  // couperait le lien avec ce qu'il ecrit dans sa documentation et dans ses
  // messages d'erreur.
  const etiquette = obligatoire ? `${nom} *` : nom;

  if (definition.type === 'boolean') {
    // Pas de `Field` ici : la case porte deja son intitule, et l'envelopper d'une
    // etiquette en donnerait deux pour un controle -- ce que la norme interdit, et
    // ce qui produit a l'usage un clic qui bascule la mauvaise case.
    return (
      <div className="space-y-1">
        <Checkbox
          label={etiquette}
          checked={valeur === true}
          disabled={desactive}
          onChange={(evenement) => {
            onChange(nom, evenement.target.checked);
          }}
        />
        {aide && <span className="text-faint block text-xs">{aide}</span>}
      </div>
    );
  }

  if (definition.enum && definition.enum.length > 0) {
    return (
      <Field label={etiquette} hint={aide}>
        <Select
          value={typeof valeur === 'string' ? valeur : ''}
          required={obligatoire}
          disabled={desactive}
          onChange={(evenement) => {
            onChange(nom, evenement.target.value);
          }}
        >
          {/* Une option vide en tete quand le champ est facultatif : sans elle,
              un choix serait impose des l'affichage, et le defaut du schema
              cesserait de s'appliquer. */}
          {!obligatoire && <option value="" />}
          {definition.enum.map((choix) => (
            <option key={String(choix)} value={String(choix)}>
              {String(choix)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (definition.type === 'number' || definition.type === 'integer') {
    return (
      <Field label={etiquette} hint={aide}>
        <Input
          type="number"
          inputMode={definition.type === 'integer' ? 'numeric' : 'decimal'}
          step={definition.type === 'integer' ? 1 : 'any'}
          {...(definition.minimum === undefined ? {} : { min: definition.minimum })}
          {...(definition.maximum === undefined ? {} : { max: definition.maximum })}
          value={typeof valeur === 'number' || typeof valeur === 'string' ? String(valeur) : ''}
          required={obligatoire}
          disabled={desactive}
          onChange={(evenement) => {
            const brut = evenement.target.value;

            // Une chaine vide est rendue telle quelle et non convertie en zero :
            // « vide » et « zero » sont deux intentions differentes, et un champ
            // facultatif vide doit laisser le defaut du schema s'appliquer.
            onChange(nom, brut === '' ? '' : Number(brut));
          }}
        />
      </Field>
    );
  }

  const texte = typeof valeur === 'string' ? valeur : '';
  // Un champ long se saisit dans une zone de texte : un selecteur CSS ou un
  // fragment de script ne tient pas dans une ligne, et on le relit mal.
  const long = (definition.maxLength ?? 0) > 300;

  return (
    <Field label={etiquette} hint={aide} className={long ? 'sm:col-span-2' : undefined}>
      {long ? (
        <Textarea
          rows={3}
          value={texte}
          required={obligatoire}
          disabled={desactive}
          onChange={(evenement) => {
            onChange(nom, evenement.target.value);
          }}
        />
      ) : (
        <Input
          type={typeDeControle(definition.format)}
          value={texte}
          required={obligatoire}
          disabled={desactive}
          {...(definition.minLength === undefined ? {} : { minLength: definition.minLength })}
          {...(definition.maxLength === undefined ? {} : { maxLength: definition.maxLength })}
          onChange={(evenement) => {
            onChange(nom, evenement.target.value);
          }}
        />
      )}
    </Field>
  );
}

/**
 * Le type de controle HTML tire du format du schema.
 *
 * Utile pour le clavier d'un telephone -- `url` et `email` en changent la
 * disposition -- et pour la validation du navigateur avant l'envoi. Les autres
 * formats restent en texte : `date-time` en `datetime-local` perdrait le fuseau,
 * ce qui est exactement ce qu'un horodatage ne pardonne pas.
 */
function typeDeControle(format: string | undefined): string {
  if (format === 'uri' || format === 'url') return 'url';
  if (format === 'email') return 'email';

  return 'text';
}

/**
 * Nettoie les valeurs avant l'envoi.
 *
 * Les chaines vides des champs facultatifs sont **retirees** et non envoyees
 * vides : une chaine vide est une valeur, que le schema refuserait sur un champ
 * qui exige une adresse -- alors que l'absence laisse le defaut s'appliquer.
 */
export function nettoyerValeurs(
  schema: SchemaObjet,
  valeurs: Record<string, unknown>,
): Record<string, unknown> {
  const obligatoires = new Set(schema.required ?? []);
  const propres: Record<string, unknown> = {};

  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (valeur === '' && !obligatoires.has(nom)) continue;

    propres[nom] = valeur;
  }

  return propres;
}
