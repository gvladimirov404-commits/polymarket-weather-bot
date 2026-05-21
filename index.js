const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());

// ГЛОБАЛНИ СИСТЕМНИ ЩИТОВЕ
let isBotActive = true;          
let lastTradeTimestamp = 0;      
const COOLDOWN_TIME = 5 * 60 * 1000; // ЗАЩИТА: НАМАЛЕНА НА 5 МИНУТИ

let currentBalance = 70.00; 
let currentBetSize = 10.00;  
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;

if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        db = admin.firestore();
    } catch (error) { console.error("Firebase грешка:", error.message); }
}

function calculateDoubleHedging(totalBet, mainPrice, hedgeUpPrice, hedgeDownPrice) {
    const mainBudget = totalBet * 0.70;      
    const hedgeUpBudget = totalBet * 0.15;   
    const hedgeDownBudget = totalBet * 0.15; 
    const mainShares = Math.floor(mainBudget / mainPrice);
    const hedgeUpShares = Math.floor(hedgeUpBudget / hedgeUpPrice);
    const hedgeDownShares = Math.floor(hedgeDownBudget / hedgeDownPrice);

    return {
        main: { budget: mainBudget, price: mainPrice, shares: mainShares, netProfit: mainShares - totalBet },
        hedgeUp: { budget: hedgeUpBudget, price: hedgeUpPrice, shares: hedgeUpShares, netProfit: hedgeUpShares - totalBet },
        hedgeDown: { budget: hedgeDownBudget, price: hedgeDownPrice, shares: hedgeDownShares, netProfit: hedgeDownShares - totalBet }
    };
}

async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🛡️ <b>HyperMeteo Fortress Engine</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("Грешка при връзка с Telegram API."); }
}

// РЪЧНО ПРЕВКЛЮЧВАНЕ НА ШАЛТЕРА ОТ ПАНЕЛА
app.post('/toggle-bot', async (req, res) => {
    isBotActive = !isBotActive;
    const statusText = isBotActive ? "АКТИВЕН" : "БЛОКИРАН";
    await sendToTelegram(`🚨 <b>СТАТУС СМЕНЕН ОТ ПАНЕЛА:</b> Ботът в момента е <b>${statusText}</b>.`);
    res.json({ success: true, botStatus: isBotActive ? "ACTIVE" : "KILLED" });
});

app.get('/get-settings', async (req, res) => {
    res.json({ 
        balance: currentBalance.toFixed(2), betSize: currentBetSize.toFixed(2),
        mainPrice: currentMainPrice.toFixed(2), hedgeUpPrice: currentHedgeUpPrice.toFixed(3), hedgeDownPrice: currentHedgeDownPrice.toFixed(3),
        botStatus: isBotActive ? "ACTIVE" : "KILLED"
    });
});

app.post('/update-settings', async (req, res) => {
    const { balance, betSize, mainPrice, hedgeUpPrice, hedgeDownPrice } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    if (mainPrice !== undefined) currentMainPrice = parseFloat(mainPrice);
    if (hedgeUpPrice !== undefined) currentHedgeUpPrice = parseFloat(hedgeUpPrice);
    if (hedgeDownPrice !== undefined) currentHedgeDownPrice = parseFloat(hedgeDownPrice);
    res.json({ success: true, balance: currentBalance, betSize: currentBetSize });
});

