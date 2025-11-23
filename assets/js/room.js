const API_URL = "https://ticketapi.juhdd.me"; 
const WS_URL = "wss://ticketapi.juhdd.me";

// --- FONCTIONS DARK MODE & COPIE ---

function initFeatures() {
  // 1. Charger et appliquer le Dark Mode
  const isDarkMode = localStorage.getItem('dark_mode') === 'true';
  const darkToggle = document.getElementById('darkModeToggle');
  
  if (darkToggle) {
    darkToggle.checked = isDarkMode;
    // Appliquer la classe si sauvegardé
    if (isDarkMode) document.body.classList.add('dark-mode');
    
    // Écouteur pour le changement immédiat
    darkToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('dark_mode', 'true');
      } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('dark_mode', 'false');
      }
    });
  }

  // 2. Gestion du bouton Copier le lien
  const copyBtn = document.getElementById('copyLink');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const link = window.location.href;
      
      navigator.clipboard.writeText(link).then(() => {
        const textSpan = document.getElementById('copyText');
        const originalText = textSpan.textContent;
        
        // Feedback visuel
        textSpan.textContent = "Copié !";
        setTimeout(() => textSpan.textContent = originalText, 2000);
      }).catch(err => {
        console.error('Erreur copie :', err);
        alert("Impossible de copier le lien automatiquement.");
      });
    });
  }
}

// get room code
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');

// save room code
if (roomCode) {
  localStorage.setItem('last_room', roomCode);
}

// redirect if no room
if (!roomCode) {
  window.location.href = "/";
}

const MAX_DURING_TICKET = 1;
let ws = null;
let currentAnnonce = "";
let lastTicketIds = new Set();
let filterCache = [];
let isRendering = false;
let isRoomAdmin = false;

// get user id
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('userId', userId);
}

// add loaded class
if (document.readyState === 'complete') {
  document.body.classList.add('loaded');
} else {
  window.addEventListener('load', () => document.body.classList.add('loaded'));
}

// websocket functions

// connect ws
function connectWebSocket() {
  ws = new WebSocket(`${WS_URL}?room=${roomCode}`);
  
  ws.onopen = () => console.log('ws connected', roomCode);
  ws.onmessage = (event) => {
    if (event.data === 'ping') {
      ws.send('pong');
      return;
    }
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') renderTickets(true);
      if (msg.type === 'updateAnnonce') handleAnnonceUpdate(msg.message);
    } catch (e) {
      console.error('ws error', e);
    }
  };
  ws.onerror = (err) => console.error('ws error', err);
  
  ws.onclose = () => {
    console.log('ws closed, retry in 3s');
    setTimeout(connectWebSocket, 3000);
  };
}

// update announcement ui
function handleAnnonceUpdate(data) {
  currentAnnonce = data.texte || "";
  const color = data.couleur || "#cdcdcd";
  
  const msgDiv = document.getElementById('message');
  if (msgDiv) {
    msgDiv.textContent = currentAnnonce;
    msgDiv.style.display = currentAnnonce ? 'block' : 'none';
    msgDiv.style.color = color;
  }
  const adminCheck = document.getElementById('adminAnnonce');
  const nameInput = document.getElementById('name');
  if (adminCheck?.checked && nameInput) {
    nameInput.value = currentAnnonce;
  }
}

// api functions

// fetch wrapper
async function apiCall(endpoint, method = "GET", body = null) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (body) options.body = JSON.stringify(body);
    
    // use api_url here
    const res = await fetch(`${API_URL}${endpoint}`, options);
    if (method === "DELETE") return true; 
    return await res.json();
  } catch (e) {
    console.error(`api error ${method}`, e);
    return method === "GET" ? [] : null;
  }
}

// check if admin
async function checkRoomPermissions() {
  const roomData = await apiCall(`/api/rooms/${roomCode}`);
  
  if (!roomData || roomData.error) {
    // clear invalid room
    localStorage.removeItem('last_room');
    alert("room not found");
    window.location.href = "/";
    return;
  }
  
  // compare ids
  if (roomData.adminId === userId) {
    console.log("admin detected");
    setAdminMode(true);
  } else {
    setAdminMode(false);
  }
}

// get tickets
async function getTickets() {
  const data = await apiCall(`/api/tickets/${roomCode}`);
  return Array.isArray(data) ? data : [];
}

// create ticket
async function createTicket(ticket) {
  ticket.roomCode = roomCode;
  return await apiCall('/api/tickets', "POST", ticket);
}

// delete ticket
async function deleteTicket(id) {
  const endpoint = `/api/tickets/${id}?userId=${userId}&admin=${isRoomAdmin}&roomCode=${roomCode}`;
  // use api_url here
  await fetch(`${API_URL}${endpoint}`, { method: "DELETE" });
}

// update ticket
async function updateTicket(id, modifications) {
  modifications.roomCode = roomCode;
  await apiCall(`/api/tickets/${id}`, "PUT", modifications);
}

