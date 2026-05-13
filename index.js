const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация на Firebase (ако е конфигуриран)
try {
    if (process.env.FIREBASE_CONFIG) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
} catch (e) { console.log("Firebase error: " + e.message); }

const db = admin.apps.length ? admin.firestore() : null;

// API Ендпойн за статус
app.get('/api/status', async (req, res) => {
    try {
        let temp = "--";
        if (db) {
            const doc = await db.collection('stats').doc('current').get();
            if (doc.exists) temp = doc.data().last_temp || "--";
        }
        res.json({ balance: "1000.00", profit: "50.00", lastTemp: temp });
    } catch (e) { res.json({ balance: "1000.00", profit: "50.00", lastTemp: "--" }); }
});

// Главна страница с Hyperliquid дизайн и 5 езика
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>HyperMeteo Terminal</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto+Mono:wght@500&display=swap');
            body { background: #050505; color: #e0e0e0; font-family: 'Inter', sans-serif; margin: 0; display: flex; justify-content: center; padding-top: 20px; }
            .terminal { width: 92%; max-width: 400px; background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 12px; padding: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
            
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 20px; }
            .brand { color: #00ffa3; font-weight: bold; letter-spacing: 1.5px; font-size: 13px; }
            .lang-select { background: #111; color: #00ffa3; border: 1px solid #00ffa3; border-radius: 4px; font-size: 11px; padding: 4px; outline: none; }

            .main-display { text-align: center; margin-bottom: 25px; padding: 20px; background: #0d0d0d; border-radius: 10px; border: 1px solid #151515; }
            .label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
            .amount { font-size: 42px; font-family: 'Roboto Mono', monospace; color: #00ffa3; font-weight: bold; }
            
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
            .grid-box { background: #0d0d0d; padding: 15px; border-radius: 8px; border: 1px solid #151515; }
            .grid-val { font-family: 'Roboto Mono', monospace; font-size: 18px; color: #fff; margin-top: 5px; }
            .profit-up { color: #00ffa3; }

            .status-bar { background: rgba(0, 163, 255, 0.05); border: 1px solid #00a3ff; padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .status-text { color: #00a3ff; font-weight: bold; font-size: 11px; text-transform: uppercase; }

            .actions { display: grid; gap: 10px; }
            .btn { width: 100%; padding: 15px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; text-transform: uppercase; transition: 0.2s; }
            .btn-run { background: #00ffa3; color: #000; }
            .btn-stop { background: #000; color: #ff4444; border: 1px solid #ff4444; }
        </style>
    </head>
    <body>
        <div class="terminal">
            <div class="header">
                <div class="brand">HYPERMETEO GLOBAL</div>
                <select class="lang-select" id="lP" onchange="chL()">
                    <option value="en">EN</option>
                    <option value="bg">BG</option>
                    <option value="ru">RU</option>
                    <option value="es">ES</option>
                    <option value="tr">TR</option>
                </select>
            </div>

            <div class="main-display">
                <div class="label" id="t-bal">Total Balance</div>
                <div class="amount">$1,000.00</div>
            </div>

            <div class="grid">
                <div class="grid-box">
                    <div class="label" id="t-pro">24h Profit</div>
                    <div class="grid-val profit-up">+$50.00</div>
                </div>
                <div class="grid-box">
                    <div class="label" id="t-wea">Weather</div>
                    <div class="grid-val" id="temp">--°C</div>
                </div>
            </div>

            <div class="status-bar">
                <div class="label" id="t-mod" style="margin:0;">Risk Level</div>
                <div class="status-text" id="v-mod">CONSERVATIVE</div>
            </div>

            <div class="actions">
                <button class="btn btn-run" id="b-start">Execute Trade</button>
                <button class="btn btn-stop" id="b-stop">Halt System</button>
            </div>
        </div>

        <script>
            const voc = {
                en: { bal: "Total Balance", pro: "24h Profit", wea: "Weather", mod: "Risk Level", vmod: "CONSERVATIVE", start: "Execute Trade", stop: "Halt System" },
                bg: { bal: "Общ Баланс", pro: "Печалба 24ч", wea: "Време", mod: "Ниво на риск", vmod: "КОНСЕРВАТИВЕН", start: "Старт Търговия", stop: "Спри Системата" },
                ru: { bal: "Общий Баланс", pro: "Прибыль 24ч", wea: "Погода", mod: "Уровень риска", vmod: "КОНСЕРВАТИВНЫЙ", start: "Начать Торговлю", stop: "Стоп Система" },
                es: { bal: "Balance Total", pro: "Ganancia 24h", wea: "Clima", mod: "Nivel de Riesgo", vmod: "CONSERVADOR", start: "Ejecutar Trade", stop: "Detener Sistema" },
                tr: { bal: "Toplam Bakiye", pro: "24s Kâr", wea: "Hava Durumu", mod: "Risk Seviyesi", vmod: "MUHAFAZAKÂR", start: "Ticareti Başlat", stop: "Sistemi Durdur" }
            };

            function chL() {
                const l = document.getElementById('lP').value;
                const s = voc[l];
                document.getElementById('t-bal').innerText = s.bal;
                document.getElementById('t-pro').innerText = s.pro;
                document.getElementById('t-wea').innerText = s.wea;
                document.getElementById('t-mod').innerText = s.mod;
                document.getElementById('v-mod').innerText = s.vmod;
                document.getElementById('b-start').innerText = s.start;
                document.getElementById('b-stop').innerText = s.stop;
            }

            async function refresh() {
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    document.getElementById('temp').innerText = d.lastTemp + '°C';
                } catch(e) {}
            }
            setInterval(refresh, 10000); refresh();
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 Terminal Ready"));
             
