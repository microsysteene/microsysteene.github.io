const API_URL = "https://ticketapi.juhdd.me/api/tickets";
const WS_URL = "wss://ticketapi.juhdd.me";


// Cache filtres
let filtresCache = [];
let ws = null;

// Id
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// WebSocket
function connectWebSocket() {
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('WebSocket connecté');
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'update') {
      afficherTickets();
    }
  };
  
  ws.onerror = (error) => {
    console.error('Erreur WebSocket:', error);
  };
  
  ws.onclose = () => {
    console.log('WebSocket déconnecté, reconnexion dans 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

// tickets API
async function getTickets() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Erreur HTTP: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Erreur lors de la récupération des tickets:', error);
    return [];
  }
}

async function ajouterTicket(ticket) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket)
    });
    if (!res.ok) throw new Error('Erreur lors de la création du ticket');
    return await res.json();
  } catch (error) {
    console.error("Erreur lors de l'ajout du ticket:", error);
    alert("Erreur lors de l'ajout du ticket");
  }
}

async function supprimerTicket(id) {
  try {
    const bodyContent = { 
        userId: userId, 
        isAdmin: localStorage.getItem('admin') === 'true' 
    };
    
    const res = await fetch(`${API_URL}/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyContent)
    });
    if (!res.ok) throw new Error('Erreur lors de la suppression');
    return res.status === 204 ? true : await res.json();
  } catch (error) {
    console.error("Erreur lors de la suppression du ticket:", error);
    alert("Erreur lors de la suppression");
  }
}
var jstextimport = "OHMwTTc4Y3Y=";
async function modifierTicket(id, modifications) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modifications)
    });
    if (!res.ok) throw new Error('Erreur lors de la modification');
    return await res.json();
  } catch (error) {
    console.error("Erreur lors de la modification du ticket:", error);
    alert("Erreur lors de la modification");
  }
}

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
  return diffMins > 0 ? `(${diffMins}mins)` : '(juste créé)'; 
}

function waitForAnimationEnd(element) {
    return new Promise(resolve => {
        element.addEventListener('animationend', function handler() {
            element.removeEventListener('animationend', handler);
            resolve();
        }, { once: true });
    });
}


async function afficherTickets() {
  const tickets = await getTickets();
  if (!tickets) return; // Si getTickets échoue
  
  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");
  const isAdmin = localStorage.getItem('admin') === 'true';

  const right = document.getElementById("right");

  const elementsActuels = Array.from(right.querySelectorAll('.during'));
  const ticketsExistantsIDs = new Set(elementsActuels.map(div => div.id));
  
  right.innerHTML = ''; 

  enCours.forEach(ticket => {
    const div = document.createElement('div');
    
    const estNouveau = !ticketsExistantsIDs.has(ticket.id); 
    div.className = estNouveau ? "during new-task" : "during";
    
    div.id = ticket.id;
    if (ticket.couleur && ticket.couleur.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    
    let infoContent = `<p id="name">${ticket.nom}</p>`;
    if (ticket.description && ticket.description.trim()) infoContent += `<p id="desc">${ticket.description}</p>`;
    
    const canDelete = isAdmin || ticket.userId === userId;
    const deleteButton = canDelete ? `<a class="delete" data-id="${ticket.id}">–</a>` : "";

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
    
    if (estNouveau) {
      setTimeout(() => {
        div.classList.remove('new-task');
      }, 600);
    }
  });

  // --- Gestion de l'historique ---
  const subdiv = document.getElementById("subdiv");
  subdiv.innerHTML = '';

  historique.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "history";
    div.id = ticket.id;
    if (ticket.couleur && ticket.couleur.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    
    const deleteButton = isAdmin ? `<a class="delete" data-id="${ticket.id}">–</a>` : "";

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

  // --- Listeners de suppression ---
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const ticketId = btn.dataset.id;
      const ticketElement = document.getElementById(ticketId);
      
      if (ticketElement) {
        ticketElement.classList.add('deleting');
        
        await waitForAnimationEnd(ticketElement);
      }
      
      await supprimerTicket(ticketId);
      await afficherTickets();
    });
  });

  // --- Listeners checkbox pour terminer un ticket ---
  document.querySelectorAll('.checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', async () => {
      const id = checkbox.dataset.id;
      const ticket = tickets.find(t => t.id === id);

      // Vérification des permissions
      if (!isAdmin && (!ticket || ticket.userId !== userId)) {
        alert("Vous n'avez pas la permission de modifier ce ticket.");
        return;
      } 
      
      const ticketElement = document.getElementById(id);
      
      // Animation avant de terminer
      if (ticketElement) {
        ticketElement.classList.add('deleting');
        
        // **CORRECTION MAJEURE** : Attendre la fin de l'animation CSS
        await waitForAnimationEnd(ticketElement); // Plus sûr que le setTimeout(400)
      }
      
      await modifierTicket(id, { etat: "terminé" });
      await afficherTickets();
    });
  });
}

// conversion base64 (unicode safe)
function toBase64(str) {
  try { return btoa(str); }
  catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

// --- Mode admin ---
function activerModeAdmin() {
  console.log("Activation du mode admin");
  const titre = document.getElementById('lefttitle');
  if (titre && !titre.textContent.includes('(admin mode)')) {
    titre.textContent += ' (admin mode)';
  }
  localStorage.setItem('admin', 'true');
  
  // Réinitialiser les champs
  const infosInput = document.getElementById('infos');
  const createBtn = document.getElementById('create');
  const nameInput = document.getElementById('name');
  
  if (infosInput) infosInput.type = 'text';
  if (createBtn) createBtn.textContent = "Créer";
  if (nameInput) nameInput.value = "";
  if (infosInput) infosInput.value = "";
  
  // Rafraîchir l'affichage pour montrer les boutons de suppression
  afficherTickets();
}

function desactiverModeAdmin() {
  console.log("Désactivation du mode admin");
  localStorage.removeItem('admin');
  const titre = document.getElementById('lefttitle');
  if (titre) titre.textContent = titre.textContent.replace(' (admin mode)', '');
  
  // Rafraîchir l'affichage pour cacher les boutons de suppression
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
    createBtn.textContent = "Créer";
  }
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
    createBtn.textContent = "Créer";
  }
}

// --- Chargement filtres ---
async function chargerFiltres() {
  try {
    // cachebuster pour forcer la MAJ à chaque refresh
    const res = await fetch("./assets/filter.json?cachebuster=" + Date.now());
    if (!res.ok) throw new Error("Erreur lors du chargement de filter.json");
    const data = await res.json();
    filtresCache = data.banned_terms || [];
  } catch (error) {
    console.error("Erreur de chargement du filtre:", error);
    filtresCache = [];
  }
}
// --- Chargement filtres ---
async function chargerFiltres() {
  try {
    // cachebuster pour forcer la MAJ à chaque refresh
    const res = await fetch("./assets/filter.json?cachebuster=" + Date.now());
    if (!res.ok) throw new Error("Erreur lors du chargement de filter.json");
    const data = await res.json();
    filtresCache = data.banned_terms || [];
  } catch (error) {
    console.error("Erreur de chargement du filtre:", error);
    filtresCache = [];
  }
}

// --- Création ticket ---
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  const description = document.getElementById('infos').value.trim();
  if (!nom) return alert("Le nom est obligatoire");
// --- Création ticket ---
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  const description = document.getElementById('infos').value.trim();
  if (!nom) return alert("Le nom est obligatoire");

  // Vérification filtres
  const contenu = (nom + " " + description).toLowerCase();
  const interdit = filtresCache.find(term => contenu.includes(term.toLowerCase()));
  if (interdit) {
    alert(`Le terme "${interdit}" est interdit. Ticket non créé.`);
    return;
  }
  // Vérification filtres
  const contenu = (nom + " " + description).toLowerCase();
  const interdit = filtresCache.find(term => contenu.includes(term.toLowerCase()));
  if (interdit) {
    alert(`Le terme "${interdit}" est interdit. Ticket non créé.`);
    return;
  }

  // Mode admin
  if (nom.toLowerCase() === "admin") {
    const psw = description;
    if (toBase64(psw) === jstextimport) {
      activerModeAdmin();
      alert("Mode admin activé !");
    } else if (localStorage.getItem('admin') === 'true' && psw.toLowerCase() === "") {
      desactiverModeAdmin();
      alert("Mode admin désactivé !");
    } else {
      alert("Mot de passe incorrect");
    }
    return;
  }

  // Création normale
  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';
  const ticket = { nom, description, couleur, etat: "en cours", userId };
  // Création normale
  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';
  const ticket = { nom, description, couleur, etat: "en cours", userId };

  await ajouterTicket(ticket);
  document.getElementById('name').value = "";
  document.getElementById('infos').value = "";
  await afficherTickets();
}
  await ajouterTicket(ticket);
  document.getElementById('name').value = "";
  document.getElementById('infos').value = "";
  await afficherTickets();
}

// --- Initialisation ---
window.addEventListener('DOMContentLoaded', async () => {
  await chargerFiltres();
  
  // Vérifier si le mode admin était activé
  if (localStorage.getItem('admin') === 'true') {
    const titre = document.getElementById('lefttitle');
    if (titre && !titre.textContent.includes('(admin mode)')) {
      titre.textContent += ' (admin mode)';
    }
  }
  
  afficherTickets();
  connectWebSocket();

  const nomInput = document.getElementById('name');
  const createBtn = document.getElementById('create');

  nomInput.addEventListener('input', verifierAdminInput);
  nomInput.addEventListener('input', verifierAdminInput);

  createBtn.addEventListener('click', (e) => {
    e.preventDefault();
    creerTicketDepuisFormulaire();
  });
});