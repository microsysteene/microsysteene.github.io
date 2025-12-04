
'use strict';

/* ==========================================================================
   1. CONFIGURATION & CONSTANTS
   ========================================================================== */
const CONFIG = {
    API_URL: "https://ticketapi.juhdd.me",
    WS_URL: "wss://ticketapi.juhdd.me",
    MAX_FILES: 10,
    MAX_STORAGE_BYTES: 1.5 * 1024 * 1024 * 1024, // 1.5 Go
    ANIMATION_DELAY: 600,
    RETRY_DELAY: 3000
};

/* ==========================================================================
   2. UTILITIES (Helpers)
   ========================================================================== */
const Utils = {
    formatBytes: (bytes) => {
        if (bytes === 0) return '0.00 Go';
        const sizes = ['o', 'Ko', 'Mo', 'Go', 'To'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i < 3) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    },

    formatTimeElapsed: (dateString) => {
        if (!dateString) return '';
        const diff = Date.now() - new Date(dateString).getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (days > 0) return `(${days}j)`;
        if (hours > 0) return `(${hours}h)`;
        return `(${mins}mins)`;
    },

    rgbToHex: (rgbStr) => {
        const match = rgbStr.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);
        if (!match) return '#d40000';
        return "#" + ((1 << 24) + (+match[1] << 16) + (+match[2] << 8) + (+match[3])).toString(16).slice(1);
    },

    getColorFromElement: (el) => {
        if (!el) return '#cdcdcd';
        return el.style.backgroundImage || el.style.backgroundColor || '#cdcdcd';
    }
};

/* ==========================================================================
   3. SERVICES (Crypto, API, Socket)
   ========================================================================== */
const CryptoService = {
    key: null,

    async init(roomCode) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", enc.encode(roomCode), "PBKDF2", false, ["deriveKey"]
        );
        this.key = await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: enc.encode("ticket-static-salt"), iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
        );
        console.log('🔒 Crypto key ready');
    },

    async encrypt(file) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const buffer = await file.arrayBuffer();
        const encryptedContent = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv }, this.key, buffer
        );
        return new Blob([iv, encryptedContent], { type: 'application/octet-stream' });
    },

    async decrypt(blob) {
        const buffer = await blob.arrayBuffer();
        const iv = buffer.slice(0, 12);
        const data = buffer.slice(12);
        const decryptedContent = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv }, this.key, data
        );
        return new Blob([decryptedContent]);
    }
};

const ApiService = {
    async call(endpoint, method = "GET", body = null) {
        try {
            const options = {
                method,
                headers: { "Content-Type": "application/json" }
            };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch(`${CONFIG.API_URL}${endpoint}`, options);
            if (method === "DELETE") return res.ok;
            return await res.json();
        } catch (e) {
            console.error(`API Error ${method} ${endpoint}:`, e);
            return method === "GET" ? [] : null;
        }
    },

    async download(fileId) {
        const res = await fetch(`${CONFIG.API_URL}/api/files/download/${fileId}`);
        if (!res.ok) throw new Error('Download failed');
        return await res.blob();
    }
};

/* ==========================================================================
   4. UI MANAGER (DOM & Animations)
   ========================================================================== */
