const form = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const messageEl = document.getElementById('message');

function showMessage(kind, text) {
    messageEl.className = `message show ${kind}`;
    messageEl.textContent = text;
}

async function checkExistingSession() {
    try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
            window.location.assign('/dashboard.html');
        }
    } catch (err) {
        console.error('Session check failed', err);
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const username = String(formData.get('username') || '').trim();
    const password = String(formData.get('password') || '');

    if (!username || !password) {
        showMessage('error', 'Please enter username and password.');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const payload = await response.json();

        if (!response.ok) {
            if (response.status === 423) {
                showMessage('warn', payload.message || 'Account locked after 3 failed attempts.');
            } else if (typeof payload.attemptsLeft === 'number') {
                showMessage('error', `${payload.message} Attempts left: ${payload.attemptsLeft}`);
            } else {
                showMessage('error', payload.message || 'Unable to sign in.');
            }
            return;
        }

        showMessage('success', 'Login successful. Redirecting to dashboard...');
        window.setTimeout(() => {
            window.location.assign('/dashboard.html');
        }, 450);
    } catch (err) {
        showMessage('error', `Login request failed: ${err.message}`);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign in';
    }
});

checkExistingSession();
