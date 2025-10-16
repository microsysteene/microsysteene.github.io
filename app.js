const BASE_URL = "https://jsonblob.com/api/jsonBlob/1428271133970587648";

// Récupérer tous les tickets
async function getTickets() {
  const res = await fetch(BASE_URL, { headers: { "Accept": "application/json" } });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Ajouter un ticket
async function ajouterTicket(ticket) {
  const tickets = await getTickets();
  ticket.id = Date.now().toString(); // id unique
  ticket.dateCreation = new Date().toISOString();
  tickets.push(ticket);
  await updateTickets(tickets);
}

// Supprimer un ticket par id
async function supprimerTicket(id) {
  const tickets = await getTickets();
  const nouveauxTickets = tickets.filter(t => t.id !== id);
  await updateTickets(nouveauxTickets);
}

// Mettre à jour le blob
async function updateTickets(tickets) {
  await fetch(BASE_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(tickets)
  });
}

// Affiche les tickets dans l'interface
async function afficherTickets() {
  const tickets = await getTickets();
  const enCours = tickets.filter(t => t.etat === "en cours");
  const historique = tickets.filter(t => t.etat !== "en cours");

  //Ticket en cours
  const right = document.getElementById("right");
  right.querySelectorAll('.during').forEach(e => e.remove());
  enCours.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "during";
    div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    div.innerHTML = `
      <div class="checkbox" data-id="${ticket.id}"></div>
      <p class="name">${ticket.nom}</p>
      <div class="time">
        <p class="created">${new Date(ticket.dateCreation).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        <p class="remaining">(${ticket.etat})</p>
      </div>
      <button class="supprimer" data-id="${ticket.id}">Supprimer</button>
    `;
    right.appendChild(div);
  });

// Exemple d'utilisation
// ajouterTicket({ nom: "Test", description: "desc", couleur: "#FF0000", etat: "en cours" });
// supprimerTicket("1697460000000"); // id à remplacer

// getTickets().then(console.log);

  //Historique
  const subdiv = document.getElementById("subdiv");
  subdiv.querySelectorAll('.history').forEach(e => e.remove());
  historique.forEach(ticket => {
    const div = document.createElement('div');
    div.className = "history";
    div.style.backgroundColor = ticket.couleur || "#cdcdcd";
    div.innerHTML = `
      <p class="name">${ticket.nom}</p>
      <div class="time">
        <p class="created">${new Date(ticket.dateCreation).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        <p class="etat">${ticket.etat}</p>
      </div>
      <button class="supprimer" data-id="${ticket.id}">Supprimer</button>
    `;
    subdiv.appendChild(div);
  });

  // Ajout listeners suppression
  document.querySelectorAll('.supprimer').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      await supprimerTicket(btn.dataset.id);
      afficherTickets();
    });
  });
}

// Création d'un ticket
async function creerTicketDepuisFormulaire() {
  const nom = document.getElementById('name').value.trim();
  if (!nom) return alert('Le nom est obligatoire');
  const description = document.getElementById('infos').value;
  const couleur = document.querySelector('.color.selected').style.backgroundColor;
  const ticket = {
    nom,
    description,
    couleur,
    etat: "en cours"
  };
  await ajouterTicket(ticket);
  document.getElementById('name').value = "";
  document.getElementById('infos').value = "";
  afficherTickets();
}

// Initialisation
window.addEventListener('DOMContentLoaded', () => {
  afficherTickets();
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    creerTicketDepuisFormulaire();
  });
});
