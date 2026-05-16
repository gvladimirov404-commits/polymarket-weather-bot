const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CREATOR_ID = process.env.MY_TELEGRAM_ID;

app.use(express.json());

// Глобални променливи за настройките (започват с твоите 70$)
let currentBalance = 70.00;
let currentBetSize = 5.00; // Ставка по подразбиране: 5$ на сделка

async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `📊 <b>HyperMeteo Engine</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("TG Error"); }
}

// Ендпоинт за взимане на текущите настройки
app.get('/get-settings', (req, res) => {
    res.json({ balance: currentBalance.toFixed(2), betSize: currentBetSize.toFixed(2) });
});

// Ендпоинт за обновяване на настройките от интерфейса
app.post('/update-settings', (req, res) => {
    const { balance, betSize } = req.body;
    if (balance !== undefined) currentBalance = parseFloat(balance);
    if (betSize !== undefined) currentBetSize = parseFloat(betSize);
    res.json({ success: true, balance: currentBalance, betSize: currentBetSize });
});

app.post('/execute-trade', async (req, res) => {
    const { mode, lang, userId } = req.body;
    
    const isAdmin = (userId === CREATOR_ID);
    const feeStatus = isAdmin ? "FREE (CREATOR)" : "FEE APPLIED";
    const strategy = mode === "Aggressive" ? "High Yield Focus" : (mode === "Balanced" ? "Optimal Spread" : "Safety First");

    // Тук ботът вече използва динамичната ставка 'currentBetSize' вместо твърдо число!
    const alertMsg = `
🚀 <b>НОВ СИГНАЛ (РЕАЛНО ВРЕМЕ)</b>
<b>Режим:</b> ${mode}
<b>Стратегия:</b> ${strategy}
<b>Текущ лимит бюджет:</b> $${currentBalance.toFixed(2)} USDC
<b>Размер на залога (Ставка):</b> $${currentBetSize.toFixed(2)} USDC
<b>Статус такса:</b> ${feeStatus}
<b>Действие:</b> Изпращане на ордер към Polymarket...`;

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

            .data-card { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 20px; }
            .label { font-size: 12px; color: #aaa; text-transform: uppercase; margin-bottom: 8px; display: block; font-weight: 500; }
            .value { font-size: 32px; font-family: 'Courier New', monospace; font-weight: bold; color: var(--text); }

            .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
            .input-box { background: var(--card); border: 1px solid #222; padding: 12px; border-radius: 10px; text-align: center; }
            .input-box input { background: #000; border: 1px solid #333; color: var(--green); width: 80%; padding: 8px; text-align: center; border-radius: 6px; font-size: 16px; font-weight: bold; margin-top: 5px; font-family: monospace; }

            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
            .m-btn { padding: 12px 5px; background: #1a1a1a; border: 1px solid #333; color: #777; cursor: pointer; border-radius: 8px; font-size: 10px; font-weight: bold; text-align: center; }
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); box-shadow: 0 4px 12px rgba(0,163,255,0.4); }

            .log { background: #000; padding: 15px; height: 90px; border-radius: 8px; font-size: 12px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; font-family: 'Consolas', monospace; margin-bottom: 20px; }
            .log-item { margin-bottom: 6px; border-left: 3px solid #222; padding-left: 10px; }

            .btn-exec { width: 100%; padding: 20px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 15px; cursor: pointer; color: #000; text-transform: uppercase; letter-spacing: 1px; }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO CONFIG PANEL</div>
            </div>
            
            <div class="data-card">
                <span class="label">РАЗПОЛАГАЕМ ДЕПОЗИТ (USDC)</span>
                <div class="value" id="balance-display">70.00</div>
            </div>

            <div class="settings-grid">
                <div class="input-box">
                    <span class="label" style="font-size:10px;">ПРОМЕНИ БАЛАНС</span>
                    <input type="number" id="input-balance" value="70.00" step="5" onchange="saveSettings()">
                </div>
                <div class="input-box">
                    <span class="label" style="font-size:10px;">СТАВКА (ЕД. ЗАЛОГ)</span>
                    <input type="number" id="input-bet" value="5.00" step="1" onchange="saveSettings()">
                </div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setM(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Настройките са заредени успешно.</div>
            </div>

            <button class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ СДЕЛКА СЕГА</button>
        </div>

        <script>
            let currentMode = "Conservative";

            // Функция, която изпраща въведените цифри от екрана към сървъра
            async function saveSettings() {
                const bal = document.getElementById('input-balance').value;
                const bet = document.getElementById('input-bet').value;
                
                try {
                    const res = await fetch('/update-settings', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ balance: bal, betSize: bet })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('balance-display').innerText = parseFloat(data.balance).toFixed(2);
                        addLog("Настройките запазени: Ставка $" + parseFloat(data.betSize).toFixed(2));
                    }
                } catch(e) { addLog("Грешка при запазване."); }
            }

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                currentMode = modes[n];
                addLog("Режим: " + currentMode);
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = '<div class="log-item">[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + l.innerHTML;
            }

            async function startTrade() {
                addLog("Изпращане на ордер...");
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ mode: currentMode })
                    });
                    if (res.ok) addLog("УСПЕХ: Данните са подадени.");
                } catch (e) { addLog("Грешка при връзка."); }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Engine running`));
              
