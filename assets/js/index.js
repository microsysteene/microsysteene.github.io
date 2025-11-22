const BASE_URL = "http://localhost:3000";

// get user id
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// select buttons
const buttons = document.querySelectorAll('.button-text');
const joinBtn = buttons[0]; // first button is join
const createBtn = buttons[1]; // second button is create

// handle join click
if (joinBtn) {
  joinBtn.addEventListener('click', (e) => {
    e.preventDefault();

    // simple prompt for room code
    const code = prompt("Entrez le code du groupe :");
    if (code && code.trim() !== "") {
      window.location.href = `room.html?room=${code.trim()}`;
    }
  });
}

// handle create click
if (createBtn) {
  createBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
      // create room api call
      const res = await fetch(`${BASE_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // change adminId to userId to match server expectation
        body: JSON.stringify({ userId: userId })
      });

      const data = await res.json();

      // redirect to new room
      // change data.roomCode to data.code
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