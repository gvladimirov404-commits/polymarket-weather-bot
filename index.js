import express from 'express';
import admin from 'firebase-admin';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация на Firebase
if (!admin.apps.length) {
    try {
        const config = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(config)
        });
        console.log("✅ Firebase свързан успешно!");
    } catch (e) {
        console.error("❌ Грешка Firebase:", e.message);
    }
}

const db = admin.firestore();
app.use(express.json());

let botEnabled = true;

// API за статус
app.get('/api/status', async (req, res) => {
    try {
        const statsDoc = await db.collection('stats').doc('current').get();
        if (!statsDoc.exists) {
            return res.json({ botEnabled, balance: "70.00", lastTemp: "??", error: "Липсва документ в DB" });
        }
        const data = statsDoc.data();
        res.json({
            botEnabled: botEnabled,
            balance: (data.balance || 70.00).toFixed(2),
            lastTemp: data.last_temp || "--",
            balance_history: data.history || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled: botEnabled });
});

// Интерфейс
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HyperMeteo Bot</title>
    <style>
        body { font-family: sans-serif; background: #0a0f1e; color: white; padding: 20px; text-align: center; }
        .card { background: #1e2436; padding: 30px; border-radius: 20px; max-width: 400px; margin: auto; }
        button { background: #6c8eff; border: none; color: white; padding: 15px; border-radius: 30px; cursor: pointer; width: 100%; font-weight: bold; }
        .temp { color: #ffab40; font-size: 1.2em; }
    </style>
</head>
<body>
    <div class="card">
        <h2>📈 HyperMeteo Trading</h2>
        <div id="status">Зареждане...</div><br>
        <button id="toggleBtn">Включи/Изключи</button>
    </div>
    <script>
        async function update() {
            const res = await fetch('/api/status');
            const data = await res.json();
            document.getElementById('status').innerHTML = 
                '💰 Баланс: $' + data.balance + '<br>' +
                '🌡️ Температура: <span class="temp">' + data.lastTemp + '°C</span>';
        }
        update();
        setInterval(update, 5000);
        document.getElementById('toggleBtn').onclick = () => fetch('/api/bot/toggle', {method:'POST'}).then(update);
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0');
