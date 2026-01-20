const firebaseConfig = {
    apiKey: 'AIzaSyBMzTNiBfT5JOMaJvrCUoK3nKsnSP_aJxg',
    authDomain: 'droidgenai.firebaseapp.com',
    projectId: 'droidgenai',
    storageBucket: 'droidgenai.firebasestorage.app',
    messagingSenderId: '919385381226',
    appId: '1:919385381226:web:172d54c8ab332c2690ad13',
    measurementId: 'G-SMWBPGEJJK'
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account'
});

const state = {
    user: null,
    credits: 0,
    isAdmin: false,
    selectedModel: {
        id: 'xiaomi/mimo-v2-flash:free',
        name: 'MiMo 2 Flash',
        cost: 300
    },
    files: [],
    attachedFiles: [],
    versions: [],
    isGenerating: false,
    currentOutput: '',
    isLoggingIn: false
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
    authScreen: $('#auth-screen'),
    mainScreen: $('#main-screen'),
    googleLogin: $('#google-login'),
    creditsCount: $('#credits-count'),
    userAvatar: $('#user-avatar'),
    settingsBtn: $('#settings-btn'),
    settingsModal: $('#settings-modal'),
    adminModal: $('#admin-modal'),
    settingsAvatar: $('#settings-avatar'),
    settingsEmail: $('#settings-email'),
    settingsCredits: $('#settings-credits'),
    logoutBtn: $('#logout-btn'),
    changeEmailBtn: $('#change-email-btn'),
    promptInput: $('#prompt-input'),
    sendBtn: $('#send-btn'),
    modelBtn: $('#model-btn'),
    modelDropdown: $('#model-dropdown'),
    selectedModel: $('#selected-model'),
    outputContent: $('#output-content'),
    loadingIndicator: $('#loading-indicator'),
    versionsSidebar: $('#versions-sidebar'),
    versionsList: $('#versions-list'),
    toggleVersions: $('#toggle-versions'),
    closeSidebar: $('#close-sidebar'),
    filesGrid: $('#files-grid'),
    uploadBtn: $('#upload-btn'),
    fileInput: $('#file-input'),
    mentionsDropdown: $('#mentions-dropdown'),
    attachedFiles: $('#attached-files'),
    recentList: $('#recent-list'),
    toastContainer: $('#toast-container'),
    adminEmailInput: $('#admin-email-input'),
    adminCreditsInput: $('#admin-credits-input'),
    adminGiveCredits: $('#admin-give-credits'),
    adminResult: $('#admin-result')
};

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function setLoginLoading(loading) {
    state.isLoggingIn = loading;
    if (loading) {
        elements.googleLogin.innerHTML = `
            <div class="loading-spinner" style="width:20px;height:20px;border-width:2px;"></div>
            <span>Signing in...</span>
        `;
        elements.googleLogin.disabled = true;
    } else {
        elements.googleLogin.innerHTML = `
            <i class="fab fa-google"></i>
            <span>Continue with Google</span>
        `;
        elements.googleLogin.disabled = false;
    }
}

function switchScreen(screen) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function switchTab(tabName) {
    $$('.nav-tab').forEach(t => t.classList.remove('active'));
    $(`.nav-tab[data-tab="${tabName}"]`).classList.add('active');
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    $(`#${tabName}-tab`).classList.add('active');
}

async function initUser(user) {
    state.user = user;
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'init_user',
                userId: user.uid,
                email: user.email
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.credits = data.credits;
            state.isAdmin = data.isAdmin;
            state.versions = data.versions || [];
            state.files = data.files || [];
        } else {
            console.warn('Init returned:', data);
            state.credits = 100000;
        }
    } catch (error) {
        console.error('Init error:', error);
        state.credits = 100000;
        showToast('Running in offline mode', 'error');
    }
    
    updateUI();
    switchScreen(elements.mainScreen);
    showToast(`Welcome, ${user.displayName || user.email}!`);
}

function updateUI() {
    elements.creditsCount.textContent = state.credits.toLocaleString();
    
    if (state.user?.photoURL) {
        elements.userAvatar.style.backgroundImage = `url(${state.user.photoURL})`;
        elements.settingsAvatar.style.backgroundImage = `url(${state.user.photoURL})`;
    }
    
    elements.settingsEmail.textContent = state.user?.email || '';
    elements.settingsCredits.textContent = `${state.credits.toLocaleString()} credits`;
    
    renderVersions();
    renderFiles();
    renderRecent();
    
    elements.sendBtn.disabled = !elements.promptInput.value.trim() || state.isGenerating;
}

