# Zcord Update Manager

Gestionnaire de mises à jour en **C** (client) + **application bureau C# WPF** (admin).

## Architecture

```
App WPF C# (ZcordUpdateManager.exe)
        │
        ├── Interface native Windows (pas Electron)
        ├── API HTTP localhost:8743 → client C
        ├── JSON (releases, logs, historique)
        └── node scripts/publish-release.cjs → GitHub

Client C (zcord-updater.exe)
        └── GET /api/check?version=...
```

## Prérequis

**.NET 8 SDK** (une seule fois) :

```powershell
winget install Microsoft.DotNet.SDK.8
```

## Démarrage

```powershell
cd update-server\ZcordUpdateManager
.\build.bat
```

Ou depuis la racine Zcord :

```powershell
powershell -File update-server\ZcordUpdateManager\build.ps1
```

## API seule (sans interface)

```powershell
node update-server/server.js
```

## Client C

```powershell
cd update_manager\scripts
.\build.bat
```

## Publier une MAJ

1. **Créer une MAJ** → version ex. `1.27.0`
2. Optionnel : choisir un `Zcord-Setup.exe` uploadé
3. **Enregistrer + Publier GitHub**

L'API reste compatible avec `update_manager/config/update.json` (`serverUrl: http://127.0.0.1:8743`).
