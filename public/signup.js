const signupForm = document.getElementById('signupForm');
const signupBtn = document.getElementById('signupBtn');
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

signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(signupForm);
    const payload = {
        businessName: String(formData.get('businessName') || '').trim(),
        whatsappNumber: String(formData.get('whatsappNumber') || '').trim(),
        domainName: String(formData.get('domainName') || '').trim().toLowerCase(),
        username: String(formData.get('username') || '').trim(),
        password: String(formData.get('password') || ''),
        confirmPassword: String(formData.get('confirmPassword') || '')
    };

    if (!payload.businessName || !payload.whatsappNumber || !payload.domainName || !payload.username || !payload.password || !payload.confirmPassword) {
        showMessage('error', 'Please fill all signup fields.');
        return;
    }

    if (!/^[a-z0-9.-]+$/.test(payload.domainName)) {
        showMessage('error', 'Domain name can only contain letters, numbers, dots, and hyphens.');
        return;
    }

    if (payload.password.length < 6) {
        showMessage('error', 'Password must be at least 6 characters.');
        return;
    }

    if (payload.password !== payload.confirmPassword) {
        showMessage('error', 'Passwords do not match.');
        return;
    }

    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account...';

    try {
        const response = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessName: payload.businessName,
                whatsappNumber: payload.whatsappNumber,
                domainName: payload.domainName,
                username: payload.username,
                password: payload.password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            if (response.status === 409 && (result.message || '').toLowerCase().includes('whatsapp number is already linked')) {
                showMessage('warn', 'This WhatsApp is already linked to another business. Use that original business name, or use a different WhatsApp number.');
            } else if (response.status === 409 && (result.message || '').toLowerCase().includes('domain')) {
                showMessage('warn', result.message || 'This domain is already linked to another seller.');
            } else {
                showMessage('error', result.message || 'Signup failed.');
            }
            return;
        }

        showMessage('success', 'Account created. Redirecting to dashboard...');
        window.setTimeout(() => {
            window.location.assign('/dashboard.html');
        }, 500);
    } catch (err) {
        showMessage('error', `Signup request failed: ${err.message}`);
    } finally {
        signupBtn.disabled = false;
        signupBtn.textContent = 'Create account';
    }
});

checkExistingSession();
