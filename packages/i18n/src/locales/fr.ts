/**
 * Langue source du projet.
 *
 * Le français fait référence : les autres langues en dérivent, et le type des
 * clés est déduit de ce fichier. Une clé ajoutée ici sans traduction ailleurs
 * devient une erreur de compilation, jamais une chaîne manquante à l'écran.
 */
export const fr = {
  commun: {
    annuler: 'Annuler',
    chargement: 'Chargement…',
    enregistrer: 'Enregistrer',
    fermer: 'Fermer',
    modifier: 'Modifier',
    supprimer: 'Supprimer',
    rechercher: 'Rechercher',
    reessayer: 'Réessayer',
    erreurInattendue: 'Une erreur inattendue est survenue.',
  },
  theme: {
    intitule: 'Thème',
    systeme: 'Système',
    clair: 'Clair',
    sombre: 'Sombre',
  },
  connexion: {
    accroche: 'Les bots travaillent, vous regardez.',
    accrocheDetail:
      'Des bots d’automatisation navigateur écrits en TypeScript, exécutés pour toute une organisation, avec le journal et la vue en direct de ce qu’ils font.',
    sousTitre: 'Automatisation navigateur',
    identifiant: 'Identifiant',
    motDePasse: 'Mot de passe',
    valider: 'Se connecter',
    enCours: 'Connexion…',
    echec: 'Identifiant ou mot de passe incorrect.',
    compteDesactive: 'Ce compte est désactivé.',
    tropDeTentatives: 'Trop de tentatives. Réessayez dans quelques minutes.',
    indisponible: 'Le service est momentanément indisponible.',
    aucuneHabilitation:
      'Ce compte n’est habilité sur aucune entité. Demandez à un administrateur de lui en attribuer une.',
  },
  motDePasse: {
    titre: 'Changer le mot de passe',
    impose:
      'Le mot de passe de ce compte doit être changé avant d’aller plus loin. Une installation dont l’administrateur garde le mot de passe initial est ouverte à qui a lu la documentation.',
    actuel: 'Mot de passe actuel',
    nouveau: 'Nouveau mot de passe',
    confirmation: 'Confirmer le nouveau mot de passe',
    valider: 'Changer le mot de passe',
    discordance: 'Les deux saisies ne correspondent pas.',
    tropCourt: 'Douze caractères au minimum.',
    identiqueALAncien: 'Le nouveau mot de passe doit être différent de l’ancien.',
    actuelIncorrect: 'Le mot de passe actuel est incorrect.',
    succes: 'Mot de passe changé.',
  },
  session: {
    deconnexion: 'Se déconnecter',
    monCompte: 'Mon compte',
    entiteActive: 'Entité active',
    profilActif: 'Profil actif',
    sousEntites: 'Inclure les sous-entités',
    badgeSousEntites: '+ sous-entités',
    changerContexte: 'Changer d’entité ou de profil',
    contexteChange: 'Contexte changé.',
  },
  navigation: {
    travail: 'Travail',
    analyse: 'Analyse',
    bots: 'Bots',
    executions: 'Exécutions',
    planifications: 'Planifications',
    statistiques: 'Statistiques',
    reglages: 'Réglages',
    retour: 'Retour',
    ouvrirMenu: 'Ouvrir le menu',
  },
  entites: {
    titre: 'Entités',
    intro:
      'L’arbre des organisations. Le cloisonnement entre branches est appliqué par la base, pas par l’application.',
    nom: 'Nom',
    parent: 'Rattachée à',
    aucunParent: 'Aucune — entité racine',
    commentaire: 'Commentaire',
    nouvelle: 'Nouvelle entité',
    aucune: 'Aucune entité.',
    confirmerSuppression: 'Supprimer cette entité ?',
    suppressionImpossible: 'Cette entité porte des sous-entités : supprimez-les d’abord.',
  },
  executions: {
    statut: {
      queued: 'En attente',
      running: 'En cours',
      succeeded: 'Réussie',
      failed: 'En échec',
      cancelled: 'Interrompue',
      abandoned: 'Abandonnée',
    },
    statutAide: {
      queued: 'En file, en attente d’un créneau ou d’un worker.',
      running: 'Un worker l’exécute en ce moment.',
      succeeded: 'Terminée sans erreur.',
      failed: 'Le bot a échoué : son journal dit pourquoi.',
      cancelled: 'Quelqu’un l’a interrompue.',
      abandoned:
        'Aucun worker ne la détenait plus : machine redémarrée ou processus tué. Ce ne sont pas les journaux du bot qu’il faut lire.',
    },
  },
  erreurs: {
    nonAuthentifie: 'Votre session a expiré. Reconnectez-vous.',
    interdit: 'Vous n’avez pas le droit d’effectuer cette action.',
    introuvable: 'Cet élément n’existe pas, ou n’est pas visible depuis votre entité active.',
    conflit: 'Cet élément a changé entre-temps. Rechargez la page.',
    serveur: 'Le serveur a rencontré une erreur.',
    reseau: 'Le serveur est injoignable.',
  },
};

export type Traductions = typeof fr;