// get announcement
async function fetchAnnonce() {
  const data = await apiCall(`/api/announcement/${roomCode}`);
  if (data) handleAnnonceUpdate(data);
}

// set announcement
async function updateAnnonceApi(text, color = "#cdcdcd") {
  await apiCall(`/api/announcement/${roomCode}`, "PUT", { 
    texte: text, 
    couleur: color,
    userId: userId 
  });
  currentAnnonce = text;
}

// load bad words
async function loadFilters() {
  const data = await apiCall("/assets/filter.json?cb=" + Date.now());
  filterCache = data.banned_terms || [];
}

// utils

// format time
function formatTimeElapsed(dateString) {
  if (!dateString) return '';
  const diff = new Date() - new Date(dateString);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `(${days}j)`;
  if (hours > 0) return `(${hours}h)`;
  return `(${mins}mins)`;
}

// rgb to hex
function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
  if (!match) return '#d40000'; 
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ui render

// render list
async function renderTickets(isExternalUpdate = false) {
  if (isRendering) return; 
  isRendering = true;
  const tickets = await getTickets();
  const currentIds = new Set(tickets.map(t => t.id));
  
  let newTicketId = null;
  if (isExternalUpdate) {
    for (const id of currentIds) {
      if (!lastTicketIds.has(id)) {
        newTicketId = id;
        break; 
      }
    }
  }
  lastTicketIds = currentIds;
  const listActive = tickets.filter(t => t.etat === "en cours");
  const listHistory = tickets.filter(t => t.etat !== "en cours");
  updateContainer("right", listActive, newTicketId, true);
  updateContainer("subdiv", listHistory, newTicketId, false);
  isRendering = false;
}

// update container
function updateContainer(containerId, tickets, newId, isActiveList) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const oldItems = container.querySelectorAll(isActiveList ? '.during' : '.history');
  oldItems.forEach(el => el.remove());

  const oldMsg = container.querySelector('.empty-message');
  if (oldMsg) oldMsg.remove();

  if (tickets.length === 0) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'empty-message';
      // Le texte change selon si c'est la liste active ou historique
      msgDiv.textContent = isActiveList ? "<Aucun ticket en cours>" : "<Aucun ticket terminé>";
      container.appendChild(msgDiv);
      return;
  }

  tickets.forEach(t => {
    const div = document.createElement('div');
    div.className = isActiveList ? "during" : "history";
    div.id = t.id;
    if (t.id === newId) {
      div.classList.add('add');
      setTimeout(() => div.classList.remove('add'), 600);
    }
    
    // Gestion des couleurs
    if (t.couleur?.includes('gradient')) div.style.backgroundImage = t.couleur;
    else div.style.backgroundColor = t.couleur || "#cdcdcd";
    
    const timeStr = t.dateCreation 
      ? new Date(t.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';
    
    // check delete rights
    const canDelete = isRoomAdmin || (isActiveList && t.userId === userId);
    const deleteBtn = canDelete ? `<a class="delete" data-id="${t.id}">—</a>` : "";
    
    if (isActiveList) {
      let info = `<p id="name">${t.nom}</p>`;
      if (t.description?.trim()) info += `<p id="desc">${t.description}</p>`;
      
      div.innerHTML = `
        <div class="checkbox" data-id="${t.id}"></div>
        <div class="info">${info}</div>
        <div class="time">
          <p id="created">${timeStr}</p>
          <p id="remaining">${formatTimeElapsed(t.dateCreation)}</p>
        </div>
        ${deleteBtn}
      `;
    } else {
      div.innerHTML = `
        <p class="name">${t.nom}</p>
        <div class="time">
          <p class="created">${timeStr}</p>
          <p class="etat">${t.etat}</p>
        </div>
        ${deleteBtn}
      `;
    }
    container.appendChild(div);
  });
  
  // Réattacher les événements de suppression
  container.querySelectorAll('.delete').forEach(btn => {
    btn.onclick = (e) => handleDeleteClick(e, btn.dataset.id);
  });
}

// delete with anim
async function handleDeleteClick(e, id) {
  e.stopPropagation();
  const el = e.target.closest('.during, .history');
  if (!el) return;
  el.classList.add('bounce-reverse');
  el.addEventListener('animationend', async () => {
    await deleteTicket(id);
    el.remove();
    renderTickets(); 
  }, { once: true });
}

// ticket done
document.getElementById("right").addEventListener("click", async (e) => {
  const checkbox = e.target.closest(".checkbox");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  const el = document.getElementById(id);
  
  const tickets = await getTickets();
  const ticket = tickets.find(t => t.id === id);
  
  if (!isRoomAdmin && (!ticket || ticket.userId !== userId)) {
    alert("no permission");
    return;
  }
  el.classList.add("moving");
  el.addEventListener("animationend", async () => {
    await updateTicket(id, { etat: "terminé" });
    renderTickets();
  }, { once: true });
});

// admin ui

