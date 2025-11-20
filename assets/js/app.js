// --- Constantes et Variables Globales ---
const API_URL = "https://ticketapi.juhdd.me/api/tickets";
const WS_URL = "wss://ticketapi.juhdd.me";
const API_ANNONCE_URL = "https://ticketapi.juhdd.me/api/announcement";
const maxDuringTicket = 1;
let lastAddedTicketId = null;
let previousIds = new Set();
let filtresCache = [];
let ws = null;
let currentAnnonce = "";

// --- Gestion de l'ID utilisateur ---
// Crée un ID unique pour l'utilisateur et le stocke dans le localStorage
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// --- Connexion WebSocket ---
// Gère la connexion temps réel pour les mises à jour
function connectWebSocket() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => console.log('WebSocket connecté');

  ws.onmessage = (event) => {
    const data = event.data;
    // Répond au ping/pong pour maintenir la connexion
    if (data === 'ping') { ws.send('pong'); return; }
    try {
      const message = JSON.parse(data);

      // Met à jour les tickets si un 'update' est reçu
      if (message.type === 'update') afficherTickets(true);

      // Met à jour l'annonce si 'updateAnnonce' est reçu
      if (message.type === 'updateAnnonce') {
        currentAnnonce = message.message.texte || "";
        const couleur = message.message.couleur || "#cdcdcd";
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = currentAnnonce;
        messageDiv.style.display = currentAnnonce ? 'block' : 'none';
        messageDiv.style.color = couleur;
        // Met à jour le formulaire admin si l'admin est en train de modifier l'annonce
        const adminAnnonce = document.getElementById('adminAnnonce');
        const nom = document.getElementById('name');
        if (adminAnnonce?.checked) nom.value = currentAnnonce;
      }
    } catch { }
  };

  ws.onerror = (error) => console.error('Erreur WebSocket:', error);
  // Tente de se reconnecter après 3s en cas de fermeture
  ws.onclose = () => {
    console.log('WebSocket déconnecté, reconnexion dans 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

// --- Fonctions API (Tickets) ---

// Récupération de tous les tickets
async function getTickets() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Ajouter un ticket
async function ajouterTicket(ticket) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticket)
  });
  const data = await res.json();
  lastAddedTicketId = data.id; // Stocke l'ID pour l'animation
  return data;
}

// Supprimer un ticket
async function supprimerTicket(id) {
  const isAdmin = localStorage.getItem('admin') === 'true';
  await fetch(`${API_URL}/${id}?userId=${userId}&admin=${isAdmin}`, { method: "DELETE" });
}

// Modifier un ticket (ex: passer à "terminé")
async function modifierTicket(id, modifications) {
  await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modifications)
  });
}

// Mot de passe admin encodé
var jstextimport = "OHMwTTc4Y3Y=";

// --- Fonctions Utilitaires ---

// Formater le temps écoulé (ex: "(5mins)", "(2h)", "(1j)")
function formatTempsEcoule(dateCreation) {
  if (!dateCreation) return '';
  const now = new Date();
  const creation = new Date(dateCreation);
  const diffMs = now - creation;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHeures = Math.floor(diffMs / 3600000);
  const diffJours = Math.floor(diffMs / 86400000);
  if (diffJours > 0) return `(${diffJours}j)`;
  if (diffHeures > 0) return `(${diffHeures}h)`;
  return `(${diffMins}mins)`;
}

