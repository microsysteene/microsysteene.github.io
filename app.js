const API_URL = "http://localhost:3000/api/tickets";

// Récupérer tous les tickets
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

// Ajouter un ticket
async function ajouterTicket(ticket) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(ticket)
    });
    
    if (!res.ok) {
      throw new Error('Erreur lors de la création du ticket');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Erreur lors de l\'ajout du ticket:', error);
    alert('Erreur lors de l\'ajout du ticket');
  }
}

// Supprimer un ticket par id
async function supprimerTicket(id) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "DELETE"
    });
    
    if (!res.ok) {
      throw new Error('Erreur lors de la suppression');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Erreur lors de la suppression du ticket:', error);
    alert('Erreur lors de la suppression');
  }
}

// Mettre à jour un ticket
async function modifierTicket(id, modifications) {
  try {
    const res = await fetch(`${API_URL}/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(modifications)
    });
    
    if (!res.ok) {
      throw new Error('Erreur lors de la modification');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Erreur lors de la modification du ticket:', error);
    alert('Erreur lors de la modification');
  }
}

// Calcule le temps écoulé depuis la création
function formatTempsEcoule(dateCreation) {
  if (!dateCreation) return '';
  
  const now = new Date();
  const creation = new Date(dateCreation);
  const diffMs = now - creation;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHeures = Math.floor(diffMs / 3600000);
  const diffJours = Math.floor(diffMs / 86400000);
  
  if (diffJours > 0) {
    return `(${diffJours}j)`;
  } else if (diffHeures > 0) {
    return `(${diffHeures}h)`;
  } else {
    return `(${diffMins}mins)`;
  }
}

// Affiche les tickets dans l'interface
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
    // Vérifie si c'est un gradient ou une couleur
    if (ticket.couleur && ticket.couleur.includes('gradient')) {
      div.style.backgroundImage = ticket.couleur;
    } else {
      div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    }
    
    // Construit le contenu de l'info section
    let infoContent = `<p id="name">${ticket.nom}</p>`;
    if (ticket.description && ticket.description.trim()) {
      infoContent += `<p id="desc">${ticket.description}</p>`;
    }
    
    div.innerHTML = `
      <div class="checkbox" data-id="${ticket.id}"></div>
      <div class="info">
        ${infoContent}
      </div>
      <div class="time">
        <p id="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</p>
        <p id="remaining">${formatTempsEcoule(ticket.dateCreation)}</p>
      </div>
    `;
    right.appendChild(div);
  });

  // Historique
  const subdiv = document.getElementById("subdiv");
  subdiv.querySelectorAll('.history').forEach(e => e.remove());
  
  historique.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "history";
    // Vérifie si c'est un gradient ou une couleur
    if (ticket.couleur && ticket.couleur.includes('gradient')) {
      div.style.backgroundImage = ticket.couleur;
    } else {
      div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    }
    div.innerHTML = `
      <p class="name">${ticket.nom}</p>
      <div class="time">
        <p class="created">${ticket.dateCreation ? new Date(ticket.dateCreation).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</p>
        <p class="etat">${ticket.etat}</p>
      </div>
      <a class="delete" data-id="${ticket.id}">–</a>
    `;
    subdiv.appendChild(div);
  });

  // Ajout listeners suppression
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await supprimerTicket(btn.dataset.id);
      await afficherTickets();
    });
  });

  // Ajout listeners checkbox pour changer l'état
  document.querySelectorAll('.checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', async (e) => {
      const id = checkbox.dataset.id;
      await modifierTicket(id, { etat: "terminé" });
      await afficherTickets();
    });
  });
}

// Création d'un ticket
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  if (!nom) return alert('Le nom est obligatoire');
  
  const description = document.getElementById('infos').value;
  const selectedColor = document.querySelector('.color.selected');
  const couleur = selectedColor ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) : '#cdcdcd';
  
  const ticket = {
    nom,
    description,
    couleur,
    etat: "en cours"
  };
  
  await ajouterTicket(ticket);
  document.getElementById('name').value = "";
  document.getElementById('infos').value = "";
  await afficherTickets();
}

// Initialisation
window.addEventListener('DOMContentLoaded', () => {
  afficherTickets();
  
  const createBtn = document.getElementById('create');
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      creerTicketDepuisFormulaire();
    });
  }
  
  // Mise à jour automatique des tickets toutes les 10 secondes
  setInterval(afficherTickets, 10000);
});