// toggle admin ui
function setAdminMode(enable) {
  const title = document.getElementById('lefttitle');
  isRoomAdmin = enable;
  
  if (enable) {
    if (title && !title.textContent.includes('(admin mode)')) {
      title.textContent += ' (admin mode)';
    }
    setupAdminControls();
  } else {
    if (title) {
      title.textContent = title.textContent.replace(' (admin mode)', '');
    }
    const adminCheck = document.getElementById('adminAnnonce')?.parentElement;
    if (adminCheck) adminCheck.remove();
  }
  renderTickets();
}

// add admin checkbox
function setupAdminControls() {
  const infosInput = document.getElementById('infos');
  if (!infosInput || document.getElementById('adminAnnonce')) return;
  const wrapper = document.createElement('div');
  wrapper.style.margin = "5px 0";
  wrapper.innerHTML = `<label><input type="checkbox" id="adminAnnonce"/> Message d'annonce</label>`;
  infosInput.parentNode.insertBefore(wrapper, infosInput);
  const check = wrapper.querySelector('input');
  const nameInput = document.getElementById('name');
  const msgDiv = document.getElementById('message');
  const toggle = () => {
    if (check.checked) {
      nameInput.value = currentAnnonce;
      infosInput.style.display = 'none';
      msgDiv.style.display = 'block';
    } else {
      nameInput.value = '';
      infosInput.style.display = 'block';
      msgDiv.style.display = 'none';
    }
  };
  check.addEventListener('change', toggle);
}

// form submit
async function handleFormSubmit() {
  const nameInput = document.getElementById('name');
  const infosInput = document.getElementById('infos');
  const adminCheck = document.getElementById('adminAnnonce');
  const name = nameInput.value.trim();
  const description = infosInput.value.trim();
  // required name
  if (!name && !adminCheck?.checked) return alert("name required");
  // check bad words
  const content = (name + " " + description).toLowerCase();
  const forbidden = filterCache.find(term => content.includes(term.toLowerCase()));
  if (forbidden) return alert("word forbidden");
  // admin update
  if (adminCheck?.checked) {
    if (!isRoomAdmin) return alert("not authorized");
    const selectedColor = document.querySelector('.color.selected');
    let hexColor = '#d40000';
    
    if (selectedColor) {
      const bg = selectedColor.style.backgroundImage || selectedColor.style.backgroundColor;
      if (bg) hexColor = rgbToHex(bg) || bg;
    }
    
    await updateAnnonceApi(name, hexColor);
    
    nameInput.value = "";
    infosInput.value = "";
    closeAllOverlays();
    return;
  }
  // check limits
  const tickets = await getTickets();
  const myActiveTickets = tickets.filter(t => t.etat === "en cours" && t.userId === userId);
  if (myActiveTickets.length >= MAX_DURING_TICKET && !isRoomAdmin) {
    return alert("limit reached");
  }
  const selectedColor = document.querySelector('.color.selected');
  const color = selectedColor 
    ? (selectedColor.style.backgroundImage || selectedColor.style.backgroundColor) 
    : '#cdcdcd';
  // create
  await createTicket({ 
    nom: name, 
    description, 
    couleur: color, 
    etat: "en cours", 
    userId 
  });
  nameInput.value = "";
  infosInput.value = "";
  closeAllOverlays();
}

// menu functions
function openOverlay(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = "flex";
    const box = el.querySelector('.menu-box');
    if (box) {
      box.style.animation = 'none';
      box.offsetHeight; 
      box.style.animation = null;
    }
  }
}
function closeAllOverlays() {
  document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = "none");
}

// init
window.addEventListener('DOMContentLoaded', async () => {
  initFeatures();
  // check permissions first
  await checkRoomPermissions();
  
  // load data
  await loadFilters();
  await fetchAnnonce();
  renderTickets();
  connectWebSocket();
  // show room code 
  document.querySelector('#codebutton .text').textContent = roomCode;
  // events
  document.getElementById('create').addEventListener('click', (e) => {
    e.preventDefault();
    handleFormSubmit();
  });
  document.getElementById("createbutton").addEventListener('click', (e) => {
    e.preventDefault();
    const adminCheck = document.getElementById('adminAnnonce');
    if (adminCheck) adminCheck.checked = false;
    document.getElementById('infos').style.display = 'block';
    openOverlay("formOverlay");
  });
  document.getElementById("setting").addEventListener('click', (e) => {
    e.preventDefault();
    openOverlay("settingsOverlay");
  });
  document.getElementById("closeSettings")?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllOverlays();
  });
  document.querySelectorAll('.menu-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllOverlays();
    });
  });
  // logout
  document.getElementById("logout")?.addEventListener('click', (e) => {
      e.preventDefault();
      openOverlay("logoutOverlay");
  });

  document.getElementById("cancelLogout")?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllOverlays();
  });

  document.getElementById("confirmLogout")?.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('last_room');
      window.location.href = '/';
  });
});