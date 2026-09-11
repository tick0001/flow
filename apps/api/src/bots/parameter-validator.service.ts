import { BadRequestException, Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { BotManifest } from '@flow/contracts';

/**
 * Validation des parametres d'un lancement, contre le JSON Schema du manifeste.
 *
 * **C'est deliberement la moins forte des deux validations.** L'auteur du bot
 * ecrit un schema Zod ; le SDK en derive un JSON Schema a la construction, et
 * tout ce que Zod exprime ne s'y traduit pas -- un `refine`, une dependance
 * entre deux champs, un format maison disparaissent en route. Le worker revalide
 * donc avec le schema Zod, qui reste la verite.
 *
 * Pourquoi valider deux fois, alors : pour que la reponse arrive **tout de
 * suite**, sur le champ fautif, dans le formulaire. Sans elle, une adresse mal
 * tapee produirait une trace d'execution en echec -- du bruit dans un historique
 * qui sert a comprendre les pannes reelles -- et un message sans rapport avec le
 * champ qui l'a causee.
 *
 * L'inverse ne se produit pas : un parametre que le JSON Schema accepte et que
 * Zod refuse echoue dans le worker, avec le motif de Zod. C'est le bon sens de
 * l'asymetrie -- la validation faible ne laisse jamais passer moins que la forte.
 */
@Injectable()
export class ParameterValidatorService {
  private readonly ajv: Ajv2020;

  /**
   * Les fonctions compilees, par bot et par version.
   *
   * La compilation d'un schema n'est pas gratuite, et un bot est lance en rafale.
   * La version fait partie de la clef : un bot redepose en `1.0.1` avec un
   * parametre de plus servirait autrement l'ancienne fonction, qui refuserait le
   * nouveau champ sans que rien n'explique pourquoi.
   */
  private readonly compilees = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({
      // `strict: false` : les schemas viennent de Zod, qui emet des mots-clefs
      // parfaitement valides mais qu'Ajv juge suspects en mode strict -- il
      // leverait alors a la compilation, sur un schema correct.
      strict: false,
      // Les defauts du schema sont **appliques** : la trace d'execution porte
      // ainsi ce qui a reellement ete passe au bot, et non ce que le formulaire
      // avait laisse vide. Sans cela, relire une execution d'il y a six mois ne
      // dirait pas avec quel selecteur elle a tourne.
      useDefaults: true,
      // Tous les champs fautifs d'un coup : corriger un formulaire erreur par
      // erreur, une requete a la fois, est exactement ce qu'on ne veut pas faire
      // subir a quelqu'un qui remplit huit parametres.
      allErrors: true,
    });

    // Sans ceci, `format: "uri"` est ignore en silence -- et c'est le format le
    // plus courant dans un bot de navigateur. Une adresse invalide traverserait
    // la validation pour echouer dans le worker, ce qui est precisement ce que ce
    // service existe pour eviter.
    addFormats(this.ajv);
  }

  /**
   * Valide et complete les parametres, ou refuse.
   *
   * Renvoie un **nouvel** objet : Ajv ecrit les valeurs par defaut dans la donnee
   * qu'on lui passe, et muter le corps de la requete ferait dependre la suite du
   * traitement de l'ordre dans lequel on l'a lu.
   */
  valider(manifest: BotManifest, parametres: Record<string, unknown>): Record<string, unknown> {
    const valider = this.compiler(manifest);
    const donnees: Record<string, unknown> = { ...parametres };

    if (valider(donnees)) return donnees;

    throw new BadRequestException({
      message: 'Parametres invalides.',
      issues: (valider.errors ?? []).map((erreur) => ({
        // `instancePath` vaut « /url » : le decoupage rend le nom du champ tel
        // que le formulaire le connait, pour qu'il sache sous quel controle
        // afficher le message.
        chemin: erreur.instancePath.replace(/^\//, '').replace(/\//g, '.'),
        message: erreur.message ?? 'valeur refusee',
      })),
    });
  }

  private compiler(manifest: BotManifest): ValidateFunction {
    const clef = `${manifest.id}@${manifest.version}`;
    const enCache = this.compilees.get(clef);

    if (enCache) return enCache;

    let valider: ValidateFunction;

    try {
      valider = this.ajv.compile(manifest.parameters);
    } catch (erreur: unknown) {
      // Un schema que le manifeste porte mais qu'Ajv refuse de compiler : le bot
      // est inutilisable, et le dire ici vaut mieux que de laisser chaque
      // lancement echouer sur une erreur interne.
      throw new BadRequestException(
        `Le schema de parametres de ${manifest.id} est illisible : ${String(erreur)}`,
      );
    }

    this.compilees.set(clef, valider);

    return valider;
  }
}