// Encode une chaîne en Base64
function toBase64(str) {
  try { return btoa(str); }
  catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

// --- Affichage des Tickets (DOM) ---

// Fonction principale pour rafraîchir la liste des tickets
async function afficherTickets(externe = false) {
  const tickets = await getTickets();
  let newTicketId = null;
  const currentIds = new Set(tickets.map(t => t.id));

  // Détecte un nouveau ticket ajouté par un autre utilisateur (via WebSocket)
  if (externe && previousIds.size > 0) {
    for (const id of currentIds) {
      if (!previousIds.has(id)) newTicketId = id;
    }
  }
  previousIds = currentIds;

  // Sépare les tickets "en cours" de "l'historique"
  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");

  // Affichage des tickets "en cours" (colonne de droite)
  const right = document.getElementById("right");
  right.querySelectorAll('.during').forEach(e => e.remove()); // Nettoie la liste
  enCours.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "during";
    div.id = ticket.id;

    // Ajoute une animation si c'est un nouveau ticket
    if (ticket.id === lastAddedTicketId || ticket.id === newTicketId) {
      div.classList.add('add');
      setTimeout(() => div.classList.remove('add'), 600);
    }

    // Applique la couleur (gradient ou uni)
    if (ticket.couleur?.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";

    let infoContent = `<p id="name">${ticket.nom}</p>`;
    if (ticket.description?.trim()) infoContent += `<p id="desc">${ticket.description}</p>`;

    // Construit l'HTML du ticket
    div.innerHTML = `
      <div class="checkbox" data-id="${ticket.id}"></div>
      <div class="info">${infoContent}</div>
      <div class="time">
        <p id="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
        <p id="remaining">${formatTempsEcoule(ticket.dateCreation)}</p>
      </div>
      ${(localStorage.getItem('admin') === 'true' || ticket.userId === userId) ? `<a class="delete" data-id="${ticket.id}">—</a>` : ""}
    `;
    right.appendChild(div);
  });

  // Affichage de l'historique (colonne de gauche)
  const subdiv = document.getElementById("subdiv");
  subdiv.querySelectorAll('.history').forEach(e => e.remove()); // Nettoie la liste
  historique.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "history";

    if (ticket.id === lastAddedTicketId || ticket.id === newTicketId) {
      div.classList.add('add');
      setTimeout(() => div.classList.remove('add'), 600);
    }

    if (ticket.couleur?.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";

    div.innerHTML = `
      <p class="name">${ticket.nom}</p>
      <div class="time">
        <p class="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
        <p class="etat">${ticket.etat}</p>
      </div>
      ${(localStorage.getItem('admin') === 'true') ? `<a class="delete" data-id="${ticket.id}">—</a>` : ""}
    `;
    subdiv.appendChild(div);
  });

  // Ajoute les écouteurs pour les boutons "supprimer"
  document.querySelectorAll('.delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const el = btn.closest('.during, .history');
      el.classList.add('bounce-reverse'); // Animation de suppression
      el.addEventListener('animationend', async () => {
        await supprimerTicket(id);
        el.remove(); // Supprime l'élément après l'animation
      }, { once: true });
    };
  });
}

// --- Gestionnaires d'Événements ---

// Gère le clic sur la checkbox pour terminer un ticket
document.getElementById("right").addEventListener("click", async (e) => {
  const checkbox = e.target.closest(".checkbox");
  if (!checkbox) return;

  const id = checkbox.dataset.id;
  const el = document.getElementById(id);
  if (!el) return;

  // Vérifie les permissions (admin ou créateur du ticket)
  const tickets = await getTickets();
  if (localStorage.getItem('admin') !== 'true' &&
    !tickets.find(t => t.id === id && t.userId === userId)) {
    alert("Vous n'avez pas la permission de modifier ce ticket.");
    return;
  }

  // Animation de transition vers l'historique
  el.classList.add("moving");
  el.addEventListener("animationend", async () => {
    await modifierTicket(id, { etat: "terminé" });
    afficherTickets(); // Rafraîchit les listes
  }, { once: true });
});


// --- Filtres et Mode Admin ---

// Charger le fichier JSON des mots interdits
async function chargerFiltres() {
  const res = await fetch("./assets/filter.json?cb=" + Date.now());
  const data = await res.json();
  filtresCache = data.banned_terms || [];
}

// Activer le mode admin
function activerModeAdmin() {
  localStorage.setItem('admin', 'true');
  const titre = document.getElementById('lefttitle');
  if (titre && !titre.textContent.includes('(admin mode)'))
    titre.textContent += ' (admin mode)';
  afficherTickets(); // Rafraîchit pour afficher les boutons de suppression
}

