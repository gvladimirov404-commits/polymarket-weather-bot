const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

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
        console.error("❌ Грешка при Firebase Config:", e.message);
    }
}

const db = admin.firestore();
app.use(express.json());

let botEnabled = true;

// Функция за времето - София
async function updateWeather() {
    try {
        const res = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=42.69&longitude=23.32&current_weather=true');
        const temp = res.data.current_weather.temperature;
        await db.collection('stats').doc('current').set({ last_temp: temp }, { merge: true });
        console.log("🌡️ Температурата е обновена: " + temp);
    } catch (e) {
        console.log("❌ Грешка при взимане на времето");
    }
}
setInterval(updateWeather, 600000);
updateWeather();

// API Маршрути
app.get('/api/status', async (req, res) => {
    try {
        const doc = await db.collection('stats').doc('current').get();
        let data = { balance: 70, last_temp: "--" };
        if (doc.exists) data = doc.data();
        
        res.json({
            balance: Number(data.balance || 70).toFixed(2),
            lastTemp: data.last_temp || "--",
            botEnabled: botEnabled
        });
    } catch (e) {
        res.json({ balance: "70.00", lastTemp: "--", botEnabled });
    }
});

app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled });
});

// ГЛАВЕН ИНТЕРФЕЙС
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>HyperMeteo Control</title>
    <style>
        body { font-family: sans-serif; background: #0a101e; color: white; text-align: center; padding: 50px; }
        .card { background: #1a2235; padding: 30px; border-radius: 20px; display: inline-block; border: 1px solid #303a52; }
        .val { font-size: 24px; font-weight: bold; color: #6c8eff; }
        button { background: #6c8eff; border: none; color: white; padding: 15px 30px; border-radius: 10px; cursor: pointer; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>📈 HyperMeteo Master</h1>
        <p>💰 Баланс: <span class="val" id="b">--</span></p>
        <p>🌡️ Време: <span class="val" id="t" style="color:#ffab40">--</span></p>
        <button onclick="toggle()">ВКЛ/ИЗКЛ БОТА</button>
    </div>
    <script>
        async function load() {
            const r = await fetch('/api/status');
            const d = await r.json();
            document.getElementById('b').innerText = '$' + d.balance;
            document.getElementById('t').innerText = d.lastTemp + '°C';
        }
        async function toggle() { await fetch('/api/bot/toggle', {method:'POST'}); load(); }
        load(); setInterval(load, 5000);
    </script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 Сървърът е жив!"));
                                              
