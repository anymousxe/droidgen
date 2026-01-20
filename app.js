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
    settingsAvatar: $('#settings-avatar'),
    settingsEmail: $('#settings-email'),
    settingsCredits: $('#settings-credits'),
    logoutBtn: $('#logout-btn'),
    promptInput: $('#prompt-input'),
    generateBtn: $('#generate-btn'),
    modelSelector: $('#model-selector'),
    modelDropdown: $('#model-dropdown'),
    currentModel: $('#current-model'),
    loadingOverlay: $('#loading-overlay'),
    versionList: $('#version-list'),
    fileList: $('#file-list'),
    toastContainer: $('#toast-container'),
    dropdownName: $('#dropdown-name'),
    dropdownEmail: $('#dropdown-email'),
    settingsEmailDisplay: $('#settings-email-display'),
    settingsCreditsDisplay: $('#settings-credits-display'),
    settingsUsername: $('#settings-username'),
    saveSettings: $('#save-settings')
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

function switchView(viewName) {
    $$('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });
    $$('.view').forEach(view => {
        view.classList.toggle('active', view.id === `${viewName}-view`);
    });
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
    
    elements.dropdownName.textContent = state.user?.displayName || state.user?.email?.split('@')[0] || 'User';
    elements.dropdownEmail.textContent = state.user?.email || '';
    elements.settingsEmailDisplay.textContent = state.user?.email || '';
    elements.settingsCreditsDisplay.textContent = `${state.credits.toLocaleString()} credits`;
    
    renderVersions();
    renderFiles();
    
    elements.generateBtn.disabled = !elements.promptInput.value.trim() || state.isGenerating;
}

function renderVersions() {
    if (state.versions.length === 0) {
        elements.versionList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-history" style="font-size: 32px;"></i>
                <p style="margin-top: 12px;">No versions yet</p>
            </div>
        `;
        return;
    }
    
    elements.versionList.innerHTML = state.versions.map((v, i) => `
        <div class="version-item" data-index="${i}">
            <div class="v-num">v${state.versions.length - i}</div>
            <div class="v-time">${new Date(v.createdAt).toLocaleString()}</div>
        </div>
    `).join('');
}

function renderFiles() {
    if (state.files.length === 0) {
        elements.fileList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fas fa-folder-open"></i>
                <p>No files yet</p>
            </div>
        `;
        return;
    }
    
    elements.fileList.innerHTML = state.files.map((f, i) => `
        <div class="file-item" data-index="${i}">
            <i class="fas fa-file-code"></i>
            <span class="fname">${f.name}</span>
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
    elements.loadingOverlay.classList.add('active');
    elements.generateBtn.disabled = true;
    
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
            
            if (data.files && data.files.length > 0) {
                state.files = data.files;
            }
            
            updateUI();
            showToast('Generation complete!');
            
            elements.promptInput.value = '';
            state.attachedFiles = [];
            
            switchView('editor');
        } else {
            throw new Error(data.error || 'Generation failed');
        }
    } catch (error) {
        console.error('Generation error:', error);
        showToast(error.message, 'error');
    } finally {
        state.isGenerating = false;
        elements.loadingOverlay.classList.remove('active');
        elements.generateBtn.disabled = false;
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
        state.user = null;
        state.credits = 0;
        state.versions = [];
        state.files = [];
        switchScreen(elements.authScreen);
        showToast('Logged out successfully');
    } catch (error) {
        showToast('Logout failed', 'error');
    }
}

async function handleGoogleLogin() {
    if (state.isLoggingIn) return;
    
    setLoginLoading(true);
    
    try {
        const result = await auth.signInWithPopup(googleProvider);
        if (result.user) {
            await initUser(result.user);
        }
    } catch (error) {
        console.error('Login error:', error);
        if (error.code === 'auth/popup-closed-by-user') {
            showToast('Login cancelled', 'error');
        } else if (error.code === 'auth/popup-blocked') {
            showToast('Popup blocked - please allow popups', 'error');
        } else {
            showToast(error.message || 'Login failed', 'error');
        }
    } finally {
        setLoginLoading(false);
    }
}

function initEventListeners() {
    elements.googleLogin.addEventListener('click', handleGoogleLogin);
    
    elements.logoutBtn.addEventListener('click', handleLogout);
    
    elements.settingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.add('open');
    });
    
    $$('.modal-close, .modal-backdrop').forEach(el => {
        el.addEventListener('click', () => {
            $$('.modal').forEach(m => m.classList.remove('open'));
        });
    });
    
    elements.promptInput.addEventListener('input', () => {
        elements.generateBtn.disabled = !elements.promptInput.value.trim() || state.isGenerating;
    });
    
    elements.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    });
    
    elements.generateBtn.addEventListener('click', handleGenerate);
    
    elements.modelSelector.addEventListener('click', () => {
        elements.modelDropdown.classList.toggle('open');
    });
    
    $$('.model-option').forEach(opt => {
        opt.addEventListener('click', () => {
            if (opt.classList.contains('disabled')) return;
            
            const modelId = opt.dataset.model;
            const modelName = opt.querySelector('.name').textContent;
            const modelCost = parseInt(opt.dataset.cost);
            
            state.selectedModel = { id: modelId, name: modelName, cost: modelCost };
            elements.currentModel.textContent = modelName;
            
            $$('.model-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            elements.modelDropdown.classList.remove('open');
        });
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.prompt-model')) {
            elements.modelDropdown.classList.remove('open');
        }
        if (!e.target.closest('.user-menu')) {
            $('#user-menu')?.classList.remove('open');
        }
    });
    
    $('#user-avatar').addEventListener('click', () => {
        $('#user-menu').classList.toggle('open');
    });
    
    $$('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            switchView(item.dataset.view);
        });
    });
    
    elements.saveSettings.addEventListener('click', async () => {
        const username = elements.settingsUsername.value.trim();
        if (!username) {
            showToast('Username is required', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_username',
                    userId: state.user.uid,
                    username: username
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showToast('Settings saved!');
                elements.settingsModal.classList.remove('open');
            } else {
                showToast(data.error || 'Failed to save settings', 'error');
            }
        } catch (error) {
            showToast('Failed to save settings', 'error');
        }
    });
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        await initUser(user);
    } else {
        switchScreen(elements.authScreen);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
});
