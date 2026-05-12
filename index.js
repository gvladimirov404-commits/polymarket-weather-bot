import express from 'express';
import admin from 'firebase-admin';

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация на Firebase чрез променливата от Railway
if (!admin.apps.length) {
    try {
        const config = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(config)
        });
        console.log("✅ Firebase свързан успешно!");
    } catch (e) {
        console.error("❌ Грешка при четене на FIREBASE_CONFIG:", e.message);
    }
}

const db = admin.firestore();
app.use(express.json());

// Първоначални данни (ако базата е празна)
let botEnabled = true;

// API маршрут за статус - Чете директно от Firebase
app.get('/api/status', async (req, res) => {
    try {
        const statsDoc = await db.collection('stats').doc('current').get();
        const data = statsDoc.exists ? statsDoc.data() : { balance: 70.00, history: [] };
        
        res.json({
            botEnabled: botEnabled,
            balance: data.balance.toFixed(2),
            dailyPnL: "0.00",
            activePositions: 0,
            balance_history: data.history || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Бутонът за включване/изключване
app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled: botEnabled });
});

// Твоят красив интерфейс
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HyperMeteo Global Master</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body { font-family: system-ui, sans-serif; padding: 16px; max-width: 700px; margin: 0 auto; background: #0a0f1e; color: #e0e0e0; }
        .card { background: #1e2436; border-radius: 24px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        button { background: #2c3e66; border: none; color: white; padding: 12px 24px; border-radius: 40px; font-size: 16px; font-weight: bold; cursor: pointer; }
        h2 { margin-top: 0; color: #6c8eff; }
    </style>
</head>
<body>
<div class="card">
    <h2>📈 HyperMeteo Trading</h2>
    <div id="status">Свързване с базата...</div>
    <button id="toggleBtn">🔴 Изключи бота</button>
    <canvas id="balanceChart" width="400" height="200"></canvas>
</div>
<script>
    async function fetchStatus() {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('status').innerHTML = \`
            🟢 <strong>Ботът е \${data.botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}</strong><br>
            💰 Баланс: $\${data.balance}
        \`;
        // Тук се чертае графиката...
    }
    fetchStatus();
    setInterval(fetchStatus, 10000);
</script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 Сървърът стартира на порт " + PORT);
});
