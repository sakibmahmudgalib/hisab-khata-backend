const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Create MySQL Connection Pool for ByetHost Database
const dbPool = mysql.createPool({
    host: process.env.DB_HOST || 'sql308.byethost10.com',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'b10_43371827',
    password: process.env.DB_PASSWORD || 'galib@123',
    database: process.env.DB_NAME || 'b10_43371827_galib',
    waitForConnections: true,
    connectionLimit: 10,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// API Endpoint to fetch all data from MySQL DB
app.get('/api/data', async (req, res) => {
    try {
        const [mistrisRows] = await dbPool.query('SELECT * FROM mistris');
        const [genExpRows] = await dbPool.query('SELECT * FROM general_expenses');

        const mistrisMap = {};
        mistrisRows.forEach(m => {
            mistrisMap[m.id] = {
                id: m.id,
                name: m.name,
                role: m.role,
                contractAmount: Number(m.contract_amount),
                phone: m.phone,
                notes: m.notes,
                items: [],
                payments: [],
                otherExpenses: []
            };
        });

        const [itemRows] = await dbPool.query('SELECT * FROM contract_items');
        itemRows.forEach(it => {
            if (mistrisMap[it.mistri_id]) {
                mistrisMap[it.mistri_id].items.push({
                    title: it.title,
                    qty: Number(it.qty),
                    rate: Number(it.rate)
                });
            }
        });

        const [payRows] = await dbPool.query('SELECT * FROM contract_payments');
        payRows.forEach(p => {
            if (mistrisMap[p.mistri_id]) {
                mistrisMap[p.mistri_id].payments.push({
                    id: p.id,
                    date: p.payment_date,
                    category: p.category,
                    amount: Number(p.amount)
                });
            }
        });

        const [mExpRows] = await dbPool.query('SELECT * FROM mistri_other_expenses');
        mExpRows.forEach(e => {
            if (mistrisMap[e.mistri_id]) {
                mistrisMap[e.mistri_id].otherExpenses.push({
                    id: e.id,
                    date: e.expense_date,
                    category: e.category,
                    amount: Number(e.amount)
                });
            }
        });

        const generalExpenses = genExpRows.map(g => ({
            id: g.id,
            date: g.expense_date,
            category: g.category,
            amount: Number(g.amount),
            note: g.note
        }));

        res.json({
            mistris: Object.values(mistrisMap),
            generalExpenses
        });
    } catch (err) {
        console.error("DB Fetch Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// API Endpoint to sync and save all data to MySQL DB
app.post('/api/sync', async (req, res) => {
    const connection = await dbPool.getConnection();
    try {
        await connection.beginTransaction();

        const { mistris = [], generalExpenses = [] } = req.body;

        await connection.query('DELETE FROM contract_items');
        await connection.query('DELETE FROM contract_payments');
        await connection.query('DELETE FROM mistri_other_expenses');
        await connection.query('DELETE FROM mistris');
        await connection.query('DELETE FROM general_expenses');

        for (const m of mistris) {
            await connection.query(
                'INSERT INTO mistris (id, name, role, contract_amount, phone, notes) VALUES (?, ?, ?, ?, ?, ?)',
                [m.id, m.name, m.role, m.contractAmount || 0, m.phone || '', m.notes || '']
            );

            if (m.items) {
                for (const it of m.items) {
                    await connection.query(
                        'INSERT INTO contract_items (mistri_id, title, qty, rate) VALUES (?, ?, ?, ?)',
                        [m.id, it.title || '', it.qty || 0, it.rate || 0]
                    );
                }
            }

            if (m.payments) {
                for (const p of m.payments) {
                    await connection.query(
                        'INSERT INTO contract_payments (id, mistri_id, payment_date, category, amount) VALUES (?, ?, ?, ?, ?)',
                        [p.id, m.id, p.date, p.category, p.amount || 0]
                    );
                }
            }

            if (m.otherExpenses) {
                for (const e of m.otherExpenses) {
                    await connection.query(
                        'INSERT INTO mistri_other_expenses (id, mistri_id, expense_date, category, amount) VALUES (?, ?, ?, ?, ?)',
                        [e.id, m.id, e.date, e.category, e.amount || 0]
                    );
                }
            }
        }

        for (const g of generalExpenses) {
            await connection.query(
                'INSERT INTO general_expenses (id, expense_date, category, amount, note) VALUES (?, ?, ?, ?, ?)',
                [g.id, g.date, g.category, g.amount || 0, g.note || '']
            );
        }

        await connection.commit();
        connection.release();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error("DB Sync Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        const conn = await dbPool.getConnection();
        conn.release();
        res.json({ status: 'ok', host: process.env.DB_HOST, database: process.env.DB_NAME });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fallback to index.html in public directory
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Cloud server running on port ${PORT}`));