const API_URL = "https://ticketapi.juhdd.me";

// get user id
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// auto join room if saved
async function tryAutoJoin() {
  const lastRoom = localStorage.getItem('last_room');

  if (lastRoom) {
    try {
      // check if room exists
      const res = await fetch(`${API_URL}/api/rooms/${lastRoom}`);
      const data = await res.json();

      if (data && !data.error) {
        // room valid, redirect
        window.location.href = `room.html?room=${lastRoom}`;
      } else {
        // room invalid, clear storage
        localStorage.removeItem('last_room');
      }
    } catch (err) {
      // api error, clear storage to be safe
      console.error("auto join error", err);
      localStorage.removeItem('last_room');
    }
  }
}

// run auto join check
tryAutoJoin();

// select main buttons
const buttons = document.querySelectorAll('.button-text');
const joinBtn = buttons[0]; // first button is join
const createBtn = buttons[1]; // second button is create

// select overlay elements
const joinOverlay = document.getElementById('joinOverlay');
const joinCodeInput = document.getElementById('joinCodeInput');
const confirmJoinBtn = document.getElementById('confirmJoin');
const cancelJoinBtn = document.getElementById('cancelJoin');


/* --- LOGIQUE DU MENU REJOINDRE --- */

// 1. Ouvrir le menu
if (joinBtn) {
  joinBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Afficher l'overlay (flex pour centrer le contenu)
    joinOverlay.style.display = 'flex';
    // Vider l'input précédent
    joinCodeInput.value = '';
    // Mettre le focus dans l'input pour taper directement
    setTimeout(() => joinCodeInput.focus(), 50);
  });
}

// Fonction pour fermer le menu
function closeOverlay() {
  joinOverlay.style.display = 'none';
}

// 2. Fermer le menu via le bouton Annuler
if (cancelJoinBtn) {
  cancelJoinBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeOverlay();
  });
}

// 3. Fermer le menu au clic à l'extérieur (sur le fond gris)
if (joinOverlay) {
  joinOverlay.addEventListener('click', (e) => {
    // Si l'élément cliqué est exactement l'overlay (et pas la boîte blanche à l'intérieur)
    if (e.target === joinOverlay) {
      closeOverlay();
    }
  });
}

// 4. Valider et rejoindre
function submitJoin() {
  const code = joinCodeInput.value;
  if (code && code.trim() !== "") {
    window.location.href = `room.html?room=${code.trim()}`;
  }
}

if (confirmJoinBtn) {
  confirmJoinBtn.addEventListener('click', (e) => {
    e.preventDefault();
    submitJoin();
  });
}

// Bonus : Valider avec la touche Entrée dans l'input
if (joinCodeInput) {
  joinCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitJoin();
    }
  });
}


/* --- LOGIQUE DE CRÉATION DE GROUPE --- */

// handle create click
if (createBtn) {
  createBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
      // create room api call
      const res = await fetch(`${API_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // change adminId to userId to match server expectation
        body: JSON.stringify({ userId: userId })
      });

      const data = await res.json();

      // redirect to new room
      if (data && data.code) {
        window.location.href = `room.html?room=${data.code}`;
      } else {
        alert("Erreur lors de la création du groupe");
      }
    } catch (err) {
      console.error("api error", err);
      alert("Impossible de contacter le serveur");
    }
  });
}