// Désactiver le mode admin
function desactiverModeAdmin() {
  localStorage.removeItem('admin');
  const titre = document.getElementById('lefttitle');
  if (titre)
    titre.textContent = titre.textContent.replace(' (admin mode)', '');
  afficherTickets(); // Rafraîchit pour cacher les boutons
}

// Vérifie si l'utilisateur tape "admin" dans le champ nom
function verifierAdminInput() {
  const nomInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const createBtn = document.getElementById('create');
  if (nomInput.value.trim().toLowerCase() === "admin") {
    infosInput.type = 'password'; // Passe le champ description en mot de passe
    createBtn.textContent = "Valider";
  } else {
    infosInput.type = 'text';
    createBtn.textContent = "+ Créer";
  }
}

// --- Fonctions API (Annonces) ---

// Récupérer l'annonce actuelle au chargement
async function fetchAnnonce() {
  try {
    const res = await fetch(API_ANNONCE_URL);
    const data = await res.json();
    currentAnnonce = data.texte || "";
    const couleur = data.couleur || "#cdcdcd";
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = currentAnnonce;
    messageDiv.style.display = currentAnnonce ? 'block' : 'none';
    messageDiv.style.color = couleur;
  } catch (e) {
    console.error("Erreur récupération annonce:", e);
  }
}

// Mettre à jour l'annonce (admin)
async function updateAnnonce(newMessage, couleur = "#cdcdcd") {
  try {
    await fetch(API_ANNONCE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texte: newMessage, couleur })
    });

    currentAnnonce = newMessage;

    // Envoie la mise à jour aux autres clients via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'updateAnnonce', message: { texte: newMessage, couleur } }));
    }
  } catch (e) {
    console.error("Erreur mise à jour annonce:", e);
  }
}

// --- Logique Admin (Annonces) ---

// Met en place la checkbox "Message d'annonce" pour l'admin
function setupAdminAnnonce() {
  const adminAnnonce = document.getElementById('adminAnnonce');
  const infosInput = document.getElementById('infos');
  const nom = document.getElementById('name');
  const messageDiv = document.getElementById('message');

  if (!adminAnnonce) return;

  // Pré-remplit si une annonce existe déjà
  adminAnnonce.checked = !!currentAnnonce;
  if (adminAnnonce.checked) {
    nom.value = currentAnnonce;
    infosInput.style.display = 'none';
    messageDiv.style.display = 'block';
  } else {
    nom.value = '';
    messageDiv.style.display = 'none';
    infosInput.style.display = 'block';
  }

  // Gère le basculement entre création de ticket et création d'annonce
  adminAnnonce.addEventListener('change', () => {
    if (adminAnnonce.checked) {
      nom.value = currentAnnonce; // Met le texte de l'annonce dans le champ "nom"
      infosInput.style.display = 'none'; // Cache la description
      messageDiv.style.display = 'block';
    } else {
      nom.value = '';
      infosInput.style.display = 'block'; // Affiche la description
      messageDiv.style.display = 'none';
    }
  });
}

// --- Création de Ticket (Logique Formulaire) ---

