const API_URL = "https://ticketapi.juhdd.me/api/tickets";
var jstextimport = "OHMwTTc4Y3Y=";

// Cache filtres
let filtresCache = [];

// Identifiant unique par navigateur
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// ===== Fonctions tickets =====
async function getTickets() {
  try {
    const res = await fetch(API_URL);
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
    const res = await fetch(`${API_URL}/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    if (!res.ok) throw new Error('Erreur lors de la suppression');
    return await res.json();
  } catch (error) {
    console.error("Erreur lors de la suppression du ticket:", error);
    alert("Erreur lors de la suppression");
  }
}

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
  return `(${diffMins}mins)`;
}

async function afficherTickets() {
  const tickets = await getTickets();
  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");

  // Tickets en cours
  const right = document.getElementById("right");
  right.querySelectorAll('.during').forEach(e => e.remove());
  enCours.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "during";
    div.id = ticket.id;
    if (ticket.couleur && ticket.couleur.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    let infoContent = `<p id="name">${ticket.nom}</p>`;
    if (ticket.description && ticket.description.trim()) infoContent += `<p id="desc">${ticket.description}</p>`;
    div.innerHTML = `
      <div class="checkbox" data-id="${ticket.id}"></div>
      <div class="info">${infoContent}</div>
      <div class="time">
        <p id="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
        <p id="remaining">${formatTempsEcoule(ticket.dateCreation)}</p>
      </div>
      ${(localStorage.getItem('admin') === 'true' || ticket.userId === userId) ? `<a class="delete" data-id="${ticket.id}">–</a>` : ""}
    `;
    right.appendChild(div);
  });

  // Historique
  const subdiv = document.getElementById("subdiv");
  subdiv.querySelectorAll('.history').forEach(e => e.remove());
  historique.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "history";
    if (ticket.couleur && ticket.couleur.includes('gradient')) div.style.backgroundImage = ticket.couleur;
    else div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    div.innerHTML = `
      <p class="name">${ticket.nom}</p>
      <div class="time">
        <p class="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
        <p class="etat">${ticket.etat}</p>
      </div>
      ${(localStorage.getItem('admin') === 'true' || ticket.userId === userId) ? `<a class="delete" data-id="${ticket.id}">–</a>` : ""}
    `;
    subdiv.appendChild(div);
  });

  // Listeners suppression
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await supprimerTicket(btn.dataset.id);
      await afficherTickets();
    });
  });

  // Listeners checkbox pour terminer un ticket
  document.querySelectorAll('.checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', async () => {
      const id = checkbox.dataset.id;
      // verifier si l'utilisateur a le droit de modifier ce ticket
      if (localStorage.getItem('admin') !== 'true' && !tickets.find(t => t.id === id && t.userId === userId)) {
        alert("Vous n'avez pas la permission de modifier ce ticket.");
        return;
      } else {
        await modifierTicket(id, { etat: "terminé" });
        await afficherTickets();
      }
    });
  });
}

// conversion base64 (unicode safe)
function toBase64(str) {
  try { return btoa(str); }
  catch (e) { return btoa(unescape(encodeURIComponent(str))); }
}

// --- Mode admin ---
function activerModeAdmin(mdp) {
  if (mdp === jstextimport) {
    console.log("Activation du mode admin");
    const titre = document.getElementById('lefttitle');
    if (titre && !titre.textContent.includes('(admin mode)')) titre.textContent += ' (admin mode)';
    localStorage.setItem('admin', 'true');
    document.getElementById('infos').type = 'text';
    document.getElementById('create').textContent = "Créer";
    document.getElementById('name').value = "";
    document.getElementById('infos').value = "";
  } else {
    console.log("Mot de passe incorrect");
  }
}

  function desactiverModeAdmin() {
    localStorage.removeItem('admin');
    const titre = document.getElementById('lefttitle');
    if (titre) titre.textContent = titre.textContent.replace(' (admin mode)', '');
    //suppimer le role admin du local storage
    localStorage.removeItem('admin');
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

    // Mode admin
    if (nom.toLowerCase() === "admin") {
      const psw = description;
      if (toBase64(psw) === jstextimport) {
        activerModeAdmin(jstextimport);
        alert("Mode admin activé !");
      } else if (localStorage.getItem('admin') === 'true' && psw.toLowerCase() === "") {
        desactiverModeAdmin();
      } else {
        alert("Mot de passe incorrect");
      }
      return;
    }

    // Création normale
    const selectedColor = document.querySelector('.color.selected');
    const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';
    const ticket = { nom, description, couleur, etat: "en cours", userId };

    await ajouterTicket(ticket);
    document.getElementById('name').value = "";
    document.getElementById('infos').value = "";
    await afficherTickets();
  }

  // --- Initialisation ---
  window.addEventListener('DOMContentLoaded', async () => {
    await chargerFiltres();
    afficherTickets();

    const nomInput = document.getElementById('name');
    const createBtn = document.getElementById('create');

    if (localStorage.getItem('admin') === 'true') activerModeAdmin();

    nomInput.addEventListener('input', verifierAdminInput);

    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      creerTicketDepuisFormulaire();
    });

    setInterval(afficherTickets, 10000);
  });