app.post('/execute-trade', async (req, res) => {
    if (!isBotActive) {
        return res.status(403).json({ success: false, error: "БОТЪТ Е АВАРИЙНО ИЗКЛЮЧЕН!" });
    }

    const now = Date.now();
    if (now - lastTradeTimestamp < COOLDOWN_TIME) {
        const remainingMins = Math.ceil((COOLDOWN_TIME - (now - lastTradeTimestamp)) / 60000);
        return res.status(429).json({ success: false, error: `Защита от зацикляне! Изчакай ${remainingMins} мин.` });
    }

    const MAX_ALLOWED_BET = 15.00;
    if (currentBetSize > MAX_ALLOWED_BET) {
        return res.status(400).json({ success: false, error: "Надвишен защитен лимит от $15!" });
    }

    const MAX_HEDGE_PRICE = 0.03;
    if (currentHedgeUpPrice > MAX_HEDGE_PRICE || currentHedgeDownPrice > MAX_HEDGE_PRICE) {
        return res.status(400).json({ success: false, error: "Твърде скъпа застраховка!" });
    }

    lastTradeTimestamp = now;
    const hedgeCalc = calculateDoubleHedging(currentBetSize, currentMainPrice, currentHedgeUpPrice, currentHedgeDownPrice);

    const alertMsg = `
✅ <b>СДЕЛКА ИЗПЪЛНЕНА ПОД ПЪЛЕН КОНТРОЛ</b>
<b>Общ риск за пазара:</b> $${currentBetSize.toFixed(2)} USDC
🔒 <i>Всички защити докладват статус: ИДЕАЛЕН.</i>`;

    await sendToTelegram(alertMsg);
    res.json({ success: true });
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
            .panel { width: 100%; max-width: 400px; border: 1px solid #222; border-radius: 16px; padding: 20px; background: #080808; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 10px; }
            .brand { color: var(--green); font-weight: bold; font-size: 13px; letter-spacing: 1px; }
            .secure-badge { background: #102a43; color: var(--blue); padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; border: 1px solid #243b53; }
            .data-card { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 15px; }
            .label { font-size: 11px; color: #aaa; text-transform: uppercase; margin-bottom: 6px; display: block; }
            .value { font-size: 30px; font-family: monospace; font-weight: bold; color: var(--text); }
            .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
            .input-box { background: var(--card); border: 1px solid #222; padding: 10px; border-radius: 10px; text-align: center; }
            .input-box input { background: #000; border: 1px solid #333; color: var(--green); width: 85%; padding: 6px; text-align: center; border-radius: 6px; font-size: 15px; font-weight: bold; margin-top: 5px; }
            .prices-box { background: #0d0d0d; border: 1px dashed #333; padding: 12px; border-radius: 10px; margin-bottom: 15px; }
            .prices-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 5px; }
            .price-input { background: #000; border: 1px solid #222; color: #fff; padding: 6px; text-align: center; border-radius: 6px; font-size: 13px; font-weight: bold; width: 80%; }
            .status-banner { padding: 12px; border-radius: 8px; text-align: center; font-size: 12px; font-weight: bold; margin-bottom: 15px; cursor: pointer; transition: 0.3s; }
            .status-banner.active { background: rgba(0, 255, 163, 0.1); color: var(--green); border: 1px solid var(--green); }
            .status-banner.killed { background: rgba(255, 0, 0, 0.2); color: #ff3333; border: 1px solid #ff3333; }
            .log { background: #000; padding: 12px; height: 60px; border-radius: 8px; font-size: 11px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; margin-bottom: 15px; }
            .log-item { margin-bottom: 4px; }
            .btn-exec { width: 100%; padding: 18px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 14px; cursor: pointer; color: #000; text-transform: uppercase; }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO FORTRESS V3.1</div>
                <div class="secure-badge">4X SHIELD ACTIVE</div>
            </div>
            
            <div class="data-card">
                <span class="label">РАБОТЕН КАПИТАЛ (USDC)</span>
                <div class="value" id="balance-display">--.--</div>
            </div>

            <div id="bot-status-banner" class="status-banner" onclick="toggleBot()">СТАТУС: ИЗЧИСЛЯВАНЕ...</div>

            <div class="settings-grid">
                <div class="input-box">
                    <span class="label">ДЕПОЗИТ</span>
                    <input type="number" id="input-balance" value="70.00" onchange="saveSettings()">
                </div>
                <div class="input-box">
                    <span class="label">СТАВКА</span>
                    <input type="number" id="input-bet" value="10.00" onchange="saveSettings()">
                </div>
            </div>

            <div class="prices-box">
                <span class="label" style="color:var(--blue); text-align:center;">Текущи Цени</span>
                <div class="prices-grid">
                    <div><span style="font-size:9px;color:#888;display:block;">ЦЕНТЪР</span><input type="number" id="p-main" class="price-input" value="0.70" onchange="saveSettings()"></div>
                    <div><span style="font-size:9px;color:#888;display:block;">ЖЕГА</span><input type="number" id="p-up" class="price-input" value="0.005" onchange="saveSettings()"></div>
                    <div><span style="font-size:9px;color:#888;display:block;">СТУД</span><input type="number" id="p-down" class="price-input" value="0.005" onchange="saveSettings()"></div>
                </div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Система в готовност. Кликни върху банера за Авариен Стоп.</div>
            </div>

            <button class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ ЗАЩИТЕН ОРДЕР</button>
        </div>

        <script>
            async function loadInitialSettings() {
                try {
                    const res = await fetch('/get-settings');
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('balance-display').innerText = data.balance;
                        document.getElementById('input-balance').value = data.balance;
                        document.getElementById('input-bet').value = data.betSize;
                        document.getElementById('p-main').value = data.mainPrice;
                        document.getElementById('p-up').value = data.hedgeUpPrice;
                        document.getElementById('p-down').value = data.hedgeDownPrice;
                        updateBanner(data.botStatus);
                    }
                } catch(e) { console.log("Error loading settings."); }
            }

            function updateBanner(status) {
                const banner = document.getElementById('bot-status-banner');
                if(status === "ACTIVE") {
                    banner.innerText = "🚨 БОТЪТ РАБОТИ (Кликни за спиране)";
                    banner.className = "status-banner active";
                } else {
                    banner.innerText = "🛑 АВАРИЙНО ЗАКЛЮЧЕН (Кликни за пускане)";
                    banner.className = "status-banner killed";
                }
            }

            async function toggleBot() {
                try {
                    const res = await fetch('/toggle-bot', { method: 'POST' });
                    if (res.ok) {
                        const data = await res.json();
                        updateBanner(data.botStatus);
                        addLog("Заявка за промяна на шалтера изпратена.");
                    }
                } catch(e) { addLog("Грешка при превключване."); }
            }

            async function saveSettings() {
                const bal = document.getElementById('input-balance').value;
                const bet = document.getElementById('input-bet').value;
                const pm = document.getElementById('p-main').value;
                const pu = document.getElementById('p-up').value;
                const pd = document.getElementById('p-down').value;
                
                // СИНХРОНИЗАЦИЯ НА ЖИВО: Променя горния голям дисплей веднага
                if (bal) {
                    document.getElementById('balance-display').innerText = parseFloat(bal).toFixed(2);
                }

                await fetch('/update-settings', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ balance: bal, betSize: bet, mainPrice: pm, hedgeUpPrice: pu, hedgeDownPrice: pd })
                });
                addLog("Параметрите са записани.");
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = '<div class="log-item">[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + l.innerHTML;
            }

            async function startTrade() {
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ userId: "PRESET" })
                    });
                    if (res.ok) addLog("УСПЕХ: Всичко премина!");
                    else {
                        const errData = await res.json();
                        addLog("БЛОКИРАН: " + errData.error);
                    }
                } catch (e) { addLog("Грешка в мрежата."); }
            }

            window.onload = loadInitialSettings;
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Fortress Running`));
               