const UIManager = {
    elements: {},
    dotInterval: null,

    init() {
        // Cache DOM elements
        const ids = [
            'copyLink', 'copyText', 'codebutton', 'storageText', 'fileCountText',
            'storageProgressBar', 'announcementContainer', 'announcementArea',
            'adminFilesList', 'right', 'subdiv', 'create', 'createbutton',
            'formOverlay', 'settingsOverlay', 'logoutOverlay', 'name', 'infos',
            'fileUploadContainer', 'adminSettingsSection', 'dropArea', 'fileInput'
        ];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
    },

    // --- Animations Dots ---
    startDots(idx) {
        if (this.dotInterval) clearInterval(this.dotInterval);
        const txt = document.getElementById(`prog-txt-${idx}`);
        if (!txt) return;
        const states = ['traitement.', 'traitement..', 'traitement...'];
        let i = 0;
        txt.textContent = states[0];
        txt.style.fontSize = '0.8em';
        this.dotInterval = setInterval(() => {
            i = (i + 1) % states.length;
            txt.textContent = states[i];
        }, 500);
    },

    stopDots() {
        if (this.dotInterval) {
            clearInterval(this.dotInterval);
            this.dotInterval = null;
        }
    },

    // --- Copy Feedback ---
    showCopyFeedback(element, originalText, successText = "Copié !") {
        element.textContent = successText;
        setTimeout(() => element.textContent = originalText, 2000);
    },

    // --- Overlays ---
    toggleOverlay(id, show) {
        const el = this.elements[id] || document.getElementById(id);
        if (el) el.style.display = show ? "flex" : "none";
    },

    closeAllOverlays() {
        document.querySelectorAll('.menu-overlay').forEach(el => el.style.display = "none");
    },

    // --- Rendering Helpers ---
    createTag(tag, className, content = '', style = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (content) el.innerHTML = content;
        Object.assign(el.style, style);
        return el;
    }
};

/* ==========================================================================
   5. MAIN APPLICATION LOGIC
   ========================================================================== */
class RoomApp {
    constructor() {
        this.state = {
            roomCode: new URLSearchParams(window.location.search).get('room'),
            userId: localStorage.getItem('userId') || crypto.randomUUID(),
            isAdmin: false,
            isSending: false,
            maxTickets: 1,
            tickets: [],
            lastTicketIds: new Set(),
            announcements: [],
            pendingFiles: [],
            filterList: [],
            currentXhr: null
        };

        if (!this.state.roomCode) {
            window.location.href = "/";
            return;
        }

        localStorage.setItem('userId', this.state.userId);
        localStorage.setItem('last_room', this.state.roomCode);

        this.init();
    }

    async init() {
        UIManager.init();
        await this.loadResources();
        this.setupEventListeners();
        this.setupWebSocket();
        document.body.classList.add('loaded');
        
        // Initial Render
        const codeSpan = document.querySelector('#codebutton .text');
        if (codeSpan) codeSpan.textContent = this.state.roomCode;
    }

    async loadResources() {
        await CryptoService.init(this.state.roomCode);
        await this.checkPermissions();
        
        // Load filters
        try {
            const res = await fetch(`./assets/filter.json?cb=${Date.now()}`);
            const data = await res.json();
            this.state.filterList = data.banned_terms || [];
        } catch (e) { console.error("Filter load error", e); }

        await this.syncAnnouncements();
        await this.renderTickets();
    }

    /* --- Permissions & Admin Mode --- */
    async checkPermissions() {
        const data = await ApiService.call(`/api/rooms/${this.state.roomCode}`);
        if (!data || data.error) {
            alert("Salle introuvable.");
            window.location.href = "/";
            return;
        }

        if (data.maxTickets) {
            this.state.maxTickets = data.maxTickets;
            const radio = document.querySelector(`input[name="SliderCount"][value="${data.maxTickets}"]`);
            if (radio) radio.checked = true;
        }

        this.setAdminMode(data.adminId === this.state.userId);
    }

    setAdminMode(isAdmin) {
        this.state.isAdmin = isAdmin;
        const { createbutton, name, infos, formOverlay, fileUploadContainer, adminSettingsSection } = UIManager.elements;

        if (adminSettingsSection) adminSettingsSection.style.display = isAdmin ? 'block' : 'none';
        if (fileUploadContainer) fileUploadContainer.style.display = isAdmin ? 'flex' : 'none';

        const title = formOverlay.querySelector('h1');
        const btnText = createbutton.querySelector('.text');

        if (isAdmin) {
            if (btnText) btnText.textContent = "Nouveau message";
            if (name) { name.placeholder = "Message"; name.value = ""; }
            if (infos) infos.style.display = 'none';
            if (title) title.textContent = "Nouveau message";
            this.state.pendingFiles = [];
            this.renderPendingFiles();
        } else {
            if (btnText) btnText.textContent = "Nouveau ticket";
            if (name) { name.placeholder = "Nom"; name.value = ""; }
            if (infos) infos.style.display = 'block';
            if (title) title.textContent = "Nouveau ticket";
        }
        
        this.syncAnnouncements(); // Update delete buttons
        this.renderTickets(); // Update delete buttons
    }

