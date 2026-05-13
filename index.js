const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// FIREBASE INITIALIZATION
try {
    if (process.env.FIREBASE_CONFIG) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
} catch (e) { console.log("Firebase Error: " + e.message); }

const db = admin.apps.length ? admin.firestore() : null;

// API ENDPOINT
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

// MAIN INTERFACE
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            :root { --hl-green: #00ffa3; --hl-blue: #00a3ff; --hl-red: #ff4444; --bg: #050505; --card: #0d0d0d; }
            body { background: var(--bg); color: #e0e0e0; font-family: 'Inter', sans-serif; margin: 0; padding: 10px; display: flex; justify-content: center; }
            .terminal { width: 100%; max-width: 400px; background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 16px; padding: 15px; box-shadow: 0 20px 60px rgba(0,0,0,0.8); }
            
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
            .brand { color: var(--hl-green); font-weight: bold; letter-spacing: 1px; font-size: 13px; }
            .lang-sel { background: #111; color: var(--hl-green); border: 1px solid #222; border-radius: 4px; font-size: 11px; padding: 3px; }

            .display-card { text-align: center; margin-bottom: 15px; padding: 20px; background: var(--card); border-radius: 12px; border: 1px solid #1a1a1a; position: relative; overflow: hidden; }
            .amount { font-size: 40px; font-family: 'Roboto Mono', monospace; color: var(--hl-green); font-weight: bold; transition: 0.5s; }
            
            .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .stat-box { background: var(--card); padding: 12px; border-radius: 10px; border: 1px solid #1a1a1a; }
            .stat-val { font-family: 'Roboto Mono', monospace; font-size: 16px; color: #fff; margin-top: 5px; }

            .mode-switch { display: flex; background: #111; padding: 3px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #222; }
            .m-btn { flex: 1; padding: 8px; text-align: center; font-size: 10px; font-weight: bold; cursor: pointer; border-radius: 6px; color: #444; }
            .m-btn.active { background: var(--hl-blue); color: #fff; }

            /* REFERRAL SYSTEM */
            .ref-panel { background: rgba(0, 163, 255, 0.03); border: 1px dashed #222; padding: 12px; border-radius: 10px; margin-bottom: 15px; text-align: center; }
            .ref-link { background: #000; border: 1px solid #222; padding: 8px; border-radius: 5px; font-size: 10px; color: var(--hl-blue); margin: 8px 0; cursor: pointer; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

            /* TRADE LOG */
            .log-container { background: #070707; border-radius: 8px; padding: 10px; height: 80px; overflow-y: hidden; font-family: 'Roboto Mono', monospace; font-size: 9px; color: #444; border: 1px solid #111; margin-bottom: 15px; }
            .log-entry { margin-bottom: 4px; border-left: 2px solid #222; padding-left: 5px; }

            .btn-run { width: 100%; padding: 15px; border: none; border-radius: 8px; background: var(--hl-green); color: #000; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 12px; box-shadow: 0 4px 15px rgba(0,255,163,0.1); }
        </style>
    </head>
    <body>
        <div class="terminal">
            <div class="header">
                <div class="brand">HYPERMETEO GLOBAL</div>
                <select class="lang-sel" id="lP" onchange="updL()">
                    <option value="en">EN</option><option value="bg">BG</option><option value="ru">RU</option>
                </select>
            </div>

            <div class="display-card">
                <div id="lb-bal" style="font-size:10px; color:#555; text-transform:uppercase;">Account Value</div>
                <div class="amount" id="amt">$1,000.00</div>
            </div>

            <div class="stats">
                <div class="stat-box">
                    <div id="lb-pro" style="font-size:9px; color:#555; text-transform:uppercase;">24h Profit</div>
                    <div class="stat-val" id="val-pro" style="color:var(--hl-green)">+$50.00</div>
                </div>
                <div class="stat-box">
                    <div id="lb-wea" style="font-size:9px; color:#555; text-transform:uppercase;">Weather</div>
                    <div class="stat-val" id="temp">--°C</div>
                </div>
            </div>

            <div class="mode-switch">
                <div id="m-c" class="m-btn active" onclick="setM('c')">CONSERVATIVE</div>
                <div id="m-a" class="m-btn" onclick="setM('a')">AGGRESSIVE</div>
            </div>

            <div class="ref-panel">
                <div id="lb-ref" style="font-size:10px; color:var(--hl-blue); font-weight:bold;">REFERRAL PROGRAM</div>
                <div class="ref-link" onclick="copyRef()">t.me/HyperMeteoBot?start=user_id</div>
                <div id="lb-prm" style="font-size:9px; color:#555;">Invite 4 friends to reach 1 USDT/mo price</div>
            </div>

            <div class="log-container" id="log">
                <div class="log-entry">>> System initialized. Verifying API keys...</div>
                <div class="log-entry">>> Awaiting market signals from Polymarket...</div>
            </div>

            <button class="btn-run" id="btn-exec" onclick="exec()">Execute Trade</button>
        </div>

        <script>
            const lang = {
                en: { bal: "Account Value", pro: "24h Profit", wea: "Weather", ref: "Referral Program", prm: "Invite 4 friends to reach 1 USDT/mo price", exec: "Execute Trade", c: "CONSERVATIVE", a: "AGGRESSIVE", msg: "Scanning market..." },
                bg: { bal: "Общ Баланс", pro: "Печалба 24ч", wea: "Време", ref: "Реферална Програма", prm: "Покани 4 приятели за цена 1 USDT/мес", exec: "Стартирай Трейд", c: "КОНСЕРВАТИВЕН", a: "АГРЕСИВЕН", msg: "Сканиране на пазара..." },
                ru: { bal: "Общий Баланс", pro: "Прибыль 24ч", wea: "Погода", ref: "Реферальная Программа", prm: "Пригласи 4 друзей для цены 1 USDT/мес", exec: "Начать Торговлю", c: "КОНСЕРВАТИВНЫЙ", a: "АГРЕССИВНЫЙ", msg: "Сканирование рынка..." }
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
                addLog("Mode switched to " + (m==='c'?'Conservative':'Aggressive'));
            }

            function addLog(txt) {
                const l = document.getElementById('log');
                const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                l.innerHTML = '<div class="log-entry">[' + time + '] >> ' + txt + '</div>' + l.innerHTML;
            }

            function copyRef() {
                alert("Link copied to clipboard!");
                addLog("Referral link copied.");
            }

            function exec() {
                const l = document.getElementById('lP').value;
                document.getElementById('btn-exec').innerText = lang[l].msg;
                setTimeout(() => {
                    document.getElementById('btn-exec').innerText = lang[l].exec;
                    addLog("Polymarket Scan: Analysis complete. No high-conf signals.");
                }, 2000);
            }

            // LIVE NUMBERS ANIMATION
            setInterval(() => {
                let noise = (Math.random() * 0.08);
                document.getElementById('amt').innerText = "$" + (1000 + noise).toFixed(2);
                if(Math.random() > 0.8) addLog("Heartbeat: API connection stable.");
            }, 4000);

            setInterval(async () => {
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    document.getElementById('temp').innerText = d.lastTemp + '°C';
                } catch(e) {}
            }, 10000);
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log("🚀 HyperMeteo Terminal Live"));
             
