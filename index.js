const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Инициализация на Firebase
if (!admin.apps.length) {
    try {
        const config = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(config)
        });
        console.log("✅ Firebase свързан!");
    } catch (e) {
        console.error("❌ Грешка Firebase:", e.message);
    }
}

const db = admin.firestore();
app.use(express.json());

let botEnabled = true;

// 2. Функция за времето
async function updateWeather() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=42.69&longitude=23.32&current_weather=true';
        const response = await axios.get(url);
        const temp = response.data.current_weather.temperature;
        
        await db.collection('stats').doc('current').update({
            last_temp: temp
        });
        console.log("🌡️ Температурата е обновена: " + temp);
    } catch (e) {
        console.log("❌ Грешка при времето");
    }
}

setInterval(updateWeather, 600000); // На всеки 10 мин.
updateWeather();

// 3. API Маршрути
app.get('/api/status', async (req, res) => {
    try {
        const doc = await db.collection('stats').doc('current').get();
        if (!doc.exists) {
            return res.json({ balance: "70.00", lastTemp: "--", botEnabled });
        }
        const data = doc.data();
        res.json({
            balance: (data.balance || 70).toFixed(2),
            lastTemp: data.last_temp || "--",
            botEnabled: botEnabled
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled });
});

// 4. Дизайн (Интерфейс)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HyperMeteo Bot</title>
    <style>
        body { font-family: sans-serif; background: #0a0f1e; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #1e2436; padding: 40px; border-radius: 30px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 320px; }
        h2 { color: #6c8eff; margin-bottom: 30px; }
        .stat { font-size: 1.2em; margin: 15px 0; }
        .temp { color: #ffab40; font-weight: bold; }
        button { background: #6c8eff; border: none; color: white; padding: 15px 30px; border-radius: 50px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <h2>📊 HyperMeteo</h2>
        <div id="data">Зареждане...</div>
        <button id="btn">Включи/Изключи</button>
    </div>
    <script>
        async function refresh() {
            try {
                const r = await fetch('/api/status');
                const d = await r.json();
                document.getElementById('data').innerHTML = 
                    '<div class="stat">💰 Баланс: <b>$' + d.balance + '</b></div>' +
                    '<div class="stat">🌡️ Време: <span class="temp">' + d.lastTemp + '°C</span></div>' +
                    '<div class="stat">🤖 Статус: ' + (d.botEnabled ? '✅' : '⛔') + '</div>';
            } catch(e) { document.getElementById('data').innerHTML = "❌ Грешка при връзката"; }
        }
        document.getElementById('btn').onclick = async () => { await fetch('/api/bot/toggle', {method:'POST'}); refresh(); };
        refresh();
        setInterval(refresh, 5000);
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log("🚀 Сървърът работи!"));
      