    /* --- Tickets Logic --- */
    async renderTickets(externalUpdate = false) {
        const tickets = await ApiService.call(`/api/tickets/${this.state.roomCode}`);
        this.state.tickets = Array.isArray(tickets) ? tickets : [];
        
        const currentIds = new Set(this.state.tickets.map(t => t.id));
        let newId = null;

        // Detect new ticket for animation
        if (externalUpdate) {
            for (const id of currentIds) {
                if (!this.state.lastTicketIds.has(id)) {
                    newId = id;
                    break;
                }
            }
        }
        this.state.lastTicketIds = currentIds;

        const active = this.state.tickets.filter(t => t.etat === "en cours");
        const history = this.state.tickets.filter(t => t.etat !== "en cours");

        this.updateTicketContainer('right', active, newId, true);
        this.updateTicketContainer('subdiv', history, newId, false);
    }

    updateTicketContainer(containerId, list, newId, isActive) {
        const container = UIManager.elements[containerId];
        if (!container) return;

        // Clean existing
        container.querySelectorAll(isActive ? '.during' : '.history').forEach(el => el.remove());
        container.querySelector('.empty-message')?.remove();

        if (list.length === 0) {
            const msg = UIManager.createTag('div', 'empty-message', isActive ? "<Aucun ticket en cours>" : "<Aucun ticket terminé>");
            container.appendChild(msg);
            return;
        }

        list.forEach(t => {
            const div = UIManager.createTag('div', isActive ? "during" : "history");
            div.id = t.id;
            
            // Background
            if (t.couleur?.includes('gradient')) div.style.backgroundImage = t.couleur;
            else div.style.backgroundColor = t.couleur || "#cdcdcd";

            // Animation Class
            if (t.id === newId) {
                div.classList.add('add');
                setTimeout(() => div.classList.remove('add'), CONFIG.ANIMATION_DELAY);
            }

            const timeStr = t.dateCreation ? new Date(t.dateCreation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const canDelete = this.state.isAdmin || (isActive && t.userId === this.state.userId);
            const deleteBtn = canDelete ? `<a class="delete" data-id="${t.id}">—</a>` : "";

            if (isActive) {
                let info = `<p id="name">${t.nom}</p>`;
                if (t.description?.trim()) info += `<p id="desc">${t.description}</p>`;
                div.innerHTML = `
                    <div class="checkbox" data-id="${t.id}"></div>
                    <div class="info">${info}</div>
                    <div class="time"><p id="created">${timeStr}</p><p id="remaining">${Utils.formatTimeElapsed(t.dateCreation)}</p></div>
                    ${deleteBtn}
                `;
            } else {
                div.innerHTML = `
                    <p class="name">${t.nom}</p>
                    <div class="time"><p class="created">${timeStr}</p><p class="etat">${t.etat}</p></div>
                    ${deleteBtn}
                `;
            }
            
            // Delete Event
            const btn = div.querySelector('.delete');
            if (btn) btn.onclick = (e) => this.handleTicketDelete(e, t.id);

            container.appendChild(div);
        });
    }

    async handleTicketDelete(e, id) {
        e.stopPropagation();
        const el = e.target.closest('.during, .history');
        if (!el) return;
        
        el.classList.add('bounce-reverse');
        el.addEventListener('animationend', async () => {
            await fetch(`${CONFIG.API_URL}/api/tickets/${id}?userId=${this.state.userId}&admin=${this.state.isAdmin}&roomCode=${this.state.roomCode}`, { method: "DELETE" });
            el.remove();
            this.renderTickets();
        }, { once: true });
    }

    /* --- Announcements & Files Logic --- */
    async syncAnnouncements() {
        const data = await ApiService.call(`/api/announcements/${this.state.roomCode}`);
        if (Array.isArray(data)) {
            this.state.announcements = data;
            this.updateStorageUI();
            this.renderAnnouncements();
        }
    }

    updateStorageUI() {
        let totalBytes = 0;
        let totalFiles = 0;
        
        this.state.announcements.forEach(a => {
            if (a.files) {
                totalFiles += a.files.length;
                a.files.forEach(f => totalBytes += f.size);
            }
        });

        const { storageText, fileCountText, storageProgressBar, announcementContainer } = UIManager.elements;
        if (storageText) storageText.textContent = Utils.formatBytes(totalBytes) + ' / 1.5 Go';
        if (fileCountText) fileCountText.textContent = `${totalFiles} fichier${totalFiles > 1 ? 's' : ''} partagé${totalFiles > 1 ? 's' : ''}`;
        
        let pct = (totalBytes / CONFIG.MAX_STORAGE_BYTES) * 100;
        if (pct < 5 && totalBytes > 0) pct = 5;
        if (pct > 100) pct = 100;
        if (storageProgressBar) storageProgressBar.style.width = `${pct}%`;

        // CSS Classes logic
        if (announcementContainer) {
            if (this.state.announcements.length === 0) announcementContainer.classList.add('is-empty');
            else announcementContainer.classList.remove('is-empty');
        }
    }

    renderAnnouncements() {
        const container = UIManager.elements.announcementArea;
        const leftContainer = document.querySelector('.left-container');
        if (!container) return;

        container.innerHTML = '';
        container.classList.remove('hidden');

        if (leftContainer) leftContainer.style.gap = this.state.announcements.length === 0 ? '0px' : '';

        this.state.announcements.forEach((annonce, index) => {
            const wrapper = UIManager.createTag('div', 'announcement-wrapper');
            wrapper.style.setProperty('--i', index);

            const bg = annonce.color || '#cdcdcd';
            const style = { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' };
            if (bg.includes('gradient')) style.backgroundImage = bg;
            else style.backgroundColor = bg;

            const msgDiv = UIManager.createTag('div', 'announcement-item', '', style);
            
            // Text Content
            if (annonce.content?.trim()) {
                const deleteBtn = this.state.isAdmin ? 
                    `<button class="announcement-delete" title="Supprimer"><img src="./assets/icon/delete.png" alt="X"></button>` : '';
                
                const textRow = UIManager.createTag('div', '', `
                    <div class="announcement-content" style="width:100%;"><span class="announcement-text">${annonce.content}</span></div>
                    <div class="announcement-actions">${deleteBtn}</div>
                `, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' });

                if (this.state.isAdmin) {
                    textRow.querySelector('.announcement-delete').addEventListener('click', (e) => this.deleteItem(e, `/api/announcements/${annonce.id}`, wrapper));
                }
                msgDiv.appendChild(textRow);
            }

            // Files Content
            if (annonce.files?.length > 0) {
                const fileContainer = UIManager.createTag('div', '', '', { display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' });
                annonce.files.forEach(file => {
                    this.renderFileItem(file, annonce.id, fileContainer);
                });
                msgDiv.appendChild(fileContainer);
            }

            wrapper.appendChild(msgDiv);
            container.appendChild(wrapper);
        });
    }

    renderFileItem(file, announcementId, container) {
        const fName = file.originalName || file.name;
        const ext = fName.split('.').pop().toUpperCase();
        const size = (file.size / 1024 / 1024).toFixed(1);

        const row = UIManager.createTag('div', '', '', {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderRadius: '4px', fontSize: '0.85em'
        });

        const left = UIManager.createTag('div', '', `
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;" title="${fName}">${fName}</span>
            <span style="opacity:0.7; font-size:0.9em;">(${ext} • ${size} Mo)</span>
        `, { display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' });

        const actions = UIManager.createTag('div', '', '', { display: 'flex', alignItems: 'center', gap: '8px' });
        
        // Download Btn
        const dlBtn = UIManager.createTag('button', 'announcement-action-btn', `<img src="./assets/icon/download.png" style="width:18px; height:18px;">`);
        dlBtn.onclick = (e) => { e.preventDefault(); this.handleFileDownload(file.id, fName); };
        actions.appendChild(dlBtn);

        // Delete Btn (Admin)
        if (this.state.isAdmin) {
            const delBtn = UIManager.createTag('button', 'announcement-action-btn', `<img src="./assets/icon/delete.png" style="width:18px; height:18px;">`);
            delBtn.style.borderColor = '#000000';
            delBtn.onclick = (e) => this.deleteItem(e, `/api/announcements/${announcementId}/files/${file.id}`, row);
            actions.appendChild(delBtn);
        }

        row.appendChild(left);
        row.appendChild(actions);
        container.appendChild(row);
    }

    async deleteItem(e, endpoint, domElement) {
        e.preventDefault();
        if (!confirm("Supprimer ?")) return;
        domElement.style.opacity = '0.5';
        try {
            const success = await ApiService.call(`${endpoint}?userId=${this.state.userId}`, "DELETE");
            if (success) {
                domElement.remove();
                await this.syncAnnouncements();
            } else {
                throw new Error("Delete failed");
            }
        } catch (err) {
            console.error(err);
            alert("Erreur suppression.");
            domElement.style.opacity = '1';
        }
    }

    async handleFileDownload(fileId, fileName) {
        try {
            const blobEnc = await ApiService.download(fileId);
            const blobClear = await CryptoService.decrypt(blobEnc);
            const url = URL.createObjectURL(blobClear);
            const a = document.createElement('a');
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Download error", e);
            alert("Erreur lors du téléchargement.");
        }
    }

    /* --- Form Submission & Upload --- */
    renderPendingFiles() {
        const listDiv = UIManager.elements.adminFilesList;
        if (!listDiv) return;
        listDiv.innerHTML = '';

        this.state.pendingFiles.forEach((file, index) => {
            const fileSize = (file.size / (1024 * 1024)).toFixed(1);
            const item = UIManager.createTag('div', 'admin-file-item', `
                <div class="file-progress-bar" id="prog-bar-${index}"></div>
                <div class="admin-file-info">
                    <span class="admin-file-name">${file.name}</span>
                    <span class="admin-file-size">${fileSize} Mo</span>
                    <span class="file-progress-pct" id="prog-txt-${index}"></span>
                </div>
                <button class="admin-file-delete" data-idx="${index}" title="Retirer">×</button>
            `);
            
            item.querySelector('.admin-file-delete').addEventListener('click', (e) => {
                e.preventDefault();
                if (this.state.isSending) return alert("Upload en cours...");
                this.state.pendingFiles.splice(index, 1);
                this.renderPendingFiles();
            });
            listDiv.appendChild(item);
        });
    }

    async handleFormSubmit() {
        if (this.state.isSending) return;

        const nameInput = UIManager.elements.name;
        const infosInput = UIManager.elements.infos;
        const name = nameInput.value.trim();
        const description = infosInput.value.trim();

        // Security Filter
        if (this.state.filterList.some(term => (name + " " + description).toLowerCase().includes(term.toLowerCase()))) {
            return alert("Mot interdit détecté.");
        }

        const selectedColorEl = document.querySelector('.color.selected');
        const color = selectedColorEl ? Utils.getColorFromElement(selectedColorEl) : '#cdcdcd';

        // --- ADMIN SUBMIT ---
        if (this.state.isAdmin) {
            if (!name && this.state.pendingFiles.length === 0) return alert("Message ou fichier requis.");
            await this.processAdminUpload(name, color);
            return;
        }

        // --- USER SUBMIT ---
        const activeTickets = this.state.tickets.filter(t => t.etat === "en cours" && t.userId === this.state.userId);
        if (activeTickets.length >= this.state.maxTickets) return alert("Limite atteinte.");
        if (!name) return alert("Nom requis.");

        await ApiService.call('/api/tickets', "POST", {
            nom: name, description, couleur: color, etat: "en cours", userId: this.state.userId, roomCode: this.state.roomCode
        });

        nameInput.value = "";
        infosInput.value = "";
        UIManager.closeAllOverlays();
    }

    async processAdminUpload(content, color) {
        this.state.isSending = true;
        const createBtn = UIManager.elements.create;
        if (createBtn) createBtn.classList.add('button-disabled');

        try {
            const formData = new FormData();
            formData.append('roomCode', this.state.roomCode);
            formData.append('userId', this.state.userId);
            formData.append('content', content);
            formData.append('color', color.includes('gradient') ? Utils.rgbToHex(color) || color : color);

            // Encryption
            const encryptedList = [];
            if (this.state.pendingFiles.length > 0) {
                this.state.pendingFiles.forEach((_, i) => {
                    const txt = document.getElementById(`prog-txt-${i}`);
                    if (txt) txt.textContent = "Crypto...";
                });

                for (const file of this.state.pendingFiles) {
                    const encBlob = await CryptoService.encrypt(file);
                    encryptedList.push(encBlob);
                    formData.append('files', encBlob, file.name);
                }
            }

            // XHR Upload
            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                this.state.currentXhr = xhr;
                xhr.open('POST', `${CONFIG.API_URL}/api/announcements`, true);
                UIManager.stopDots();

                xhr.upload.onprogress = (e) => {
                    if (!e.lengthComputable) return;
                    let remaining = e.loaded;
                    encryptedList.forEach((blob, idx) => {
                        const bar = document.getElementById(`prog-bar-${idx}`);
                        const txt = document.getElementById(`prog-txt-${idx}`);
                        const size = blob.size;
                        let pct = 0;

                        if (remaining >= size) { pct = 100; remaining -= size; }
                        else if (remaining > 0) { pct = Math.round((remaining / size) * 100); remaining = 0; }

                        if (bar) bar.style.width = `${pct}%`;
                        if (txt) {
                            if (pct === 100) {
                                if (idx === encryptedList.length - 1) UIManager.startDots(idx);
                                else { txt.textContent = 'terminé'; txt.style.fontSize = ''; }
                            } else txt.textContent = `${pct}%`;
                        }
                    });
                };

                xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error("Upload failed"));
                xhr.onerror = () => reject(new Error("Network error"));
                xhr.onabort = () => reject(new Error("Aborted"));
                xhr.send(formData);
            });

            // Cleanup
            await new Promise(r => setTimeout(r, 1200)); // Finish animation
            UIManager.stopDots();
            UIManager.closeAllOverlays();
            UIManager.elements.name.value = "";
            this.state.pendingFiles = [];
            this.renderPendingFiles();
            await this.syncAnnouncements();

        } catch (e) {
            if (e.message !== "Aborted") {
                console.error(e);
                alert("Erreur: " + e.message);
                this.renderPendingFiles(); // Reset UI
            }
        } finally {
            this.state.isSending = false;
            this.state.currentXhr = null;
            if (createBtn) createBtn.classList.remove('button-disabled');
        }
    }

    /* --- WebSockets --- */
    setupWebSocket() {
        this.ws = new WebSocket(`${CONFIG.WS_URL}?room=${this.state.roomCode}`);
        this.ws.onopen = () => console.log('WS connected', this.state.roomCode);
        this.ws.onmessage = (event) => {
            if (event.data === 'ping') return this.ws.send('pong');
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'update') {
                    this.renderTickets(true);
                    this.checkPermissions();
                }
                if (msg.type === 'updateAnnonce') this.syncAnnouncements();
            } catch (e) { console.error('WS parse error', e); }
        };
        this.ws.onclose = () => setTimeout(() => this.setupWebSocket(), CONFIG.RETRY_DELAY);
    }

    /* --- Event Listeners --- */
    setupEventListeners() {
        const els = UIManager.elements;

        // Overlay Triggers
        if (els.createbutton) els.createbutton.onclick = (e) => { e.preventDefault(); UIManager.toggleOverlay("formOverlay", true); };
        if (els.create) els.create.onclick = (e) => { e.preventDefault(); this.handleFormSubmit(); };
        
        // Settings
        const settingBtn = document.getElementById("setting");
        if (settingBtn) settingBtn.onclick = (e) => {
            e.preventDefault();
            UIManager.toggleOverlay("settingsOverlay", true);
            const radio = document.querySelector(`input[name="SliderCount"][value="${this.state.maxTickets}"]`);
            if (radio) radio.checked = true;
        };
        document.getElementById("closeSettings")?.addEventListener('click', (e) => { e.preventDefault(); UIManager.closeAllOverlays(); });

        // Storage Widget Hover
        const stContainer = els.announcementContainer;
        if (stContainer) {
            stContainer.onmouseenter = () => { if (this.state.announcements.length > 0) stContainer.classList.add('open'); };
            stContainer.onmouseleave = () => stContainer.classList.remove('open');
        }

        // Copy Links
        if (els.copyLink) els.copyLink.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(window.location.href)
                .then(() => UIManager.showCopyFeedback(document.getElementById('copyText'), document.getElementById('copyText').textContent))
                .catch(() => alert("Erreur copie"));
        };
        if (els.codebutton) els.codebutton.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(this.state.roomCode)
                .then(() => UIManager.showCopyFeedback(els.codebutton.querySelector('.text'), els.codebutton.querySelector('.text').textContent, "Copié"));
        };

        // Ticket Actions (Delegation for Move)
        document.getElementById("right")?.addEventListener("click", async (e) => {
            const checkbox = e.target.closest(".checkbox");
            if (!checkbox) return;
            if (!this.state.isAdmin) return alert("Permission refusée.");
            
            const id = checkbox.dataset.id;
            const el = document.getElementById(id);
            el.classList.add("moving");
            el.addEventListener("animationend", async () => {
                await ApiService.call(`/api/tickets/${id}`, "PUT", { etat: "terminé", roomCode: this.state.roomCode });
                this.renderTickets();
            }, { once: true });
        });

        // Safe Close
        document.querySelectorAll('.menu-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target !== overlay) return;
                if (overlay.id === 'formOverlay' && (this.state.isSending || this.state.pendingFiles.length > 0)) {
                    if (this.state.isSending) {
                        if (confirm("Annuler l'envoi ?")) { this.state.currentXhr?.abort(); }
                        else return;
                    } else {
                        if (confirm("Fermer et perdre les fichiers ?")) { this.state.pendingFiles = []; this.renderPendingFiles(); }
                        else return;
                    }
                }
                UIManager.closeAllOverlays();
            });
        });

        // Logout
        document.getElementById("logout")?.addEventListener('click', (e) => { e.preventDefault(); UIManager.toggleOverlay("logoutOverlay", true); });
        document.getElementById("cancelLogout")?.addEventListener('click', (e) => { e.preventDefault(); UIManager.closeAllOverlays(); });
        document.getElementById("confirmLogout")?.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('last_room');
            window.location.href = '/';
        });

        // Max Tickets Slider
        document.querySelectorAll('input[name="SliderCount"]').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                const val = parseInt(e.target.value);
                this.state.maxTickets = val;
                if (this.state.isAdmin) await ApiService.call(`/api/rooms/${this.state.roomCode}`, "PUT", { maxTickets: val });
            });
        });

        // Drag & Drop
        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        const { dropArea, fileInput } = UIManager.elements;
        if (!dropArea || !fileInput) return;

        dropArea.onclick = () => {
            if (this.state.pendingFiles.length >= CONFIG.MAX_FILES) return alert("Limite atteinte.");
            fileInput.click();
        };

        fileInput.onchange = () => {
            const files = Array.from(fileInput.files);
            if (!files.length) return;
            this.addFiles(files);
            fileInput.value = '';
        };

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropArea.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        });

        dropArea.addEventListener('dragenter', () => dropArea.classList.add('drag-over'));
        dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
        dropArea.addEventListener('drop', (e) => {
            dropArea.classList.remove('drag-over');
            this.addFiles(Array.from(e.dataTransfer.files));
        });
    }

    addFiles(files) {
        if (this.state.pendingFiles.length + files.length > CONFIG.MAX_FILES) {
            return alert(`Trop de fichiers (max ${CONFIG.MAX_FILES}).`);
        }
        this.state.pendingFiles = [...this.state.pendingFiles, ...files];
        this.renderPendingFiles();
    }
}

// Start App
window.addEventListener('DOMContentLoaded', () => new RoomApp());