// Gère la soumission du formulaire de création
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  const infosInput = document.getElementById('infos');
  const description = infosInput.value.trim();
  const messageDiv = document.getElementById('message');
  const adminAnnonce = document.getElementById('adminAnnonce');

  if (!nom && !adminAnnonce.checked) return alert("Le nom est obligatoire");

  // Vérification des mots interdits
  const contenu = (nom + " " + description).toLowerCase();
  const interdit = filtresCache.find(t => contenu.includes(t.toLowerCase()));
  if (interdit) return alert(`"${interdit}" est interdit.`);

  // --- Logique Admin (Connexion / Déconnexion) ---
  if (nom.toLowerCase() === "admin") {
    const psw = description;
    if (toBase64(psw) === jstextimport) {
      activerModeAdmin();
      alert("Mode admin activé !");
    } else if (localStorage.getItem('admin') === 'true' && psw === "") {
      desactiverModeAdmin();
      alert("Mode admin désactivé !");
    } else {
      alert("Mot de passe incorrect");
    }
    return;
  }

  // --- Logique Admin (Mise à jour Annonce) ---
  if (adminAnnonce && adminAnnonce.checked) {
    const selectedColor = document.querySelector('.color.selected');
    let couleur = '#d40000'; // Couleur par défaut

    // Extrait la couleur sélectionnée
    if (selectedColor) {
      const bg = selectedColor.style.backgroundImage;
      const rgbMatch = bg.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
      if (rgbMatch) { // Conversion RGB en HEX
        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);
        couleur = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }
    }

    // Met à jour l'annonce localement et via l'API
    messageDiv.textContent = nom;
    messageDiv.style.display = 'block';
    messageDiv.style.color = couleur;
    updateAnnonce(nom, couleur);

    // Réinitialise et ferme le formulaire
    document.getElementById('name').value = "";
    infosInput.value = "";
    document.getElementById("formOverlay").style.display = "none";
    return;
  }

  // --- Logique Standard (Création Ticket) ---
  const tickets = await getTickets();
  const enCoursUtilisateur = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  
  // Limite le nombre de tickets par utilisateur (sauf admin)
  if (enCoursUtilisateur.length >= maxDuringTicket && localStorage.getItem('admin') !== 'true') {
    return alert(`Vous ne pouvez pas avoir plus de ${maxDuringTicket} tickets en cours.`);
  }

  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';

  await ajouterTicket({ nom, description, couleur, etat: "en cours", userId });

  // Réinitialise et ferme le formulaire
  document.getElementById('name').value = "";
  infosInput.value = "";
  document.getElementById("formOverlay").style.display = "none";
}

// --- Initialisation (DOM) ---

// Se déclenche quand la page est chargée
window.addEventListener('DOMContentLoaded', async () => {
  await chargerFiltres(); // Charge les mots interdits

  const form = document.querySelector(".ticket-form");
  const infosInput = document.getElementById('infos');

  await fetchAnnonce(); // Récupère l'annonce actuelle

  // Si l'utilisateur est admin, ajoute la checkbox "Message d'annonce"
  if (localStorage.getItem('admin') === 'true') {
    const titre = document.getElementById('lefttitle');
    if (titre && !titre.textContent.includes('(admin mode)'))
      titre.textContent += ' (admin mode)';

    let annonceWrapper = document.createElement('div');
    annonceWrapper.style.margin = "5px 0";
    annonceWrapper.innerHTML = `
      <label>
        <input type="checkbox" id="adminAnnonce"/> Message d'annonce
      </label>
    `;
    infosInput.parentNode.insertBefore(annonceWrapper, infosInput);

    setupAdminAnnonce(); // Configure la logique de la checkbox
  }

  // Affichage initial
  afficherTickets();
  connectWebSocket();

  // Écouteurs pour le formulaire
  document.getElementById('name').addEventListener('input', verifierAdminInput);
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    creerTicketDepuisFormulaire();
  });

  // Écouteurs pour l'ouverture/fermeture du formulaire modal
  const overlay = document.getElementById("formOverlay");
  const createBtn = document.getElementById("createbutton");
  overlay.style.display = "none";

  // Ferme l'overlay si on clique à l'extérieur
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  };

  // Ouvre l'overlay au clic sur "Nouveau ticket"
  createBtn.onclick = (e) => {
    e.preventDefault();
    overlay.style.display = "flex";
    
    // Réinitialise le formulaire (s'assure que "Message d'annonce" est décoché)
    const adminAnnonce = document.getElementById('adminAnnonce');
    if (adminAnnonce) adminAnnonce.checked = false;
    infosInput.style.display = 'block';
    
    // Relance l'animation d'apparition
    form.style.animation = "none";
    form.offsetHeight; // Force le reflow
    form.style.animation = null;
  };
});