function renderVersions() {
    if (state.versions.length === 0) {
        elements.versionsList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-history" style="font-size: 32px;"></i>
                <p style="margin-top: 12px;">No versions yet</p>
            </div>
        `;
        return;
    }
    
    elements.versionsList.innerHTML = state.versions.map((v, i) => `
        <div class="version-item ${v.pinned ? 'pinned' : ''}" data-index="${i}">
            <div class="version-header">
                <span class="version-number">v${state.versions.length - i}</span>
                <div class="version-actions">
                    <button class="pin-btn" title="${v.pinned ? 'Unpin' : 'Pin as main'}">
                        <i class="fas fa-thumbtack"></i>
                    </button>
                    <button class="delete-btn" title="Delete version">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="version-preview">${v.prompt.substring(0, 50)}...</div>
            <div class="version-date">${new Date(v.createdAt).toLocaleString()}</div>
        </div>
    `).join('');
}

function renderFiles() {
    if (state.files.length === 0) {
        elements.filesGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; padding: 60px 20px;">
                <i class="fas fa-folder-open"></i>
                <p>No files uploaded yet</p>
            </div>
        `;
        return;
    }
    
    elements.filesGrid.innerHTML = state.files.map((f, i) => `
        <div class="file-card" data-index="${i}">
            <div class="file-preview">
                ${f.type.startsWith('image/') 
                    ? `<img src="${f.dataUrl}" alt="${f.name}">`
                    : `<i class="fas fa-${f.type.startsWith('audio/') ? 'music' : 'video'}"></i>`
                }
            </div>
            <div class="file-info">
                <div class="file-name">${f.name}</div>
                <div class="file-size">${formatFileSize(f.size)}</div>
            </div>
        </div>
    `).join('');
}

function renderRecent() {
    const recent = state.versions.slice(0, 5);
    
    if (recent.length === 0) {
        elements.recentList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-clock"></i>
                <p>No recent generations</p>
            </div>
        `;
        return;
    }
    
    elements.recentList.innerHTML = recent.map((v, i) => `
        <div class="recent-item" data-index="${i}">
            <div class="icon">
                <i class="fas fa-wand-magic-sparkles"></i>
            </div>
            <div class="info">
                <div class="title">${v.prompt.substring(0, 40)}...</div>
                <div class="date">${new Date(v.createdAt).toLocaleString()}</div>
            </div>
        </div>
    `).join('');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showMentionsDropdown() {
    if (state.files.length === 0) {
        elements.mentionsDropdown.innerHTML = `
            <div style="padding: 16px; text-align: center; color: var(--text-muted);">
                No files to mention
            </div>
        `;
    } else {
        elements.mentionsDropdown.innerHTML = state.files.map((f, i) => `
            <div class="mention-item" data-index="${i}">
                <div class="icon">
                    <i class="fas fa-${f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'music' : 'video'}"></i>
                </div>
                <span class="name">${f.name}</span>
            </div>
        `).join('');
    }
    
    elements.mentionsDropdown.classList.add('open');
}

function hideMentionsDropdown() {
    elements.mentionsDropdown.classList.remove('open');
}

function attachFile(file) {
    if (state.attachedFiles.find(f => f.name === file.name)) return;
    
    state.attachedFiles.push(file);
    renderAttachedFiles();
}

function renderAttachedFiles() {
    elements.attachedFiles.innerHTML = state.attachedFiles.map((f, i) => `
        <div class="attached-file">
            <i class="fas fa-${f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'music' : 'video'}"></i>
            <span>${f.name}</span>
            <button class="remove" data-index="${i}">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

async function handleGenerate() {
    if (state.isGenerating) {
        showToast('Please wait for current generation to complete', 'error');
        return;
    }
    
    const prompt = elements.promptInput.value.trim();
    if (!prompt) return;
    
    if (state.credits < state.selectedModel.cost) {
        showToast('Insufficient credits', 'error');
        return;
    }
    
    state.isGenerating = true;
    elements.loadingIndicator.classList.add('active');
    elements.sendBtn.disabled = true;
    switchTab('workspace');
    
    elements.outputContent.innerHTML = `
        <div class="generating-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div class="loading-spinner"></div>
            <p style="margin-top:16px;color:var(--text-secondary);">Generating with ${state.selectedModel.name}...</p>
        </div>
    `;
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'generate',
                userId: state.user.uid,
                prompt: prompt,
                model: state.selectedModel.id,
                cost: state.selectedModel.cost,
                files: state.attachedFiles.map(f => ({
                    name: f.name,
                    type: f.type,
                    dataUrl: f.dataUrl
                }))
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }
        
        if (data.success) {
            state.credits = data.credits;
            state.currentOutput = data.output;
            
            const newVersion = {
                id: Date.now().toString(),
                prompt: prompt,
                output: data.output,
                model: state.selectedModel.name,
                createdAt: new Date().toISOString(),
                pinned: false
            };
            
            state.versions.unshift(newVersion);
            
            renderOutput(data.output);
            updateUI();
            showToast('Generation complete!');
            
            elements.promptInput.value = '';
            state.attachedFiles = [];
            renderAttachedFiles();
        } else {
            throw new Error(data.error || 'Generation failed');
        }
    } catch (error) {
        console.error('Generation error:', error);
        showToast(error.message, 'error');
        elements.outputContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i>
                <p>${error.message}</p>
            </div>
        `;
    } finally {
        state.isGenerating = false;
        elements.loadingIndicator.classList.remove('active');
        elements.sendBtn.disabled = false;
    }
}

function renderOutput(content) {
    const formatted = content
        .replace(/
