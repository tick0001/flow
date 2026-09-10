import type { Traductions } from './fr.js';

/**
 * Traduction anglaise.
 *
 * Le type vient du français : une clé ajoutée là-bas et oubliée ici est une
 * erreur de compilation, pas une chaîne manquante découverte par un utilisateur.
 */
export const en: Traductions = {
  commun: {
    annuler: 'Cancel',
    chargement: 'Loading…',
    enregistrer: 'Save',
    fermer: 'Close',
    modifier: 'Edit',
    supprimer: 'Delete',
    rechercher: 'Search',
    reessayer: 'Try again',
    erreurInattendue: 'Something went wrong.',
  },
  theme: {
    intitule: 'Theme',
    systeme: 'System',
    clair: 'Light',
    sombre: 'Dark',
  },
  connexion: {
    accroche: 'The bots do the work. You watch.',
    accrocheDetail:
      'Browser automation bots written in TypeScript, run on behalf of a whole organisation, with the log and a live view of what they are doing.',
    sousTitre: 'Browser automation',
    identifiant: 'Username',
    motDePasse: 'Password',
    valider: 'Sign in',
    enCours: 'Signing in…',
    echec: 'Incorrect username or password.',
    compteDesactive: 'This account is disabled.',
    tropDeTentatives: 'Too many attempts. Try again in a few minutes.',
    indisponible: 'The service is temporarily unavailable.',
    aucuneHabilitation:
      'This account is not authorised on any entity. Ask an administrator to grant it one.',
  },
  motDePasse: {
    titre: 'Change password',
    impose:
      'This account’s password must be changed before going any further. An installation whose administrator keeps the initial password is open to anyone who has read the documentation.',
    actuel: 'Current password',
    nouveau: 'New password',
    confirmation: 'Confirm new password',
    valider: 'Change password',
    discordance: 'The two entries do not match.',
    tropCourt: 'Twelve characters minimum.',
    identiqueALAncien: 'The new password must differ from the old one.',
    actuelIncorrect: 'The current password is incorrect.',
    succes: 'Password changed.',
  },
  session: {
    deconnexion: 'Sign out',
    monCompte: 'My account',
    entiteActive: 'Active entity',
    profilActif: 'Active profile',
    sousEntites: 'Include sub-entities',
    badgeSousEntites: '+ sub-entities',
    changerContexte: 'Change entity or profile',
    contexteChange: 'Context changed.',
  },
  navigation: {
    travail: 'Work',
    analyse: 'Analysis',
    bots: 'Bots',
    executions: 'Executions',
    planifications: 'Schedules',
    statistiques: 'Statistics',
    reglages: 'Settings',
    retour: 'Back',
    ouvrirMenu: 'Open menu',
  },
  entites: {
    titre: 'Entities',
    intro:
      'The tree of organisations. Isolation between branches is enforced by the database, not by the application.',
    nom: 'Name',
    parent: 'Parent',
    aucunParent: 'None — root entity',
    commentaire: 'Comment',
    nouvelle: 'New entity',
    aucune: 'No entities.',
    confirmerSuppression: 'Delete this entity?',
    suppressionImpossible: 'This entity has sub-entities: delete those first.',
  },
  executions: {
    statut: {
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Succeeded',
      failed: 'Failed',
      cancelled: 'Cancelled',
      abandoned: 'Abandoned',
    },
    statutAide: {
      queued: 'In the queue, waiting for a slot or a worker.',
      running: 'A worker is running it right now.',
      succeeded: 'Finished without error.',
      failed: 'The bot failed: its log says why.',
      cancelled: 'Somebody cancelled it.',
      abandoned:
        'No worker held it any more: machine restarted, or process killed. The bot’s log is not the one to read.',
    },
  },
  erreurs: {
    nonAuthentifie: 'Your session has expired. Sign in again.',
    interdit: 'You are not allowed to do that.',
    introuvable: 'This item does not exist, or is not visible from your active entity.',
    conflit: 'This item changed in the meantime. Reload the page.',
    serveur: 'The server hit an error.',
    reseau: 'The server is unreachable.',
  },
};
