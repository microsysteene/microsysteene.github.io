const API_URL = "https://ticketapi.juhdd.me/api/tickets";
const WS_URL = "wss://ticketapi.juhdd.me";
const maxDuringTicket = 1;
let lastAddedTicketId = null;

let previousIds = new Set();

let filtresCache = [];
let ws = null;

// Identifiant unique de l'utilisateur (pour gérer permissions)
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// Connexion WebSocket pour synchro temps réel
function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('WebSocket connecté');

  ws.onmessage = (event) => {
    const data = event.data;
    if (data === 'ping') {
      ws.send('pong');
      return;
    }
    try {
      const message = JSON.parse(data);
      if (message.type === 'update') {
        afficherTickets(true); // externe = true
      }
    } catch {}
  };

  ws.onerror = (error) => console.error('Erreur WebSocket:', error);

  ws.onclose = () => {
    console.log('WebSocket déconnecté, reconnexion dans 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

// Récupération des tickets
async function getTickets() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Création d’un ticket
async function ajouterTicket(ticket) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticket)
  });
  const data = await res.json();

  // Animation spécifique pour celui qu’on vient d’ajouter depuis CE device
  lastAddedTicketId = data.id;

  return data;
}

// Suppression
async function supprimerTicket(id) {
  const isAdmin = localStorage.getItem('admin') === 'true';
  await fetch(`${API_URL}/${id}?userId=${userId}&admin=${isAdmin}`, { method: "DELETE" });
}

// modif etat
async function modifierTicket(id, modifications) {
  await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modifications)
  });
}

var jstextimport = "OHMwTTc4Y3Y=";

// age ticket
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

//animations
async function afficherTickets(externe = false) {
  const tickets = await getTickets();

  // Détection d’un nouveau ticket venant d’ailleurs
  let newTicketId = null;
  const currentIds = new Set(tickets.map(t => t.id));

  if (externe && previousIds.size > 0) {
    for (const id of currentIds) {
      if (!previousIds.has(id)) newTicketId = id;
    }
  }

  previousIds = currentIds; // mise à jour mémoire

  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");

  // 
  //en cours

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

    if (ticket.couleur && ticket.couleur.includes('gradient')) div.style.backgroundImage = ticket.couleur;
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


  //historique
 
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

  // Animation suppression
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

// terminer le ticket
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

function toBase64(str) {
  try { return btoa(str); }
  catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

// Load filter list (mots interdits)
async function chargerFiltres() {
  const res = await fetch("./assets/filter.json?cb=" + Date.now());
  const data = await res.json();
  filtresCache = data.banned_terms || [];
}

// Admin
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

// Check admin password input
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

// Création ticket via formulaire
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  const description = document.getElementById('infos').value.trim();
  if (!nom) return alert("Le nom est obligatoire");

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

  const tickets = await getTickets();
  const enCoursUtilisateur = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (enCoursUtilisateur.length >= maxDuringTicket && localStorage.getItem('admin') !== 'true') {
    return alert(`Vous ne pouvez pas avoir plus de ${maxDuringTicket} tickets en cours.`);
  }

  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';

  await ajouterTicket({ nom, description, couleur, etat: "en cours", userId });

  document.getElementById('name').value = "";
  document.getElementById('infos').value = "";
  document.getElementById("formOverlay").style.display = "none";
}

// Initialisation
window.addEventListener('DOMContentLoaded', async () => {
  await chargerFiltres();
  
  if (localStorage.getItem('admin') === 'true') {
    const titre = document.getElementById('lefttitle');
    if (titre && !titre.textContent.includes('(admin mode)'))
      titre.textContent += ' (admin mode)';
  }

  afficherTickets();
  connectWebSocket();

  document.getElementById('name').addEventListener('input', verifierAdminInput);
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    creerTicketDepuisFormulaire();
  });
});

const overlay = document.getElementById("formOverlay");
const createBtn = document.getElementById("createbutton");

overlay.style.display = "none";

overlay.onclick = (e) => {
  if (e.target === overlay) overlay.style.display = "none";
};

createBtn.onclick = (e) => {
  e.preventDefault();
  overlay.style.display = "flex";
  const form = document.querySelector(".ticket-form");
  form.style.animation = "none";
  form.offsetHeight;
  form.style.animation = null;
};
