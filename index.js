import express from 'express';
import admin from 'firebase-admin';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Инициализация на Firebase
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

let botEnabled = true;

// 2. Логика за времето (Open-Meteo)
async function updateWeatherAndTrade() {
    if (!botEnabled) return;

    try {
        // Координати (Пример: София. Можеш да ги смениш за Търново или Москва)
        const lat = 42.69;
        const lon = 23.32;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        
        const response = await axios.get(url);
        const temp = response.data.current_weather.temperature;
        const wind = response.data.current_weather.windspeed;
        
        console.log(`📡 Сканиране: Температура ${temp}°C, Вятър ${wind}км/ч`);

        // Записваме последните данни в базата, за да ги виждаме на сайта
        await db.collection('stats').doc('current').update({
            last_temp: temp,
            last_update: new Date().toISOString()
        });

    } catch (error) {
        console.error("❌ Грешка при метео-сканирането:", error.message);
    }
}

// Изпълнявай на всеки 15 минути
setInterval(updateWeatherAndTrade, 900000);
updateWeatherAndTrade(); 

// 3. API Маршрути
app.get('/api/status', async (req, res) => {
    try {
        const statsDoc = await db.collection('stats').doc('current').get();
        const data = statsDoc.exists ? statsDoc.data() : { balance: 70.00, history: [] };
        
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

// 4. Потребителски интерфейс
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
        .card { background: #1e2436; border-radius: 24px; padding: 25px; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); border: 1px solid #2d354d; }
        button { background: #6c8eff; border: none; color: white; padding: 14px 28px; border-radius: 40px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
        button:hover { background: #4a6edb; }
        .temp-badge { background: #2d354d; padding: 5px 15px; border-radius: 10px; color: #ffab40; font-weight: bold; }
        h2 { margin-top: 0; color: #6c8eff; display: flex; justify-content: space-between; }
    </style>
</head>
<body>
<div class="card">
    <h2>📈 HyperMeteo <span>v1.0</span></h2>
    <div id="status">Свързване...</div><br>
    <button id="toggleBtn">🔴 Изключи бота</button>
</div>
<script>
    async function fetchStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            document.getElementById('status').innerHTML = \`
                🟢 Статус: <strong>\${data.botEnabled ? 'АКТИВЕН' : 'ПАУЗА'}</strong><br><br>
                💰 Баланс: <strong>$\${data.balance}</strong><br>
                🌡️ Време: <span class="temp-badge">\${data.lastTemp}°C</span>
            \`;
            document.getElementById('toggleBtn').textContent = data.botEnabled ? '🔴 Изключи бота' : '🟢 Включи бота';
        } catch(e) {
            document.getElementById('status').innerText = '❌ Грешка при връзката';
        }
    }
    document.getElementById('toggleBtn').onclick = async () => {
        await fetch('/api/bot/toggle', { method: 'POST' });
        fetchStatus();
    };
    fetchStatus();
    setInterval(fetchStatus, 10000);
</script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 HyperMeteo Master е онлайн на порт " + PORT);
});
  
