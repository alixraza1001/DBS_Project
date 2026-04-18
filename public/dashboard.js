const welcomeTitle = document.getElementById('welcomeTitle');
const identityLine = document.getElementById('identityLine');
const sourceTag = document.getElementById('sourceTag');
const ordersBody = document.getElementById('ordersBody');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');

let searchTimer;

function formatDate(value) {
    if (!value) {
        return '-';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function renderOrders(orders) {
    ordersBody.innerHTML = '';

    if (!orders.length) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    for (const order of orders) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${order.SellerOrderNo ?? order.OrderID ?? '-'}</td>
            <td>#${order.BuyerID ?? '-'}</td>
            <td>${order.BuyerName ?? '-'}</td>
            <td>${order.Phone ?? '-'}</td>
            <td>${formatDate(order.OrderDate)}</td>
            <td class="amount">Rs. ${Number(order.TotalAmount || 0).toLocaleString()}</td>
        `;
        ordersBody.appendChild(row);
    }
}

async function loadSession() {
    const response = await fetch('/api/auth/me');
    if (!response.ok) {
        window.location.assign('/login.html');
        return null;
    }

    const payload = await response.json();
    const user = payload.user;

    welcomeTitle.textContent = `${user.businessName} | Pending COD Confirmations`;
    if (user.domainName) {
        identityLine.textContent = `Signed in as ${user.username} | Domain: ${user.domainName}`;
    } else {
        identityLine.textContent = `Signed in as ${user.username}`;
    }

    return user;
}

async function loadOrders(searchText = '') {
    const query = searchText ? `?search=${encodeURIComponent(searchText)}` : '';
    const response = await fetch(`/api/orders${query}`);

    if (response.status === 401) {
        window.location.assign('/login.html');
        return;
    }

    const data = await response.json();
    sourceTag.textContent = `Data source: ${response.headers.get('X-Data-Source') || 'unknown'}`;
    renderOrders(Array.isArray(data) ? data : []);
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        loadOrders(searchInput.value.trim()).catch((err) => {
            console.error('Search failed', err);
        });
    }, 220);
});

refreshBtn.addEventListener('click', () => {
    loadOrders(searchInput.value.trim()).catch((err) => {
        console.error('Refresh failed', err);
    });
});

logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login.html');
});

(async function init() {
    try {
        const session = await loadSession();
        if (!session) {
            return;
        }

        await loadOrders();
    } catch (err) {
        console.error('Dashboard init failed', err);
        sourceTag.textContent = 'Data source: unavailable';
        emptyState.hidden = false;
        emptyState.textContent = `Unable to load dashboard: ${err.message}`;
    }
})();
