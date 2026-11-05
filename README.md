# Undercover en ligne 🕵️

Le jeu Undercover à jouer entre potes, chacun sur son téléphone ou son ordi.
1 216 paires de mots incluses (756 en Normal, 460 en Hard).

## Contenu

```
undercover/
├── package.json     ← la liste des dépendances
├── server.js        ← le serveur (toute la logique du jeu)
├── words.js         ← les paires de mots (ajoute les tiennes ici)
└── public/
    ├── index.html   ← la page
    ├── style.css    ← le design
    └── client.js    ← ce qui tourne dans le navigateur
```

---

## 1. Lancer le jeu sur ton ordi

1. Installe **Node.js** (version LTS) depuis https://nodejs.org puis redémarre ton ordi.
2. Dézippe le dossier `undercover`.
3. Ouvre un terminal dans ce dossier :
   - **Windows** : ouvre le dossier dans l'Explorateur, clique dans la barre d'adresse, tape `cmd` et Entrée.
   - **Mac** : clic droit sur le dossier → *Services* → *Nouveau terminal au dossier*.
4. Tape ces deux commandes :
   ```
   npm install
   npm start
   ```
5. Ouvre **http://localhost:3000** dans ton navigateur.

### Tester à plusieurs tout seul
Ouvre plusieurs onglets sur http://localhost:3000 (avec **Ctrl+T**, pas « Dupliquer l'onglet »),
ou une fenêtre normale + une fenêtre de navigation privée. Chaque onglet est un joueur différent.
Crée une partie dans le premier, puis rejoins-la avec le code dans les autres.

Pour arrêter le serveur : **Ctrl+C** dans le terminal.

---

## 2. Mettre le jeu en ligne gratuitement (Render)

### Étape A : mettre le code sur GitHub
1. Crée un compte sur https://github.com.
2. Clique sur **+** en haut à droite → **New repository**. Nom : `undercover`. Laisse en *Public*, clique **Create repository**.
3. Sur la page qui s'affiche, clique sur le lien **uploading an existing file**.
4. Glisse-dépose **le contenu** du dossier `undercover` : `package.json`, `server.js`, `words.js`, `README.md` et le dossier `public`.
   ⚠️ N'envoie pas le dossier `node_modules` s'il existe.
5. Clique **Commit changes**.

### Étape B : héberger sur Render
1. Crée un compte sur https://render.com (le plus simple : *Sign up with GitHub*).
2. Clique **New +** → **Web Service**.
3. Autorise Render à accéder à GitHub et choisis ton dépôt `undercover`.
4. Remplis :
   - **Language / Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : `Free`
5. Clique **Deploy Web Service**. Attends 2-3 minutes que ça affiche *Live*.
6. Ton jeu est en ligne à l'adresse affichée en haut, du genre `https://undercover-xxxx.onrender.com`. Envoie-la à tes potes !

### À savoir sur l'offre gratuite
- Le serveur **s'endort après 15 minutes sans joueur**. La première personne qui ouvre le lien attend environ 1 minute, ensuite c'est instantané. Ouvre le lien un peu avant de jouer.
- Quand le serveur s'endort ou redémarre, les salons en cours sont effacés (normal : pas de base de données).

### Modifier le jeu plus tard
Modifie le fichier sur GitHub (icône crayon ✏️ → *Commit changes*). Render remet le site à jour tout seul en 2-3 minutes.

---

## Règles implémentées

- Civils : même mot. Undercover : mot différent, il ne sait pas qu'il est l'Undercover. Mr. White (optionnel) : aucun mot.
- Indices d'un seul mot, chacun son tour. Mr. White ne commence jamais le premier tour. Le premier joueur change à chaque tour.
- Vote : en cas d'égalité, nouveau vote entre les ex aequo. Si encore égalité, tirage au sort.
- Rôle de l'éliminé révélé (pas son mot).
- Mr. White éliminé a 60 secondes pour deviner le mot des Civils (majuscules, accents, articles et petites fautes tolérés).
- Civils gagnent quand tous les infiltrés sont éliminés. Infiltrés gagnent quand il ne reste qu'un Civil.
- Il faut toujours plus de Civils que d'infiltrés (ex : 4 joueurs = 1 Undercover max sans Mr. White).

## Cas particuliers gérés

- **Rechargement de la page** : on retrouve sa place, son mot et son vote.
- **Onglet fermé sur mobile** : rejoindre avec le même code et le même pseudo reprend la place.
- **Déconnexion pendant son tour** : l'hôte peut passer le tour, sinon il est passé automatiquement après 45 s.
- **Déconnexion pendant le vote** : le vote se termine quand tous les joueurs *connectés* ont voté.
- **L'hôte quitte** : un autre joueur devient hôte (après 15 s s'il est juste déconnecté).
- **Un joueur quitte en pleine partie** : il est éliminé, son rôle est révélé, la victoire est recalculée.
- **Arrivée en cours de partie** : le joueur regarde et participe à la partie suivante.
- **Paires** : jamais deux fois la même dans un salon tant que la liste n'est pas épuisée.

## Ajouter tes propres mots

Ouvre `words.js` et ajoute une ligne dans le bon tableau, par exemple :

```js
["Fortnite", "Minecraft"],
```

Attention aux guillemets et à la virgule à la fin.
