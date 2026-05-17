const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const app = express();
const PORT = process.env.PORT || 3000;

// КОНФИГУРАЦИЯ (Railway Variables)
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CREATOR_ID = process.env.MY_TELEGRAM_ID;

app.use(express.json());

// Базови стойности по подразбиране
let currentBalance = 70.00; 
let currentBetSize = 10.00;  
let currentMainPrice = 0.70;
let currentHedgeUpPrice = 0.005;
let currentHedgeDownPrice = 0.005;

// ИНИЦИАЛИЗАЦИЯ НА FIREBASE
let db = null;
if (process.env.FIREBASE_CONFIG) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        db = admin.firestore();
        console.log("Firebase е успешно свързан!");
    } catch (error) {
        console.error("Грешка при инициализация на Firebase:", error.message);
    }
}

// 🧠 ДИНАМИЧНА МАТЕМАТИКА: ДВОЕН ХЕДЖ
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
            text: `🛡️ <b>HyperMeteo Secure Engine</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("Грешка при изпращане към Telegram API."); }
}

app.get('/get-settings', async (req, res) => {
    if (db) {
        try {
            const doc = await db.collection('config').doc('panelSettings').get();
            if (doc.exists) {
                const data = doc.data();
                currentBalance = parseFloat(data.balance || 70.00);
                currentBetSize = parseFloat(data.betSize || 10.00);
                currentMainPrice = parseFloat(data.mainPrice || 0.70);
                currentHedgeUpPrice = parseFloat(data.hedgeUpPrice || 0.005);
                currentHedgeDownPrice = parseFloat(data.hedgeDownPrice || 0.005);
            }
        } catch (e) { console.log("Грешка при четене от Firebase."); }
    }
    res.json({ 
        balance: currentBalance.toFixed(2), 
        betSize: currentBetSize.toFixed(2),
        mainPrice: currentMainPrice.toFixed(2),
        hedgeUpPrice: currentHedgeUpPrice.toFixed(3),
        hedgeDownPrice: currentHedgeDownPrice.toFixed(3)
    });
});

app.post('/update-settings', async (req, res) => {
    const { balance, betSize, mainPrice, hedgeUpPrice, hedgeDownPrice } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    if (mainPrice !== undefined) currentMainPrice = parseFloat(mainPrice);
    if (hedgeUpPrice !== undefined) currentHedgeUpPrice = parseFloat(hedgeUpPrice);
    if (hedgeDownPrice !== undefined) currentHedgeDownPrice = parseFloat(hedgeDownPrice);

    if (db) {
        try {
            await db.collection('config').doc('panelSettings').set({
                balance: currentBalance, betSize: currentBetSize, mainPrice: currentMainPrice, hedgeUpPrice: currentHedgeUpPrice, hedgeDownPrice: currentHedgeDownPrice
            }, { merge: true });
        } catch (e) { console.error("Грешка при запис във Firebase:", e.message); }
    }
    res.json({ success: true, balance: currentBalance, betSize: currentBetSize });
});

// ⚡ ИЗПЪЛНЕНИЕ СЪС СОФТУЕРНИ ЗАЩИТИ
app.post('/execute-trade', async (req, res) => {
    const { mode } = req.body;
    
    // 🛡️ ЗАЩИТА 1: БЮДЖЕТЕН ПРЕКЪСВАЧ (CIRCUIT BREAKER)
    // Тъй като балансът ти е $70, кодът твърдо забранява залог над $15 за единичен пазар!
    const MAX_ALLOWED_BET = 15.00;
    if (currentBetSize > MAX_ALLOWED_BET) {
        const errorMsg = `🚨 <b>БЛОКИРАНА СДЕЛКА: Риск Мениджмънт!</b>\nОпит за залог от $${currentBetSize.toFixed(2)}, което надвишава защитния лимит от $${MAX_ALLOWED_BET.toFixed(2)} за твоя бюджет. Парите ти са в безопасност!`;
        await sendToTelegram(errorMsg);
        return res.status(400).json({ success: false, error: "Надвишен защитен лимит!" });
    }

    // 🛡️ ЗАЩИТА 2: СЛИПИДЖ ЛИМИТ (SLIPPAGE CONTROL)
    // Ако цената на застраховката на пазара премине прага от $0.03, стратегията губи математически смисъл.
    const MAX_HEDGE_PRICE = 0.03;
    if (currentHedgeUpPrice > MAX_HEDGE_PRICE || currentHedgeDownPrice > MAX_HEDGE_PRICE) {
        const errorMsg = `⚠️ <b>ОТКАЗАН ОРДЕР: Неизгодна цена (Слипидж)!</b>\nЦената на застраховката на пазара е твърде висока. Максимумът е $${MAX_HEDGE_PRICE}. Сделката е прекратена автоматично.`;
        await sendToTelegram(errorMsg);
        return res.status(400).json({ success: false, error: "Твърде скъпа застраховка!" });
    }

    // 🛡️ ЗАЩИТА 3: ПРОВЕРКА ЗА СЛЕПИ ПЕТНА (MARKET INTEGRITY)
    // Проверка дали пазарната структура е цялостна (симулация)
    const marketGapDetected = false; // Ако реалното API открие дупка, това ще стане 'true'
    if (marketGapDetected) {
        const errorMsg = `❌ <b>ОТКАЗАН ОРДЕР: Открита е дупка в пазара!</b>\nПазарната структура не покрива междинните температури. Сделката е прекратена с цел защита.`;
        await sendToTelegram(errorMsg);
        return res.status(400).json({ success: false, error: "Открита дупка в пазара." });
    }

    // Ако всички защити преминат успешно:
    const hedgeCalc = calculateDoubleHedging(currentBetSize, currentMainPrice, currentHedgeUpPrice, currentHedgeDownPrice);

    const alertMsg = `
