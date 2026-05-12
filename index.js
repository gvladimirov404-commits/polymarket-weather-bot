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
        console.log("✅ Firebase е свързан успешно!");
    } catch (e) {
        console.error("❌ Критична грешка при Firebase:", e.message);
    }
}

const db = admin.firestore();
app.use(express.json());

let botEnabled = true;

// 2. Функция за автоматично обновяване на времето (София)
async function updateWeather() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=42.69&longitude=23.32&current_weather=true';
        const response = await axios.get(url);
        const temp = response.data.current_weather.temperature;
        
        await db.collection('stats').doc('current').set({
            last_temp: temp
        }, { merge: true });
        
        console.log(`🌡️ Времето е обновено: ${temp}°C`);
    } catch (e) {
        console.error("❌ Грешка при взимане на времето:", e.message);
    }
}

// Обновява на всеки 10 минути
setInterval(updateWeather, 600000);
updateWeather();

// 3. API за статус (чети данни от Firebase)
app.get('/api/status', async (req, res) => {
    try {
        const doc = await db.collection('stats').doc('current').get();
        let firebaseData = { balance: 70, last_temp: "--" };

        if (doc.exists) {
            firebaseData = doc.data();
        }

        res.json({
            balance: Number(firebaseData.balance || 70).toFixed(2),
            lastTemp: firebaseData.last_temp || "--",
            botEnabled: botEnabled
        });
    } catch (e) {
        console.error("❌ Грешка при API статус:", e.message);
        res.json({ balance: "70.00", lastTemp: "--", botEnabled });
    }
});

// 4. API за контрол на бота
app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled });
});

// 5. Визуален интерфейс (HTML)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HyperMeteo Bot Control</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0a0f1e; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #1e2436; padding: 40px; border-radius: 30px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); width: 320px; border: 1px solid #2d354d; }
        h2 { color: #6c8eff; margin-bottom: 25px; font-size: 1.5em; }
        .stat-box { background: #252b41; padding: 15px; border-radius: 15px; margin: 10px 0; border: 1px solid #323a54; }
        .label { font-size: 0.9em; color: #8a94ad; margin-bottom: 5px; }
        .value { font-size: 1.3em; font-weight: bold; }
        .temp-val { color: #ffab40; }
        .status-on { color: #4caf50; }
        .status-off { color: #f44336; }
        button { background: #6c8eff; border: none; color: white; padding: 15px; border-radius: 50px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 20px; transition: 0.3s; }
        button:hover { background: #5a7be0; transform: scale(1.02); }
    </style>
</head>
<body>
    <div class="card">
        <h2>📈 HyperMeteo Master</h2>
        <div id="ui">
            <div class="stat-box">
                <div class="label">Текущ Баланс</div>
                <div class="value" id="balance">--</div>
            </div>
            <div class="stat-box">
                <div class="label">Времето в София</div>
                <div class="value temp-val" id="temp">--</div>
            </div>
            <div class="stat-box">
                <div class="label">Статус на Бота</div>
                <div class="value" id="botStatus">--</div>
            </div>
        </div>
        <button id="toggleBtn">Превключи Бота</button>
    </div>

    <script>
        async function updateDashboard() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                document.getElementById('balance').innerText = '$' + data.balance;
                document.getElementById('temp').innerText = data.lastTemp + '°C';
                
                const statusEl = document.getElementById('botStatus');
                if(data.botEnabled) {
                    statusEl.innerText = 'РАБОТИ';
                    statusEl.className = 'value status-on';
                } else {
                    statusEl.innerText = 'ИЗКЛЮЧЕН';
                    statusEl.className = 'value status-off';
                }
            } catch(e) {
                console.error("Грешка при опресняване");
            }
        }

        document.getElementById('toggleBtn').onclick = async () => {
            await fetch('/api/bot/toggle', { method: 'POST' });
            updateDashboard();
        };

        updateDashboard();
        setInterval(updateDashboard, 5000);
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Сървърът е стартиран на порт ${PORT}`);
});
             
