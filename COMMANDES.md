# Zcord — Commandes

Depuis la racine du repo (`c:\Users\rosea\Desktop\zcord`), PowerShell.

Prérequis : Node, `pnpm`, `gh` connecté (`gh auth login`).

---

## 1. Build (dev / local)

```powershell
# Desktop (Electron host)
npx pnpm run buildDesktop

# Plugins / renderer (asar)
npx pnpm run buildStandalone

# Sync vers release/zcord-dist + install locale
npx pnpm run sync:dev
```

En une fois :

```powershell
npx pnpm run buildDesktop; npx pnpm run buildStandalone; npx pnpm run sync:dev
```

---

## 2. Client indépendant

```powershell
# Premier pack / rebuild runtime
npx pnpm run buildIndependent

# Lancer en mode indépendant (Electron du repo)
npx pnpm run start:independent

# Ou via le raccourci
# Desktop\Zcord.lnk
# release\zcord-dist\Zcord.lnk
```

arRPC (Rich Presence) :

```powershell
npx pnpm run fetchArrpc
```

---

## 3. Installer Setup.exe

```powershell
# Si le dist est déjà à jour
npx pnpm run buildInstaller

# Build complet + Setup
npx pnpm run buildInstaller:full
```

Sortie : `release\Zcord-Setup.exe`

---

## 4. Version

Édite `package.json` → `"version": "1.27.x"`  
Le tag GitHub sera `v1.27.x`.

---

## 5. Git (commit + push)

```powershell
git status
git add -A
git commit -m "Release v1.27.x — résumé court."
git push -u origin HEAD
```

---

## 6. Release GitHub

Préparer localement (sans upload) :

```powershell
npx pnpm run publishRelease
```

Préparer **et** publier sur GitHub :

```powershell
# Assure-toi que le build + sync sont faits avant
npx pnpm run buildDesktop
npx pnpm run buildStandalone
npx pnpm run sync:dev

npx pnpm run publishRelease:github
```

Ça crée / met à jour la release tag `vX.Y.Z` avec :
- `Zcord-Setup.exe`
- `update.json`
- `files-manifest.json`
- assets `f_*` pour la MAJ auto

Vérifier :

```powershell
gh release list --limit 5
gh release view v1.27.5
```

URL : https://github.com/devdee162-web/qsddddddddddddddddddddddddsq/releases

---

## 7. Pipeline complet (release)

```powershell
# 1) version dans package.json
# 2) build
npx pnpm run buildDesktop
npx pnpm run buildStandalone
npx pnpm run sync:dev

# 3) Setup si besoin
npx pnpm run buildInstaller

# 4) git
git add -A
git commit -m "Release v1.27.x — notes."
git push -u origin HEAD

# 5) GitHub Releases
npx pnpm run publishRelease:github
```

---

## 8. Divers utiles

```powershell
# Panel update server
npx pnpm run update-panel:install
npx pnpm run update-panel:api

# Client updater C
npx pnpm run update-client:build

# Relancer Zcord local (après sync)
# Ferme Zcord puis :
# Desktop\Zcord.lnk
```

### À ne pas faire

- **Repair Zcord** dans le tray ne doit plus télécharger un asar distant (ça écrasait le build local).
- Ne pas lancer Discord PTB à la place de **Zcord.lnk**.
- Plugins : bouton violet **Zcord** / `Ctrl+Shift+P` / `Ctrl+Shift+Z`.
