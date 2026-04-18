const express = require('express');
const session = require('express-session');
const sql = require('mssql/msnodesqlv8');

const app = express();

const dbServer = process.env.DB_SERVER || '.\\SQLEXPRESS';
const dbPort = process.env.DB_PORT ? Number(process.env.DB_PORT) : null;
const dbName = process.env.DB_NAME || 'CODManager';

const config = {
    connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${dbPort ? `${dbServer},${dbPort}` : dbServer};Database=${dbName};Trusted_Connection=Yes;TrustServerCertificate=Yes;Encrypt=No;`
};

const demoUsers = new Map([
    ['waqtoro-admin', { id: 1, username: 'waqtoro-admin', password: 'admin123', sellerId: 1, businessName: 'Waqtoro Watches', domainName: 'waqtoro.local' }]
]);

const demoFailedAttempts = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 8
        }
    })
);

function buildUserSession(user) {
    return {
        id: user.id,
        username: user.username,
        sellerId: user.sellerId,
        businessName: user.businessName,
        domainName: user.domainName || null
    };
}

function getDemoAttempts(username) {
    const current = demoFailedAttempts.get(username) || 0;
    return current;
}

function setDemoAttempts(username, value) {
    demoFailedAttempts.set(username, value);
}

function isAccountLocked(attempts) {
    return attempts >= 3;
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    next();
}

function isMissingAuthTable(err) {
    return err && typeof err.message === 'string' && err.message.includes("Invalid object name 'ClientUsers'");
}

function isMissingSignupTable(err) {
    if (!err || typeof err.message !== 'string') {
        return false;
    }

    return (
        err.message.includes("Invalid object name 'ClientUsers'") ||
        err.message.includes("Invalid object name 'Sellers'") ||
        err.message.includes("Invalid object name 'Buyers'") ||
        err.message.includes("Invalid object name 'Orders'")
    );
}

function isDuplicateConstraintError(err) {
    return err && (err.number === 2627 || err.number === 2601);
}

function isSqlConnectionError(err) {
    return err && typeof err.message === 'string' && err.message.toLowerCase().includes('data source name not found');
}

function normalizeDomainName(input) {
    return String(input || '').trim().toLowerCase();
}

async function loginWithDatabase(username, password) {
    const pool = await sql.connect(config);

    const result = await pool
        .request()
        .input('username', sql.NVarChar, username)
        .query(`
            SELECT TOP 1
                CU.UserID,
                CU.Username,
                CU.PasswordHash,
                CU.FailedAttempts,
                CU.IsLocked,
                S.SellerID,
                S.BusinessName,
                S.DomainName
            FROM ClientUsers CU
            INNER JOIN Sellers S ON S.SellerID = CU.SellerID
            WHERE CU.Username = @username
        `);

    if (!result.recordset.length) {
        return { ok: false, status: 401, message: 'Invalid username or password.' };
    }

    const user = result.recordset[0];
    const failedAttempts = Number(user.FailedAttempts || 0);

    if (user.IsLocked || failedAttempts >= 3) {
        return { ok: false, status: 423, message: 'Account locked after 3 failed attempts. Contact support.' };
    }

    if (password !== user.PasswordHash) {
        const updatedAttempts = failedAttempts + 1;
        const shouldLock = updatedAttempts >= 3;

        await pool
            .request()
            .input('userId', sql.Int, user.UserID)
            .input('attempts', sql.Int, updatedAttempts)
            .input('isLocked', sql.Bit, shouldLock)
            .query(`
                UPDATE ClientUsers
                SET FailedAttempts = @attempts,
                    IsLocked = @isLocked,
                    LastFailedAt = GETDATE()
                WHERE UserID = @userId
            `);

        if (shouldLock) {
            return { ok: false, status: 423, message: 'Account locked after 3 failed attempts. Contact support.' };
        }

        return {
            ok: false,
            status: 401,
            message: 'Invalid username or password.',
            attemptsLeft: 3 - updatedAttempts
        };
    }

    await pool
        .request()
        .input('userId', sql.Int, user.UserID)
        .query(`
            UPDATE ClientUsers
            SET FailedAttempts = 0,
                IsLocked = 0,
                LastFailedAt = NULL
            WHERE UserID = @userId
        `);

    return {
        ok: true,
        user: {
            id: user.UserID,
            username: user.Username,
            sellerId: user.SellerID,
            businessName: user.BusinessName,
            domainName: user.DomainName
        }
    };
}

function loginWithDemoUser(username, password) {
    const user = demoUsers.get(username);

    if (!user) {
        return { ok: false, status: 401, message: 'Invalid username or password.' };
    }

    const failedAttempts = getDemoAttempts(username);
    if (isAccountLocked(failedAttempts)) {
        return { ok: false, status: 423, message: 'Account locked after 3 failed attempts. Contact support.' };
    }

    if (user.password !== password) {
        const updatedAttempts = failedAttempts + 1;
        setDemoAttempts(username, updatedAttempts);

        if (isAccountLocked(updatedAttempts)) {
            return { ok: false, status: 423, message: 'Account locked after 3 failed attempts. Contact support.' };
        }

        return {
            ok: false,
            status: 401,
            message: 'Invalid username or password.',
            attemptsLeft: 3 - updatedAttempts
        };
    }

    setDemoAttempts(username, 0);

    return {
        ok: true,
        user: {
            id: user.id,
            username: user.username,
            sellerId: user.sellerId,
            businessName: user.businessName,
            domainName: user.domainName
        }
    };
}

async function signupWithDatabase({ businessName, whatsappNumber, domainName, username, password }) {
    const pool = await sql.connect(config);
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
        const normalizedBusinessName = businessName.trim();
        const normalizedWhatsApp = whatsappNumber.trim();
        const normalizedDomainName = normalizeDomainName(domainName);

        const domainSeller = await new sql.Request(transaction)
            .input('domainName', sql.NVarChar, normalizedDomainName)
            .query(`
                SELECT TOP 1 SellerID, BusinessName, WhatsAppNumber, DomainName
                FROM Sellers
                WHERE DomainName = @domainName
            `);

        let sellerId;
        let resolvedBusinessName = normalizedBusinessName;
        let resolvedDomainName = normalizedDomainName;

        if (domainSeller.recordset.length) {
            const linkedSeller = domainSeller.recordset[0];
            const sameBusiness = linkedSeller.BusinessName.toLowerCase() === normalizedBusinessName.toLowerCase();
            const sameWhatsApp = linkedSeller.WhatsAppNumber === normalizedWhatsApp;

            if (!sameBusiness || !sameWhatsApp) {
                const err = new Error('Domain is already linked to another seller profile.');
                err.code = 'DOMAIN_ALREADY_LINKED';
                throw err;
            }

            sellerId = linkedSeller.SellerID;
            resolvedBusinessName = linkedSeller.BusinessName;
            resolvedDomainName = linkedSeller.DomainName;
        } else {
            const existingWhatsapp = await new sql.Request(transaction)
                .input('whatsappNumber', sql.NVarChar, normalizedWhatsApp)
                .query(`
                    SELECT TOP 1 SellerID, BusinessName, DomainName
                    FROM Sellers
                    WHERE WhatsAppNumber = @whatsappNumber
                `);

            if (existingWhatsapp.recordset.length) {
                const linkedWhatsapp = existingWhatsapp.recordset[0];
                const sameBusiness = linkedWhatsapp.BusinessName.toLowerCase() === normalizedBusinessName.toLowerCase();
                if (!sameBusiness) {
                    const err = new Error('WhatsApp number is already linked to another business.');
                    err.code = 'WHATSAPP_ALREADY_LINKED';
                    throw err;
                }

                const err = new Error('This business already exists. Use the seller domain already assigned to it.');
                err.code = 'WHATSAPP_DOMAIN_REQUIRED';
                throw err;
            }

            const sellerInsert = await new sql.Request(transaction)
                .input('businessName', sql.NVarChar, normalizedBusinessName)
                .input('whatsappNumber', sql.NVarChar, normalizedWhatsApp)
                .input('domainName', sql.NVarChar, normalizedDomainName)
                .query(`
                        INSERT INTO Sellers (BusinessName, WhatsAppNumber, DomainName)
                        VALUES (@businessName, @whatsappNumber, @domainName);

                        SELECT CAST(SCOPE_IDENTITY() AS INT) AS SellerID;
                    `);

            sellerId = sellerInsert.recordset[0].SellerID;
        }

        const userResult = await new sql.Request(transaction)
            .input('sellerId', sql.Int, sellerId)
            .input('username', sql.NVarChar, username)
            .input('passwordHash', sql.NVarChar, password)
            .query(`
                INSERT INTO ClientUsers (SellerID, Username, PasswordHash)
                VALUES (@sellerId, @username, @passwordHash);

                SELECT CAST(SCOPE_IDENTITY() AS INT) AS UserID;
            `);

        await transaction.commit();

        return {
            id: userResult.recordset[0].UserID,
            username,
            sellerId,
            businessName: resolvedBusinessName,
            domainName: resolvedDomainName
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const dbLogin = await loginWithDatabase(username, password);

        if (!dbLogin.ok) {
            return res.status(dbLogin.status).json({
                message: dbLogin.message,
                attemptsLeft: dbLogin.attemptsLeft
            });
        }

        req.session.user = buildUserSession(dbLogin.user);
        return res.json({ user: req.session.user, source: 'database' });
    } catch (err) {
        if (!isMissingAuthTable(err)) {
            console.error('Database login check failed:', err.message);
        }

        const demoLogin = loginWithDemoUser(username, password);
        if (!demoLogin.ok) {
            return res.status(demoLogin.status).json({
                message: demoLogin.message,
                attemptsLeft: demoLogin.attemptsLeft,
                source: 'fallback'
            });
        }

        req.session.user = buildUserSession(demoLogin.user);
        return res.json({ user: req.session.user, source: 'fallback' });
    }
});

app.post('/api/auth/signup', async (req, res) => {
    const businessName = String(req.body.businessName || '').trim();
    const whatsappNumber = String(req.body.whatsappNumber || '').trim();
    const domainName = normalizeDomainName(req.body.domainName || '');
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!businessName || !whatsappNumber || !domainName || !username || !password) {
        return res.status(400).json({ message: 'Business name, WhatsApp number, domain name, username, and password are required.' });
    }

    if (!/^[a-z0-9.-]+$/.test(domainName)) {
        return res.status(400).json({ message: 'Domain name can only contain letters, numbers, dots, and hyphens.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    try {
        const createdUser = await signupWithDatabase({
            businessName,
            whatsappNumber,
            domainName,
            username,
            password
        });

        req.session.user = buildUserSession(createdUser);
        return res.status(201).json({
            message: 'Signup successful.',
            user: req.session.user,
            source: 'database'
        });
    } catch (err) {
        if (err.code === 'WHATSAPP_ALREADY_LINKED') {
            return res.status(409).json({
                message: 'This WhatsApp number is already linked to another business.'
            });
        }

        if (err.code === 'DOMAIN_ALREADY_LINKED') {
            return res.status(409).json({
                message: 'This domain is already linked to another seller.'
            });
        }

        if (err.code === 'WHATSAPP_DOMAIN_REQUIRED') {
            return res.status(409).json({
                message: 'This business already exists with a different domain. Use the original domain assigned to this seller.'
            });
        }

        if (isDuplicateConstraintError(err)) {
            return res.status(409).json({
                message: 'This username is already registered. Please choose a different username.'
            });
        }

        if (isSqlConnectionError(err)) {
            return res.status(500).json({
                message: 'Database connection is not configured on this machine. Install/configure SQL Server ODBC and then try signup again.'
            });
        }

        if (isMissingSignupTable(err)) {
            return res.status(500).json({
                message: 'Signup table is missing. Run your SQL setup scripts first.'
            });
        }

        console.error('Signup failed:', err.message);
        return res.status(500).json({ message: 'Signup failed due to a server or database error.' });
    }
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.post('/api/public/orders', async (req, res) => {
    const domainName = normalizeDomainName(req.body.domainName || '');
    const buyerName = String(req.body.buyerName || '').trim();
    const phone = String(req.body.phone || '').trim();
    const totalAmount = Number(req.body.totalAmount || 0);

    if (!domainName || !buyerName || !phone || !Number.isFinite(totalAmount) || totalAmount <= 0) {
        return res.status(400).json({
            message: 'domainName, buyerName, phone, and totalAmount are required.'
        });
    }

    try {
        const pool = await sql.connect(config);
        const tx = new sql.Transaction(pool);
        await tx.begin();

        try {
            const sellerResult = await new sql.Request(tx)
                .input('domainName', sql.NVarChar, domainName)
                .query(`
                    SELECT TOP 1 SellerID, BusinessName
                    FROM Sellers
                    WHERE DomainName = @domainName
                `);

            if (!sellerResult.recordset.length) {
                await tx.rollback();
                return res.status(404).json({ message: 'Seller not found for this domain.' });
            }

            const seller = sellerResult.recordset[0];

            const insertBuyer = await new sql.Request(tx)
                .input('sellerId', sql.Int, seller.SellerID)
                .input('fullName', sql.NVarChar, buyerName)
                .input('phone', sql.NVarChar, phone)
                .query(`
                    INSERT INTO Buyers (SellerID, FullName, Phone)
                    VALUES (@sellerId, @fullName, @phone);

                    SELECT CAST(SCOPE_IDENTITY() AS INT) AS BuyerID;
                `);

            const buyerId = insertBuyer.recordset[0].BuyerID;

            const sellerOrderNoResult = await new sql.Request(tx)
                .input('sellerId', sql.Int, seller.SellerID)
                .query(`
                    SELECT ISNULL(MAX(SellerOrderNo), 0) + 1 AS NextSellerOrderNo
                    FROM Orders
                    WHERE SellerID = @sellerId
                `);

            const sellerOrderNo = sellerOrderNoResult.recordset[0].NextSellerOrderNo;

            const insertOrder = await new sql.Request(tx)
                .input('sellerId', sql.Int, seller.SellerID)
                .input('buyerId', sql.Int, buyerId)
                .input('sellerOrderNo', sql.Int, sellerOrderNo)
                .input('totalAmount', sql.Decimal(10, 2), totalAmount)
                .query(`
                    INSERT INTO Orders (SellerID, BuyerID, SellerOrderNo, TotalAmount, OrderStatus)
                    VALUES (@sellerId, @buyerId, @sellerOrderNo, @totalAmount, 'Pending');

                    SELECT CAST(SCOPE_IDENTITY() AS INT) AS OrderID;
                `);

            await tx.commit();

            return res.status(201).json({
                message: 'Order placed successfully.',
                orderId: insertOrder.recordset[0].OrderID,
                sellerOrderNo,
                buyerId,
                sellerId: seller.SellerID,
                businessName: seller.BusinessName,
                domainName
            });
        } catch (innerError) {
            await tx.rollback();
            throw innerError;
        }
    } catch (err) {
        console.error('Public order placement failed:', err.message);
        return res.status(500).json({ message: 'Unable to place order right now.' });
    }
});

const fallbackOrders = [
    {
        OrderID: 1,
        SellerOrderNo: 1,
        BuyerID: 1,
        BuyerName: 'Ahmed Khan',
        Phone: '+923339876543',
        TotalAmount: 15000.0
    }
];

function filterDashboardOrders(orders, rawSearch) {
    const search = String(rawSearch || '').trim().toLowerCase();
    if (!search) {
        return orders;
    }

    const numericToken = search.replace(/[^0-9.-]/g, '');
    const numericSearch = Number(numericToken);
    const hasNumericSearch = numericToken.length > 0 && Number.isFinite(numericSearch);

    return orders.filter((order) => {
        const orderId = Number(order.OrderID || 0);
        const sellerOrderNo = Number(order.SellerOrderNo || 0);
        const buyerId = Number(order.BuyerID || 0);
        const buyerName = String(order.BuyerName || '').toLowerCase();
        const phone = String(order.Phone || '').toLowerCase();
        const amount = String(order.TotalAmount || '').toLowerCase();

        const orderDate = new Date(order.OrderDate);
        const dateSearchPool = [String(order.OrderDate || '').toLowerCase()];
        if (!Number.isNaN(orderDate.getTime())) {
            dateSearchPool.push(orderDate.toISOString().toLowerCase());
            dateSearchPool.push(orderDate.toISOString().slice(0, 10));
            dateSearchPool.push(orderDate.toISOString().slice(0, 16).replace('t', ' '));
            dateSearchPool.push(orderDate.toLocaleDateString('en-GB').toLowerCase());
            dateSearchPool.push(orderDate.toLocaleDateString('en-US').toLowerCase());
            dateSearchPool.push(orderDate.toLocaleString('en-GB').toLowerCase());
            dateSearchPool.push(orderDate.toLocaleString('en-US').toLowerCase());
        }

        if (hasNumericSearch && (orderId === numericSearch || sellerOrderNo === numericSearch || buyerId === numericSearch)) {
            return true;
        }

        return (
            buyerName.includes(search) ||
            phone.includes(search) ||
            amount.includes(search) ||
            dateSearchPool.some((dateValue) => dateValue.includes(search))
        );
    });
}

app.get('/api/orders', requireAuth, async (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();

    try {
        const pool = await sql.connect(config);
        const result = await pool
            .request()
            .input('sellerId', sql.Int, req.session.user.sellerId)
            .query(`
                SELECT
                    O.OrderID,
                    O.SellerOrderNo,
                    B.BuyerID,
                    S.DomainName,
                    B.FullName AS BuyerName,
                    B.Phone,
                    O.TotalAmount,
                    O.OrderDate
                FROM Orders O
                INNER JOIN Sellers S ON O.SellerID = S.SellerID
                INNER JOIN Buyers B ON O.BuyerID = B.BuyerID AND B.SellerID = O.SellerID
                WHERE O.OrderStatus = 'Pending'
                  AND O.SellerID = @sellerId
                ORDER BY O.OrderDate DESC
            `);

        const data = filterDashboardOrders(result.recordset, search);

        res.set('X-Data-Source', 'database');
        res.json(data);
    } catch (err) {
        console.error('Database connection failed:', err.message);

        const sellerScopedFallback = fallbackOrders.filter((order) => order.OrderID === 1 || req.session.user.sellerId === 1);
        const data = filterDashboardOrders(sellerScopedFallback, search);

        res.set('X-Data-Source', 'fallback');
        res.json(data);
    }
});

app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard.html');
    }

    return res.redirect('/login.html');
});

app.get('/store/:domainName', (req, res) => {
    return res.sendFile('store.html', { root: 'public' });
});

app.use(express.static('public'));
app.listen(3000, () => console.log('Frontend live at http://localhost:3000'));