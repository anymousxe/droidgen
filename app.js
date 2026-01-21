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

const state = {
    user: null,
    credits: 0,
    username: '',
    projects: [],
    selectedModel: { id: 'xiaomi/mimo-v2-flash:free', name: 'MiMo 2 Flash', cost: 300 },
    isGenerating: false
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
    authScreen: $('#auth-screen'),
    mainScreen: $('#main-screen'),
    googleLogin: $('#google-login'),
    creditsCount: $('#credits-count'),
    userAvatar: $('#user-avatar'),
    userName: $('#dropdown-name'),
    userEmail: $('#dropdown-email'),
    logoutBtn: $('#logout-btn'),
    promptInput: $('#prompt-input'),
    generateBtn: $('#generate-btn'),
    loadingOverlay: $('#loading-overlay'),
    feedGrid: $('#feed-grid')
};

auth.onAuthStateChanged(async (user) => {
    if (user) {
        await initUser(user);
    } else {
        state.user = null;
        switchScreen(elements.authScreen);
    }
});

elements.googleLogin.addEventListener('click', async () => {
    try {
        elements.googleLogin.disabled = true;
        await auth.signInWithPopup(googleProvider);
    } catch (error) {
        showToast(error.message, 'error');
        elements.googleLogin.disabled = false;
    }
});

elements.logoutBtn.addEventListener('click', () => auth.signOut());

async function initUser(user) {
    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'init_user',
                userId: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            })
        });
        const data = await res.json();
        if (data.success) {
            state.user = user;
            state.credits = data.credits;
            state.username = data.username;
            state.projects = data.projects;
            updateUI();
            switchScreen(elements.mainScreen);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error(error);
        showToast('Connection failed. Please refresh.', 'error');
    }
}

function updateUI() {
    elements.creditsCount.textContent = state.credits.toLocaleString();
    if (state.user.photoURL) {
        elements.userAvatar.style.backgroundImage = `url(${state.user.photoURL})`;
        $('.dropdown-avatar').style.backgroundImage = `url(${state.user.photoURL})`;
    }
    elements.userName.textContent = state.user.displayName || state.username;
    elements.userEmail.textContent = state.user.email;
}

function switchScreen(screen) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check' : 'exclamation'}"></i><span>${msg}</span>`;
    $('#toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

elements.userAvatar.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#user-menu').classList.toggle('open');
});

document.addEventListener('click', () => $('#user-menu').classList.remove('open'));
