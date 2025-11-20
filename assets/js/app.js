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
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// --- Attente chargement elements ---
if (document.readyState === 'complete') {
  // Déjà chargé
  document.body.classList.add('loaded');
} else {
  // Pas encore chargé, attendre
  window.addEventListener('load', function() {
    document.body.classList.add('loaded');
  });
}
// --- Connexion WebSocket ---
function connectWebSocket() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => console.log('WebSocket connecté');

  ws.onmessage = (event) => {
    const data = event.data;
    if (data === 'ping') { ws.send('pong'); return; }
    try {
      const message = JSON.parse(data);
      if (message.type === 'update') afficherTickets(true);
      if (message.type === 'updateAnnonce') {
        currentAnnonce = message.message.texte || "";
        const couleur = message.message.couleur || "#cdcdcd";
        const messageDiv = document.getElementById('message');
        messageDiv.textContent = currentAnnonce;
        messageDiv.style.display = currentAnnonce ? 'block' : 'none';
        messageDiv.style.color = couleur;
        
        const adminAnnonce = document.getElementById('adminAnnonce');
        const nom = document.getElementById('name');
        if (adminAnnonce?.checked) nom.value = currentAnnonce;
      }
    } catch { }
  };

  ws.onerror = (error) => console.error('Erreur WebSocket:', error);
  ws.onclose = () => {
    console.log('WebSocket déconnecté, reconnexion dans 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

// --- Fonctions API (Tickets) ---
async function getTickets() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function ajouterTicket(ticket) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticket)
  });
  const data = await res.json();
  lastAddedTicketId = data.id;
  return data;
}

async function supprimerTicket(id) {
  const isAdmin = localStorage.getItem('admin') === 'true';
  await fetch(`${API_URL}/${id}?userId=${userId}&admin=${isAdmin}`, { method: "DELETE" });
}

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

function toBase64(str) {
  try { return btoa(str); }
  catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

// --- Affichage des Tickets (DOM) ---
async function afficherTickets(externe = false) {
  const tickets = await getTickets();
  let newTicketId = null;
  const currentIds = new Set(tickets.map(t => t.id));

  if (externe && previousIds.size > 0) {
    for (const id of currentIds) {
      if (!previousIds.has(id)) newTicketId = id;
    }
  }
  previousIds = currentIds;

  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");

  const right = document.getElementById("right");
  right.querySelectorAll('.during').forEach(e => e.remove());
  enCours.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "during";
    div.id = ticket.id;

    if (ticket.id === lastAddedTicketId || ticket.id === newTicketId) {
      div.classList.add('add');
      setTimeout(() => div.classList.remove('add'), 600);
    }

    if (ticket.couleur?.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";

    let infoContent = `<p id="name">${ticket.nom}</p>`;
    if (ticket.description?.trim()) infoContent += `<p id="desc">${ticket.description}</p>`;

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

  const subdiv = document.getElementById("subdiv");
  subdiv.querySelectorAll('.history').forEach(e => e.remove());
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

  document.querySelectorAll('.delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const el = btn.closest('.during, .history');
      el.classList.add('bounce-reverse');
      el.addEventListener('animationend', async () => {
        await supprimerTicket(id);
        el.remove();
      }, { once: true });
    };
  });
}

// --- Gestionnaires d'Événements ---
document.getElementById("right").addEventListener("click", async (e) => {
  const checkbox = e.target.closest(".checkbox");
  if (!checkbox) return;

  const id = checkbox.dataset.id;
  const el = document.getElementById(id);
  if (!el) return;

  const tickets = await getTickets();
  if (localStorage.getItem('admin') !== 'true' &&
    !tickets.find(t => t.id === id && t.userId === userId)) {
    alert("Vous n'avez pas la permission de modifier ce ticket.");
    return;
  }

  el.classList.add("moving");
  el.addEventListener("animationend", async () => {
    await modifierTicket(id, { etat: "terminé" });
    afficherTickets();
  }, { once: true });
});

// --- Filtres et Mode Admin ---
async function chargerFiltres() {
  const res = await fetch("./assets/filter.json?cb=" + Date.now());
  const data = await res.json();
  filtresCache = data.banned_terms || [];
}

function activerModeAdmin() {
  localStorage.setItem('admin', 'true');
  const titre = document.getElementById('lefttitle');
  if (titre && !titre.textContent.includes('(admin mode)'))
    titre.textContent += ' (admin mode)';
  afficherTickets();
}

function desactiverModeAdmin() {
  localStorage.removeItem('admin');
  const titre = document.getElementById('lefttitle');
  if (titre)
    titre.textContent = titre.textContent.replace(' (admin mode)', '');
  afficherTickets();
}

function verifierAdminInput() {
  const nomInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const createBtn = document.getElementById('create');
  if (nomInput.value.trim().toLowerCase() === "admin") {
    infosInput.type = 'password';
    createBtn.textContent = "Valider";
  } else {
    infosInput.type = 'text';
    createBtn.textContent = "+ Créer";
  }
}

