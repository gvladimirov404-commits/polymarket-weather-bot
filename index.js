const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// КОНФИГУРАЦИЯ (Чете се автоматично от Railway Variables)
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CREATOR_ID = process.env.MY_TELEGRAM_ID;
const FIREBASE_CONFIG = process.env.FIREBASE_CONFIG; // Подготовка за базата данни

app.use(express.json());

// Глобални променливи за динамично управление на капитала в паметта
let currentBalance = 17.00; // Настройваме го директно на твоя нов тестов минимум
let currentBetSize = 1.00;  // Оптималната ставка от 1 долар за този депозит

async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) {
        console.log("Липсват Telegram настройки в променливите.");
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `📊 <b>HyperMeteo Engine</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { 
        console.log("Грешка при изпращане към Telegram API."); 
    }
}

// Връща текущите стойности към интерфейса при поискване
app.get('/get-settings', (req, res) => {
    res.json({ balance: currentBalance.toFixed(2), betSize: currentBetSize.toFixed(2) });
});

// Записва променените стойности от полетата в реално време
app.post('/update-settings', (req, res) => {
    const { balance, betSize } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    res.json({ success: true, balance: currentBalance, betSize: currentBetSize });
});

app.post('/execute-trade', async (req, res) => {
    const { mode, lang, userId } = req.body;
    
    const isAdmin = (userId === "PRESET" || userId === CREATOR_ID);
    const feeStatus = isAdmin ? "FREE (CREATOR)" : "FEE APPLIED";
    const strategy = mode === "Aggressive" ? "High Yield Focus" : (mode === "Balanced" ? "Optimal Spread" : "Safety First");

    const alertMsg = `
🚀 <b>НОВ СИГНАЛ (РЕАЛНО ВРЕМЕ)</b>
<b>Режим:</b> ${mode}
<b>Стратегия:</b> ${strategy}
<b>Настроен депозит:</b> $${currentBalance.toFixed(2)} USDC
<b>Размер на залога:</b> $${currentBetSize.toFixed(2)} USDC
<b>Статус такса:</b> ${feeStatus}
<b>Действие:</b> Изпращане на заявка към Polymarket...`;

    await sendToTelegram(alertMsg);
    res.json({ success: true, currentBalance: currentBalance.toFixed(2) });
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="bg">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            :root { --green: #00ffa3; --blue: #00a3ff; --bg: #050505; --card: #111; --text: #fff; }
            body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 15px; display: flex; justify-content: center; }
            .panel { width: 100%; max-width: 400px; border: 1px solid #222; border-radius: 16px; padding: 20px; background: #080808; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
            
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 1px solid #222; padding-bottom: 10px; }
            .brand { color: var(--green); font-weight: bold; font-size: 14px; letter-spacing: 1px; }
            select { background: #1a1a1a; color: var(--green); border: 1px solid #333; padding: 5px; border-radius: 4px; font-weight: bold; outline: none; }

            .data-card { background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 20px; }
            .label { font-size: 12px; color: #aaa; text-transform: uppercase; margin-bottom: 8px; display: block; font-weight: 500; }
            .value { font-size: 34px; font-family: 'Courier New', monospace; font-weight: bold; color: var(--text); }

            .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
            .input-box { background: var(--card); border: 1px solid #222; padding: 12px; border-radius: 10px; text-align: center; }
            .input-box input { background: #000; border: 1px solid #333; color: var(--green); width: 85%; padding: 8px; text-align: center; border-radius: 6px; font-size: 16px; font-weight: bold; margin-top: 8px; font-family: monospace; }

            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
            .m-btn { padding: 12px 5px; background: #1a1a1a; border: 1px solid #333; color: #777; cursor: pointer; border-radius: 8px; font-size: 10px; font-weight: bold; text-align: center; }
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); box-shadow: 0 4px 12px rgba(0,163,255,0.4); }

            .ref-box { border: 1px dashed #333; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
            .ref-link { background: #000; padding: 10px; border-radius: 6px; font-size: 11px; color: var(--blue); margin-top: 10px; display: block; border: 1px solid #222; text-decoration: none; word-break: break-all; }
            .ref-sub { font-size: 10px; color: #666; margin-top: 5px; display: block; }

            .log { background: #000; padding: 15px; height: 90px; border-radius: 8px; font-size: 12px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; font-family: 'Consolas', monospace; margin-bottom: 20px; }
            .log-item { margin-bottom: 6px; border-left: 3px solid #222; padding-left: 10px; }

            .btn-exec { width: 100%; padding: 20px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 15px; cursor: pointer; color: #000; text-transform: uppercase; letter-spacing: 1px; }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO MASTER PANEL</div>
                <select id="lang" onchange="updateLang()">
                    <option value="bg">BG</option>
                    <option value="ru">RU</option>
                    <option value="en">EN</option>
                </select>
            </div>
            
            <div class="data-card">
                <span id="t-bal" class="label">ТЕКУЩ БАЛАНС (USDC)</span>
                <div class="value" id="balance-display">--.--</div>
            </div>

            <div class="settings-grid">
                <div class="input-box">
                    <span id="lbl-set-bal" class="label" style="font-size:10px; color:#aaa;">ПРОМЕНИ ДЕПОЗИТ</span>
                    <input type="number" id="input-balance" value="17.00" step="5" onchange="saveSettings()">
                </div>
                <div class="input-box">
                    <span id="lbl-set-bet" class="label" style="font-size:10px; color:#aaa;">СТАВКА (ЗАЛОГ)</span>
                    <input type="number" id="input-bet" value="1.00" step="1" onchange="saveSettings()">
                </div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setM(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="ref-box">
                <span id="t-ref" class="label" style="color:var(--blue)">РЕФЕРАЛ ЗА ОТСТЪПКА</span>
                <div class="ref-link">t.me/HyperMeteoBot?start=user_id</div>
                <span id="t-sub" class="ref-sub">Покани 4 приятели за цена 1 USDT/мес</span>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Система готова. Очаквам реални команди...</div>
            </div>

            <button id="t-btn" class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ СДЕЛКА СЕГА</button>
        </div>

        <script>
            let currentMode = "Conservative";
            
            const translations = {
                bg: { 
                    bal: "ТЕКУЩ БАЛАНС (USDC)", setBal: "ПРОМЕНИ ДЕПОЗИТ", setBet: "СТАВКА (ЗАЛОГ)", 
                    ref: "РЕФЕРАЛ ЗА ОТСТЪПКА", sub: "Покани 4 приятели за цена 1 USDT/мес", 
                    btn: "ИЗПЪЛНИ СДЕЛКА СЕГА", logMode: "Режим: ", 
                    logSaved: "Настройките запазени: Ставка $", logSending: "Изпращане на ордер...", logSuccess: "УСПЕХ: Сигналът е подаден."
                },
                ru: { 
                    bal: "ТЕКУЩИЙ БАЛАНС (USDC)", setBal: "ИЗМЕНИТЬ ДЕПОЗИТ", setBet: "СТАВКА (ОБЪЕМ)", 
                    ref: "РЕФЕРАЛ ДЛЯ СКИДКИ", sub: "Пригласи 4 друзей за цену 1 USDT/мес", 
                    btn: "ВЫПОЛНИТЬ СДЕЛКУ СЕЙЧАС", logMode: "Режим: ", 
                    logSaved: "Настройки сохранены: Ставка $", logSending: "Отправка ордера...", logSuccess: "УСПЕШНО: Сигнал отправлен."
                },
                en: { 
                    bal: "CURRENT BALANCE (USDC)", setBal: "EDIT DEPOSIT", setBet: "BET SIZE (VOLUME)", 
                    ref: "REFERRAL DISCOUNT", sub: "Invite 4 friends for 1 USDT/month", 
                    btn: "EXECUTE TRADE NOW", logMode: "Mode: ", 
                    logSaved: "Settings saved: Bet size $", logSending: "Sending order...", logSuccess: "SUCCESS: Signal deployed."
                }
            };

            // Синхронизира данните от паметта на сървъра веднага при отваряне
            async function loadInitialSettings() {
                try {
                    const res = await fetch('/get-settings');
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('balance-display').innerText = data.balance;
                        document.getElementById('input-balance').value = data.balance;
                        document.getElementById('input-bet').value = data.betSize;
                    }
                } catch(e) { console.log("Error loading initial settings."); }
                updateLang();
            }

            function updateLang() {
                const l = document.getElementById('lang').value;
                document.getElementById('t-bal').innerText = translations[l].bal;
                document.getElementById('lbl-set-bal').innerText = translations[l].setBal;
                document.getElementById('lbl-set-bet').innerText = translations[l].setBet;
                document.getElementById('t-ref').innerText = translations[l].ref;
                document.getElementById('t-sub').innerText = translations[l].sub;
                document.getElementById('t-btn').innerText = translations[l].btn;
            }

            async function saveSettings() {
                const bal = document.getElementById('input-balance').value;
                const bet = document.getElementById('input-bet').value;
                const l = document.getElementById('lang').value;
                
                try {
                    const res = await fetch('/update-settings', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ balance: bal, betSize: bet })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('balance-display').innerText = parseFloat(data.balance).toFixed(2);
                        addLog(translations[l].logSaved + parseFloat(data.betSize).toFixed(2));
                    }
                } catch(e) { addLog("Error saving settings."); }
            }

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                currentMode = modes[n];
                const l = document.getElementById('lang').value;
                addLog(translations[l].logMode + currentMode);
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = '<div class="log-item">[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + l.innerHTML;
            }

            async function startTrade() {
                const l = document.getElementById('lang').value;
                addLog(translations[l].logSending);
                
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ mode: currentMode, lang: l, userId: "PRESET" })
                    });
                    if (res.ok) addLog(translations[l].logSuccess);
                } catch (e) { addLog("Connection error."); }
            }

            // Стартира автоматичното зареждане веднага след като страницата се отвори
            window.onload = loadInitialSettings;
        </script>
    </body>
    </html>
    `);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(PORT, () => console.log(`HyperMeteo Engine running on port ${PORT}`));
  
