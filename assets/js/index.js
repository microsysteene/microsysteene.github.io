const API_URL = "https://ticketapi.juhdd.me";

// Get user ID
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// Auto join room if saved
async function tryAutoJoin() {
  const lastRoom = localStorage.getItem('last_room');

  if (lastRoom) {
    try {
      // Check if room exists
      const res = await fetch(`${API_URL}/api/rooms/${lastRoom}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) {
          window.location.href = `room.html?room=${lastRoom}`;
        } else {
          localStorage.removeItem('last_room');
        }
      } else if (res.status === 404) {
        // Room doesn't exist anymore
        localStorage.removeItem('last_room');
      }
    } catch (err) {
      console.error("Auto join error (network?):", err);
      // Don't remove local storage on simple network error
    }
  }
}

tryAutoJoin();

// Select main buttons
const buttons = document.querySelectorAll('.button-text');
const joinBtn = buttons[0];
const createBtn = buttons[1];

// Select overlay elements
const joinOverlay = document.getElementById('joinOverlay');
const joinCodeInput = document.getElementById('joinCodeInput');
const confirmJoinBtn = document.getElementById('confirmJoin');
// Note: cancelJoinBtn is implicitly handled by clicking outside

/* --- JOIN MENU LOGIC --- */

if (joinBtn) {
  joinBtn.addEventListener('click', (e) => {
    e.preventDefault();
    joinOverlay.style.display = 'flex';
    joinCodeInput.value = '';
    setTimeout(() => joinCodeInput.focus(), 50);
  });
}

function closeOverlay() {
  joinOverlay.style.display = 'none';
}

if (joinOverlay) {
  joinOverlay.addEventListener('click', (e) => {
    if (e.target === joinOverlay) {
      closeOverlay();
    }
  });
}

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

if (joinCodeInput) {
  joinCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitJoin();
    }
  });
}

/* --- CREATE ROOM LOGIC --- */

if (createBtn) {
  createBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
      const res = await fetch(`${API_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sending userId as the creator
        body: JSON.stringify({ userId: userId })
      });

      const data = await res.json();

      if (data && data.code) {
        window.location.href = `room.html?room=${data.code}`;
      } else {
        alert("Erreur lors de la création du groupe");
      }
    } catch (err) {
      console.error("API Error", err);
      alert("Impossible de contacter le serveur");
    }
  });
}