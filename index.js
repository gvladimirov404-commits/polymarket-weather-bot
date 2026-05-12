const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ОПРОСТЕНА ИНИЦИАЛИЗАЦИЯ
try {
    if (process.env.FIREBASE_CONFIG) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase е свързан!");
    } else {
        console.log("⚠️ FIREBASE_CONFIG липсва в Railway Variables!");
    }
} catch (e) {
    console.log("❌ Грешка в конфигурацията на Firebase: " + e.message);
}

const db = admin.apps.length ? admin.firestore() : null;

// ФУНКЦИЯ ЗА ВРЕМЕТО
async function updateWeather() {
    if (!db) return;
    try {
        const res = await axios.get('https://api.open-meteo.com/v1/forecast?latitude=42.69&longitude=23.32&current_weather=true');
        const temp = res.data.current_weather.temperature;
        await db.collection('stats').doc('current').set({ last_temp: temp }, { merge: true });
        console.log("🌡️ Обновено време: " + temp);
    } catch (e) { console.log("Грешка при времето"); }
}
setInterval(updateWeather, 600000);
updateWeather();

// API ЕНДПОЙНТ
app.get('/api/status', async (req, res) => {
    try {
        if (!db) return res.json({ balance: "70.00", lastTemp: "--" });
        const doc = await db.collection('stats').doc('current').get();
        const data = doc.exists ? doc.data() : { balance: 70, last_temp: "--" };
        res.json({
            balance: Number(data.balance || 70).toFixed(2),
            lastTemp: data.last_temp || "--"
        });
    } catch (e) { res.json({ balance: "70.00", lastTemp: "--" }); }
});

// ГЛАВЕН САЙТ
app.get('/', (req, res) => {
    res.send(`
    <html>
    <body style="background:#0a101e; color:white; font-family:sans-serif; text-align:center; padding-top:100px;">
        <div style="background:#1a2235; display:inline-block; padding:40px; border-radius:20px; border:1px solid #303a52;">
            <h1 style="color:#6c8eff;">📈 HyperMeteo Active</h1>
            <p style="font-size:24px;">💰 Баланс: <span id="b">$70.00</span></p>
            <p style="font-size:24px;">🌡️ Температура: <span id="t">--</span></p>
        </div>
        <script>
            async function load() {
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    document.getElementById('b').innerText = '$' + d.balance;
                    document.getElementById('t').innerText = d.lastTemp + '°C';
                } catch(e) {}
            }
            load(); setInterval(load, 5000);
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 Ботът е пуснат на порт " + PORT));
