<#
.SYNOPSIS
  Declare l'API et le worker de Flow& en services Windows.

.DESCRIPTION
  Windows n'a pas d'equivalent direct de systemd pour un processus ordinaire :
  un service doit dialoguer avec le gestionnaire de controle, ce que Node ne
  fait pas. Deux voies existent, et ce script prend la seconde :

    - un enveloppeur comme NSSM, qu'il faut telecharger et faire confiance ;
    - `sc.exe` avec la commande complete, ce que Windows accepte depuis
      longtemps pour un processus console, et qui n'ajoute aucune dependance.

  Le prix de la seconde : Windows redemarre le processus s'il meurt, mais ne
  sait pas l'arreter en douceur -- il le tue. Le worker perd alors ses
  executions en cours, que le balayage declarera abandonnees en une minute.
  L'installation en conteneurs n'a pas ce defaut, et le guide le dit.

.EXAMPLE
  .\installer-services.ps1 -Racine C:\flow -Compte 'NT AUTHORITY\NetworkService'

.NOTES
  A lancer dans une console PowerShell **en administrateur**.
#>

[CmdletBinding()]
param(
  # Racine de l'installation : le dossier qui contient apps\, packages\, .env.
  [Parameter(Mandatory = $true)]
  [string]$Racine,

  # Compte qui fera tourner les services. Un compte dedie vaut mieux ; celui-ci
  # est un defaut raisonnable pour une installation d'essai.
  [string]$Compte = 'NT AUTHORITY\NetworkService',

  # Chemin de Node. Par defaut celui du PATH de l'administrateur qui lance.
  [string]$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
)

$ErrorActionPreference = 'Stop'

if (-not $Node) {
  throw "Node introuvable. Installez-le, ou passez -Node C:\Program Files\nodejs\node.exe"
}

if (-not (Test-Path (Join-Path $Racine 'apps\api\dist\main.js'))) {
  throw "L'API n'est pas construite dans $Racine. Lancez `pnpm build` avant."
}

if (-not (Test-Path (Join-Path $Racine '.env'))) {
  throw "$Racine\.env est absent. Copiez .env.example et remplissez-le."
}

# Les services Windows n'ont pas d'EnvironmentFile : la configuration se lit
# donc a l'interieur du processus. L'API et le worker cherchent un `.env` en
# remontant depuis l'emplacement de leur propre module, et non depuis le
# repertoire de travail -- lequel n'est pas garanti pour un service. Le fichier
# pose a la racine de l'installation est donc trouve dans tous les cas.
$services = @(
  @{ Nom = 'FlowApi'; Titre = 'Flow& - API'; Script = 'apps\api\dist\main.js' },
  @{ Nom = 'FlowWorker'; Titre = 'Flow& - Worker'; Script = 'apps\worker\dist\main.js' }
)

foreach ($service in $services) {
  $existant = Get-Service -Name $service.Nom -ErrorAction SilentlyContinue

  if ($existant) {
    Write-Host "$($service.Nom) existe deja : arret et suppression."
    if ($existant.Status -ne 'Stopped') { Stop-Service -Name $service.Nom -Force }
    sc.exe delete $service.Nom | Out-Null
    # `sc.exe delete` rend la main avant que le gestionnaire n'ait fini.
    Start-Sleep -Seconds 2
  }

  $chemin = Join-Path $Racine $service.Script
  # Les guillemets doubles sont doubles a dessein : `sc.exe` recoit la commande
  # comme une seule chaine, et un chemin contenant un espace la couperait.
  $commande = "`"$Node`" --enable-source-maps `"$chemin`""

  Write-Host "Creation de $($service.Nom)."
  sc.exe create $service.Nom binPath= $commande start= auto obj= $Compte DisplayName= $service.Titre | Out-Null
  sc.exe description $service.Nom "$($service.Titre) - automatisation navigateur" | Out-Null

  # Redemarrage automatique : trois tentatives, puis toutes les minutes. Sans
  # cela, un service tombe reste tombe jusqu'a ce que quelqu'un le remarque.
  sc.exe failure $service.Nom reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
}

# Le compte de service doit pouvoir lire l'installation et ecrire le stockage.
$stockage = Join-Path $Racine 'donnees'

New-Item -ItemType Directory -Force -Path $stockage | Out-Null
icacls $stockage /grant "${Compte}:(OI)(CI)M" /T | Out-Null
icacls (Join-Path $Racine '.env') /grant "${Compte}:R" | Out-Null

Write-Host ''
Write-Host 'Services declares. Pour demarrer :'
Write-Host '  Start-Service FlowApi, FlowWorker'
Write-Host ''
Write-Host 'Les journaux partent sur la sortie standard, que Windows ne conserve pas'
Write-Host 'pour un service declare ainsi. Pour les garder, rediriger la commande'
Write-Host 'vers un fichier, ou preferer l installation en conteneurs -- ou Docker'
Write-Host 'les collecte de lui-meme.'
