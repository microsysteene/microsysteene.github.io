const BASE_URL = "https://jsonblob.com/api/jsonBlob/1428271133970587648";

// Récupérer tous les tickets
async function getTickets() {
  const res = await fetch(BASE_URL, { headers: { "Accept": "application/json" } });
  return await res.json();
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

// Exemple d'utilisation
// ajouterTicket({ nom: "Test", description: "desc", couleur: "#FF0000", etat: "en cours" });
// supprimerTicket("1697460000000"); // id à remplacer

// getTickets().then(console.log);