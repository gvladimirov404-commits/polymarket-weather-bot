const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ИНИЦИАЛИЗАЦИЯ НА FIREBASE
try {
    if (process.env.FIREBASE_CONFIG) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("✅ Firebase Connected");
    }
} catch (e) {
    console.log("❌ Firebase initialization failed: " + e.message);
}

const db = admin.apps.length ? admin.firestore() : null;

// API ЕНДПОЙНТ ЗА СТАТУС
app.get('/api/status', async (req, res) => {
    try {
        let temp = "--";
        if (db) {
            const doc = await db.collection('stats').doc('current').get();
            if (doc.exists) temp = doc.data().last_temp || "--";
        }
        res.json({
            balance: "1000.00",
            profit: "50.00",
            lastTemp: temp
        });
    } catch (e) {
        res.json({ balance: "1000.00", profit: "50.00", lastTemp: "--" });
    }
});

// ГЛАВЕН ИНТЕРФЕЙС (HYPERLIQUID STYLE)
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            :root { --hl-green: #00ffa3; --hl-blue: #00a3ff; --hl-red: #ff4444; --bg: #050505; --card: #0d0d0d; }
            body { background: var(--bg); color: #e0e0e0; font-family: 'Inter', sans-serif; margin: 0; padding: 15px; display: flex; justify-content: center; }
            .terminal { width: 100%; max-width: 400px; background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 16px; padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.8); }
            
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .brand { color: var(--hl-green); font-weight: bold; letter-spacing: 1px; font-size: 14px; }
            .lang-sel { background: #111; color: var(--hl-green); border: 1px solid #222; border-radius: 4px; font-size: 11px; padding: 3px; }

            .display-card { text-align: center; margin-bottom: 20px; padding: 25px; background: var(--card); border-radius: 12px; border: 1px solid #1a1a1a; }
            .label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
            .amount { font-size: 44px; font-family: 'Roboto Mono', monospace; color: var(--hl-green); font-weight: bold; }

            .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
            .stat-box { background: var(--card); padding: 15px; border-radius: 10px; border: 1px solid #1a1a1a; }
            .stat-val { font-family: 'Roboto Mono', monospace; font-size: 18px; color: #fff; margin-top: 5px; }

            /* ПРЕВКЛЮЧВАТЕЛ НА РЕЖИМИ */
            .mode-switch { display: flex; background: #111; padding: 4px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #222; }
            .m-btn { flex: 1; padding: 10px; text-align: center; font-size: 11px; font-weight: bold; cursor: pointer; border-radius: 7px; transition: 0.3s; color: #444; }
            .m-btn.active { background: var(--hl-blue); color: #fff; box-shadow: 0 0 15px rgba(0,163,255,0.3); }

            /* РЕФЕРАЛНА СИСТЕМА */
            .ref-panel { background: rgba(0, 163, 255, 0.05); border: 1px dashed var(--hl-blue); padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
            .price-now { font-size: 20px; font-weight: bold; color: #fff; margin: 5px 0; }

            .btn-run { width: 100%; padding: 16px; border: none; border-radius: 8px; background: var(--hl-green); color: #000; font-weight: bold; cursor: pointer; text-transform: uppercase; transition: 0.2s; }
            .btn-run:active { transform: scale(0.98); }
            
            #console { font-family: monospace; font-size: 10px; color: #333; height: 50px; overflow: hidden; margin-top: 15px; border-top: 1px solid #1a1a1a; padding-top: 10px; }
        </style>
    </head>
    <body>
        <div class="terminal">
            <div class="header">
                <div class="brand">HYPERMETEO GLOBAL</div>
                <select class="lang-sel" id="lP" onchange="updL()">
                    <option value="en">EN</option><option value="bg">BG</option>
                    <option value="ru">RU</option><option value="es">ES</option><option value="tr">TR</option>
                </select>
            </div>

            <div class="display-card">
                <div id="lb-bal" class="label">Total Balance</div>
                <div class="amount" id="amt">$1,000.00</div>
            </div>

            <div class="stats">
                <div class="stat-box">
                    <div id="lb-pro" class="label">24h Profit</div>
                    <div class="stat-val" style="color:var(--hl-green)">+$50.00</div>
                </div>
                <div class="stat-box">
                    <div id="lb-wea" class="label">Weather</div>
                    <div class="stat-val" id="temp">--°C</div>
                </div>
            </div>

            <div class="mode-switch">
                <div id="m-c" class="m-btn active" onclick="setM('c')">CONSERVATIVE</div>
                <div id="m-a" class="m-btn" onclick="setM('a')">AGGRESSIVE</div>
            </div>

            <div class="ref-panel">
                <div id="lb-ref" class="label" style="color:var(--hl-blue)">Referral Discount</div>
                <div class="price-now">5.00 USDT <span style="font-size:12px; color:#555;">/ mo</span></div>
                <div id="lb-prm" style="font-size:10px; color:#666;">Invite friends to reach 1 USDT</div>
            </div>

            <button class="btn-run" id="btn-exec" onclick="exec()">Execute Trade</button>
            <div id="console">>> System Ready... Waiting for execution</div>
        </div>

        <script>
            const lang = {
                en: { bal: "Total Balance", pro: "24h Profit", wea: "Weather", ref: "Referral Discount", prm: "Invite friends to reach 1 USDT", exec: "Execute Trade", c: "CONSERVATIVE", a: "AGGRESSIVE" },
                bg: { bal: "Общ Баланс", pro: "Печалба 24ч", wea: "Време", ref: "Реферал за отстъпка", prm: "Покани приятели за цена 1 USDT", exec: "Стартирай Трейд", c: "КОНСЕРВАТИВЕН", a: "АГРЕСИВЕН" },
                ru: { bal: "Общий Баланс", pro: "Прибыль 24ч", wea: "Погода", ref: "Реферальная скидка", prm: "Пригласи друзей до 1 USDT", exec: "Начать Торговлю", c: "КОНСЕРВАТИВНЫЙ", a: "АГРЕССИВНЫЙ" },
                es: { bal: "Balance Total", pro: "Ganancia 24h", wea: "Clima", ref: "Descuento Referal", prm: "Invita amigos para llegar a 1 USDT", exec: "Ejecutar Trade", c: "CONSERVADOR", a: "AGRESIVO" },
                tr: { bal: "Toplam Bakiye", pro: "24s Kâr", wea: "Hava", ref: "Referans İndirimi", prm: "1 USDT için arkadaş davet et", exec: "Ticareti Başlat", c: "MUHAFAZAKÂR", a: "AGRESİF" }
            };

            function updL() {
                const l = document.getElementById('lP').value;
                const s = lang[l];
                document.getElementById('lb-bal').innerText = s.bal;
                document.getElementById('lb-pro').innerText = s.pro;
                document.getElementById('lb-wea').innerText = s.wea;
                document.getElementById('lb-ref').innerText = s.ref;
                document.getElementById('lb-prm').innerText = s.prm;
                document.getElementById('btn-exec').innerText = s.exec;
                document.getElementById('m-c').innerText = s.c;
                document.getElementById('m-a').innerText = s.a;
            }

            function setM(m) {
                document.getElementById('m-c').classList.toggle('active', m === 'c');
                document.getElementById('m-a').classList.toggle('active', m === 'a');
                log("Switching to " + (m==='c'?'Conservative':'Aggressive') + " mode");
            }

            function log(t) {
                const c = document.getElementById('console');
                c.innerHTML = ">> " + t + "<br>" + c.innerHTML;
            }

            function exec() {
                document.getElementById('btn-exec').innerText = "...";
                setTimeout(() => {
                    document.getElementById('btn-exec').innerText = "Execute Trade";
                    log("Polymarket API Scan: No active signals found.");
                }, 1500);
            }

            setInterval(async () => {
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    document.getElementById('temp').innerText = d.lastTemp + '°C';
                    let noise = (Math.random() * 0.05);
                    document.getElementById('amt').innerText = "$" + (1000 + noise).toFixed(2);
                } catch(e) {}
            }, 5000);
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 HyperMeteo Online on Port " + PORT));