// --- Fonctions API (Annonces) ---
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
  } catch (e) { console.error("Erreur récupération annonce:", e); }
}

async function updateAnnonce(newMessage, couleur = "#cdcdcd") {
  try {
    await fetch(API_ANNONCE_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texte: newMessage, couleur })
    });
    currentAnnonce = newMessage;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'updateAnnonce', message: { texte: newMessage, couleur } }));
    }
  } catch (e) { console.error("Erreur mise à jour annonce:", e); }
}

// --- Logique Admin (Annonces) ---
function setupAdminAnnonce() {
  const adminAnnonce = document.getElementById('adminAnnonce');
  const infosInput = document.getElementById('infos');
  const nom = document.getElementById('name');
  const messageDiv = document.getElementById('message');

  if (!adminAnnonce) return;

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

  adminAnnonce.addEventListener('change', () => {
    if (adminAnnonce.checked) {
      nom.value = currentAnnonce;
      infosInput.style.display = 'none';
      messageDiv.style.display = 'block';
    } else {
      nom.value = '';
      infosInput.style.display = 'block';
      messageDiv.style.display = 'none';
    }
  });
}

// --- Création de Ticket (Logique Formulaire) ---
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  const infosInput = document.getElementById('infos');
  const description = infosInput.value.trim();
  const messageDiv = document.getElementById('message');
  const adminAnnonce = document.getElementById('adminAnnonce');

  if (!nom && !adminAnnonce.checked) return alert("Le nom est obligatoire");

  const contenu = (nom + " " + description).toLowerCase();
  const interdit = filtresCache.find(t => contenu.includes(t.toLowerCase()));
  if (interdit) return alert(`"${interdit}" est interdit.`);

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

  if (adminAnnonce && adminAnnonce.checked) {
    const selectedColor = document.querySelector('.color.selected');
    let couleur = '#d40000';
    if (selectedColor) {
      const bg = selectedColor.style.backgroundImage;
      const rgbMatch = bg.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);
        couleur = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }
    }
    messageDiv.textContent = nom;
    messageDiv.style.display = 'block';
    messageDiv.style.color = couleur;
    updateAnnonce(nom, couleur);

    document.getElementById('name').value = "";
    infosInput.value = "";
    // Ferme l'overlay spécifique du formulaire ticket
    document.getElementById("formOverlay").style.display = "none"; 
    return;
  }

  const tickets = await getTickets();
  const enCoursUtilisateur = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  
  if (enCoursUtilisateur.length >= maxDuringTicket && localStorage.getItem('admin') !== 'true') {
    return alert(`Vous ne pouvez pas avoir plus de ${maxDuringTicket} tickets en cours.`);
  }

  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';

  await ajouterTicket({ nom, description, couleur, etat: "en cours", userId });

  document.getElementById('name').value = "";
  infosInput.value = "";
  document.getElementById("formOverlay").style.display = "none";
}

// --- Initialisation (DOM) ---
window.addEventListener('DOMContentLoaded', async () => {
  await chargerFiltres();

  const infosInput = document.getElementById('infos');

  await fetchAnnonce();

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

    setupAdminAnnonce();
  }

  afficherTickets();
  connectWebSocket();

  document.getElementById('name').addEventListener('input', verifierAdminInput);
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    creerTicketDepuisFormulaire();
  });

  // --- GESTION DES MENUS (NOUVEAU SYSTÈME) ---
  
  // Fonction pour ouvrir n'importe quel menu
  function openMenu(overlayId) {
    const overlay = document.getElementById(overlayId);
    if(overlay) {
        overlay.style.display = "flex";
        // Relance l'animation sur la boîte (menu-box)
        const box = overlay.querySelector('.menu-box');
        if(box) {
            box.style.animation = "none";
            box.offsetHeight; // Force le reflow
            box.style.animation = null;
        }
    }
  }

  // 1. Menu Ticket
  document.getElementById("createbutton").addEventListener('click', (e) => {
    e.preventDefault();
    // Réinitialisations spécifiques au ticket
    const adminAnnonce = document.getElementById('adminAnnonce');
    if (adminAnnonce) adminAnnonce.checked = false;
    infosInput.style.display = 'block';
    
    openMenu("formOverlay");
  });

  // 2. Menu Réglages
  document.getElementById("setting").addEventListener('click', (e) => {
    e.preventDefault();
    openMenu("settingsOverlay");
  });
  
  // Bouton fermer dans les réglages (si vous l'avez ajouté)
  const closeSettingsBtn = document.getElementById("closeSettings");
  if(closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById("settingsOverlay").style.display = "none";
      });
  }

  // 3. Fermeture universelle au clic à l'extérieur
  document.querySelectorAll('.menu-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
              overlay.style.display = "none";
          }
      });
  });

});