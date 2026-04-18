const orderForm = document.getElementById('orderForm');
const placeOrderBtn = document.getElementById('placeOrderBtn');
const messageEl = document.getElementById('message');
const domainField = document.getElementById('domainName');

function showMessage(kind, text) {
    messageEl.className = `message show ${kind}`;
    messageEl.textContent = text;
}

function preloadDomainFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'store') {
        domainField.value = decodeURIComponent(parts[1]).toLowerCase();
    }
}

orderForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(orderForm);
    const payload = {
        domainName: String(formData.get('domainName') || '').trim().toLowerCase(),
        buyerName: String(formData.get('buyerName') || '').trim(),
        phone: String(formData.get('phone') || '').trim(),
        totalAmount: Number(formData.get('totalAmount') || 0)
    };

    if (!payload.domainName || !payload.buyerName || !payload.phone || !Number.isFinite(payload.totalAmount) || payload.totalAmount <= 0) {
        showMessage('error', 'Please enter valid domain, buyer name, phone, and amount.');
        return;
    }

    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = 'Placing order...';

    try {
        const response = await fetch('/api/public/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage('error', result.message || 'Unable to place order.');
            return;
        }

        const displayOrderId = result.sellerOrderNo ?? result.orderId;
        showMessage('success', `Order #${displayOrderId} placed for ${result.businessName}.`);
        orderForm.reset();
        domainField.value = payload.domainName;
    } catch (err) {
        showMessage('error', `Request failed: ${err.message}`);
    } finally {
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = 'Place order';
    }
});

preloadDomainFromPath();
