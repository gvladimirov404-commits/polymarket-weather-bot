const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// НАСТРОЙКИ ОТ RAILWAY VARIABLES
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Middleware за четене на JSON данни
app.use(express.json());

// ФУНКЦИЯ ЗА ТЕЛЕГРАМ ИЗВЕСТИЯ
async function sendTelegramAlert(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return console.log("Липсват TG настройки");
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🤖 HyperMeteo Сигнал:\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.error("Грешка при пращане към Телеграм"); }
}

// ЕНДПОЙНТ ЗА ИЗПЪЛНЕНИЕ НА СДЕЛКА
app.post('/execute-trade', async (req, res) => {
    const { mode, lang } = req.body;
    const msg = lang === 'bg' ? `Изпълнение на сделка в режим: ${mode}` : `Executing trade in ${mode} mode`;
    
    await sendTelegramAlert(msg);
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="bg">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>HyperMeteo Master Panel</title>
        <style>
            :root { --green: #00ffa3; --blue: #00a3ff; --bg: #050505; --card: #111111; --text: #ffffff; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; padding: 15px; display: flex; justify-content: center; }
            .panel { width: 100%; max-width: 400px; border: 1px solid #222; border-radius: 16px; padding: 20px; background: #080808; }
            
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .brand { color: var(--green); font-weight: bold; font-size: 14px; letter-spacing: 1px; }
            select { background: #1a1a1a; color: var(--green); border: 1px solid #333; padding: 5px; border-radius: 4px; font-size: 12px; }

            .data-card { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 15px; }
            .label { font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 8px; display: block; }
            .value { font-size: 32px; font-family: monospace; font-weight: bold; color: var(--text); }

            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 20px; }
            .m-btn { padding: 12px 5px; background: #1a1a1a; border: 1px solid #333; color: #555; cursor: pointer; border-radius: 8px; font-size: 10px; font-weight: bold; transition: 0.3s; }
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); box-shadow: 0 0 15px rgba(0,163,255,0.3); }

            .ref-box { background: rgba(0,163,255,0.05); border: 1px dashed var(--blue); padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
            .ref-link { background: #000; padding: 8px; border-radius: 5px; font-size: 10px; color: var(--blue); margin-top: 10px; display: block; border: 1px solid #222; cursor: pointer; }

            .log { background: #000; padding: 12px; height: 100px; border-radius: 8px; font-size: 11px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; font-family: monospace; margin-bottom: 20px; }
            .log-item { margin-bottom: 4px; border-left: 2px solid #222; padding-left: 8px; }

            .btn-exec { width: 100%; padding: 18px; background: var(--green); border: none; border-radius: 10px; font-weight: bold; font-size: 14px; cursor: pointer; color: #000; text-transform: uppercase; }
            .btn-exec:active { transform: scale(0.98); }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO MASTER PANEL</div>
                <select id="lang" onchange="updateLang()">
                    <option value="bg">BG</option>
                    <option value="en">EN</option>
                    <option value="ru">RU</option>
                </select>
            </div>
            
            <div class="data-card">
                <span id="t-bal" class="label">Текущ Баланс (USDC)</span>
                <div class="value">--.--</div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setM(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="ref-box">
                <span id="t-ref" class="label" style="color:var(--blue)">Реферал за отстъпка</span>
                <div class="ref-link" onclick="copyRef()">t.me/HyperMeteoBot?start=user_id</div>
                <div id="t-prm" style="font-size:9px; color:#555; margin-top:5px;">Покани 4 приятели за цена 1 USDT/мес</div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Система готова...</div>
            </div>

            <button id="t-btn" class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ СДЕЛКА СЕГА</button>
        </div>

        <script>
            let currentMode = "Conservative";
            const translations = {
                bg: { bal: "Текущ Баланс (USDC)", ref: "Реферал за отстъпка", prm: "Покани 4 приятели за цена 1 USDT/мес", btn: "ИЗПЪЛНИ СДЕЛКА СЕГА", log: "Режим променен на: " },
                en: { bal: "Current Balance (USDC)", ref: "Referral Discount", prm: "Invite 4 friends for 1 USDT/mo price", btn: "EXECUTE TRADE NOW", log: "Mode changed to: " },
                ru: { bal: "Текущий Баланс (USDC)", ref: "Реферальная скидка", prm: "Пригласи 4 друзей для 1 USDT/мес", btn: "ВЫПОЛНИТЬ СДЕЛКУ", log: "Режим изменен на: " }
            };

            function updateLang() {
                const l = document.getElementById('lang').value;
                const t = translations[l];
                document.getElementById('t-bal').innerText = t.bal;
                document.getElementById('t-ref').innerText = t.ref;
                document.getElementById('t-prm').innerText = t.prm;
                document.getElementById('t-btn').innerText = t.btn;
            }

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                currentMode = modes[n];
                const l = document.getElementById('lang').value;
                addLog(translations[l].log + currentMode);
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                const time = new Date().toLocaleTimeString();
                l.innerHTML = '<div class="log-item">[' + time + '] ' + msg + '</div>' + l.innerHTML;
            }

            function copyRef() {
                alert("Линкът е копиран!");
                addLog("Реферален линк копиран.");
            }

            async function startTrade() {
                const l = document.getElementById('lang').value;
                addLog(l === 'bg' ? "Изпращане към Телеграм..." : "Sending to Telegram...");
                
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ mode: currentMode, lang: l })
                    });
                    if (res.ok) addLog(l === 'bg' ? "УСПЕХ: Сигналът е в Телеграм!" : "SUCCESS: Signal sent!");
                } catch (e) {
                    addLog("Error connecting to server.");
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Master running on port ${PORT}`));