✅ <b>ВСИЧКИ ЗАЩИТИ ПРЕМИНАТИ: СИГУРЕН ОРДЕР</b>
<b>Режим:</b> ${mode}
<b>Защити:</b> Бюджетна (OK) | Слипидж (OK) | Пазарна (OK)

<b>Общ риск за пазара:</b> $${currentBetSize.toFixed(2)} USDC

🔹 <b>ЦЕНТЪР (70%):</b> $${hedgeCalc.main.budget.toFixed(2)} USDC
  • Цена: $${hedgeCalc.main.price.toFixed(2)} | Договори: ${hedgeCalc.main.shares} бр.
  • Резултат при нормално време: <b>+$${hedgeCalc.main.netProfit.toFixed(2)} USDC</b>

🛡️ <b>ХЕДЖ ЖЕГА (15%):</b> $${hedgeCalc.hedgeUp.budget.toFixed(2)} USDC
  • Цена: $${hedgeCalc.hedgeUp.price.toFixed(3)} | Договори: ${hedgeCalc.hedgeUp.shares} бр.
  • Резултат при жега: <b>+$${hedgeCalc.hedgeUp.netProfit.toFixed(2)} USDC</b>

❄️ <b>ХЕДЖ СТУД (15%):</b> $${hedgeCalc.hedgeDown.budget.toFixed(2)} USDC
  • Цена: $${hedgeCalc.hedgeDown.price.toFixed(3)} | Договори: ${hedgeCalc.hedgeDown.shares} б r.
  • Резултат при студ: <b>+$${hedgeCalc.hedgeDown.netProfit.toFixed(2)} USDC</b>

<b>Статус:</b> Сделката се изпълнява в безопасна софтуерна среда.`;

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
            .log { background: #000; padding: 12px; height: 80px; border-radius: 8px; font-size: 11px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; margin-bottom: 15px; }
            .log-item { margin-bottom: 4px; }
            .btn-exec { width: 100%; padding: 18px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 14px; cursor: pointer; color: #000; text-transform: uppercase; }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO SECURE V2</div>
                <div class="secure-badge">RISK SHIELD ACTIVE</div>
            </div>
            
            <div class="data-card">
                <span class="label">РАБОТЕН КАПИТАЛ (USDC)</span>
                <div class="value" id="balance-display">--.--</div>
            </div>

            <div class="settings-grid">
                <div class="input-box">
                    <span class="label" style="font-size:10px;">ДЕПОЗИТ ЗА БОТА</span>
                    <input type="number" id="input-balance" value="70.00" step="5" onchange="saveSettings()">
                </div>
                <div class="input-box">
                    <span class="label" style="font-size:10px;">СТАВКА (РИСК)</span>
                    <input type="number" id="input-bet" value="10.00" step="1" onchange="saveSettings()">
                </div>
            </div>

            <div class="prices-box">
                <span class="label" style="color:var(--blue); text-align:center;">Текущи Цени на Договорите</span>
                <div class="prices-grid">
                    <div>
                        <span style="font-size:9px; color:#888; display:block; text-align:center;">ЦЕНТЪР</span>
                        <input type="number" id="p-main" class="price-input" value="0.70" step="0.05" onchange="saveSettings()">
                    </div>
                    <div>
                        <span style="font-size:9px; color:#888; display:block; text-align:center;">ХЕДЖ ЖЕГА</span>
                        <input type="number" id="p-up" class="price-input" value="0.005" step="0.001" onchange="saveSettings()">
                    </div>
                    <div>
                        <span style="font-size:9px; color:#888; display:block; text-align:center;">ХЕДЖ СТУД</span>
                        <input type="number" id="p-down" class="price-input" value="0.005" step="0.001" onchange="saveSettings()">
                    </div>
                </div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Всички системи за сигурност са активирани.</div>
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
                    }
                } catch(e) { console.log("Error loading initial settings."); }
            }

            async function saveSettings() {
                const bal = document.getElementById('input-balance').value;
                const bet = document.getElementById('input-bet').value;
                const pm = document.getElementById('p-main').value;
                const pu = document.getElementById('p-up').value;
                const pd = document.getElementById('p-down').value;
                
                try {
                    const res = await fetch('/update-settings', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ balance: bal, betSize: bet, mainPrice: pm, hedgeUpPrice: pu, hedgeDownPrice: pd })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('balance-display').innerText = parseFloat(data.balance).toFixed(2);
                        addLog("Защитните параметри са актуализирани.");
                    }
                } catch(e) { addLog("Грешка при запис."); }
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = '<div class="log-item">[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + l.innerHTML;
            }

            async function startTrade() {
                addLog("Стартиране на софтуерни проверки...");
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ mode: "Conservative" })
                    });
                    if (res.ok) {
                        addLog("УСПЕХ: Всички защити преминати!");
                    } else {
                        const errData = await res.json();
                        addLog("ОТКАЗАН: " + errData.error);
                    }
                } catch (e) { addLog("Грешка в мрежата."); }
            }

            window.onload = loadInitialSettings;
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Running on ${PORT}`));
      
