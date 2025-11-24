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
      const res = await fetch(`${API_URL}/api/rooms`, {
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