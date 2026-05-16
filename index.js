const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// КОНФИГУРАЦИЯ (Въведи своите данни в Railway Variables)
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CREATOR_ID = process.env.MY_TELEGRAM_ID;

app.use(express.json());

async function sendToTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `📊 <b>HyperMeteo Backtester</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log("TG Error"); }
}

// ИСТОРИЧЕСКИ ДАННИ ЗА АПРИЛ
const aprilHistoryData = [
    { day: 1, price: 0.45, outcome: 1 },
    { day: 3, price: 0.55, outcome: 1 },
    { day: 5, price: 0.60, outcome: 0 },
    { day: 8, price: 0.40, outcome: 1 },
    { day: 12, price: 0.65, outcome: 0 },
    { day: 15, price: 0.50, outcome: 1 },
    { day: 19, price: 0.35, outcome: 1 },
    { day: 22, price: 0.70, outcome: 0 },
    { day: 26, price: 0.48, outcome: 1 },
    { day: 30, price: 0.52, outcome: 1 }
];

let finalTestBalance = 70.00;

app.get('/get-balance', (req, res) => {
    res.json({ balance: finalTestBalance.toFixed(2) });
});

app.post('/execute-trade', async (req, res) => {
    const { mode, lang, userId } = req.body;
    
    let startBalance = 70.00;
    let currentBalance = startBalance;
    let successfulTrades = 0;
    let totalTrades = aprilHistoryData.length;
    
    let reportLog = `<b>🚀 СТАРТ НА ТЕСТ ЗА АПРИЛ</b>\n<b>Режим:</b> ${mode}\n\n`;

    aprilHistoryData.forEach((market) => {
        let shouldBuy = false;
        
        if (mode === "Conservative" && market.price < 0.50) shouldBuy = true;
        else if (mode === "Balanced" && market.price <= 0.60) shouldBuy = true;
        else if (mode === "Aggressive") shouldBuy = true;

        if (shouldBuy) {
            const contractCost = 10 * market.price; // Купуваме по 10 акции
            if (currentBalance >= contractCost) {
                currentBalance -= contractCost;
                
                if (market.outcome === 1) {
                    currentBalance += 10; // Връща ни се 1$ на акция (общо 10$)
                    successfulTrades++;
                    reportLog += `📅 Ден ${market.day}: Купени акции на $${market.price} -> <b>ПЕЧЕЛБА</b> ✅\n`;
                } else {
                    reportLog += `📅 Ден ${market.day}: Купени акции на $${market.price} -> <b>ЗАГУБА</b> ❌\n`;
                }
            }
        } else {
            reportLog += `📅 Ден ${market.day}: Пропуснат пазар (Цена: $${market.price}) ⏭️\n`;
        }
    });

    const winRate = ((successfulTrades / totalTrades) * 100).toFixed(0);
    const netProfit = currentBalance - startBalance;
    finalTestBalance = currentBalance;

    reportLog += `\n<b>🏁 РЕЗУЛТАТИ ЗА АПРИЛ:</b>
📉 Начален баланс: $${startBalance.toFixed(2)} USDC
📈 Краен баланс: $${currentBalance.toFixed(2)} USDC
💰 Чиста печалба: <b>$${netProfit.toFixed(2)} USDC</b>
🎯 Успеваемост (Win Rate): <b>${winRate}%</b>`;

    await sendToTelegram(reportLog);
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
            .data-card { background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 20px; }
            .label { font-size: 13px; color: #aaa; text-transform: uppercase; margin-bottom: 10px; display: block; font-weight: 500; }
            .value { font-size: 38px; font-family: 'Courier New', monospace; font-weight: bold; color: var(--text); }
            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
            .m-btn { padding: 12px 5px; background: #1a1a1a; border: 1px solid #333; color: #777; cursor: pointer; border-radius: 8px; font-size: 10px; font-weight: bold; text-align:center;}
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); }
            .log { background: #000; padding: 15px; height: 110px; border-radius: 8px; font-size: 12px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; font-family: 'Consolas', monospace; margin-bottom: 20px; }
            .log-item { margin-bottom: 6px; }
            .btn-exec { width: 100%; padding: 20px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 14px; cursor: pointer; color: #000; text-transform: uppercase; letter-spacing: 1px; }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO BACKTESTER</div>
            </div>
            
            <div class="data-card">
                <span id="t-bal" class="label">ТЕСТОВ БАЛАНС (USDC)</span>
                <div class="value" id="balance-display">70.00</div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setM(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Модул за БЕКТЕСТ зареден. Тестов бюджет: 70$.</div>
            </div>

            <button id="t-btn" class="btn-exec" onclick="startTest()">СТАРТИРАЙ ТЕСТ (АПРИЛ)</button>
        </div>

        <script>
            let currentMode = "Conservative";
            
            async function refreshBalance() {
                try {
                    const r = await fetch('/get-balance');
                    const d = await r.json();
                    document.getElementById('balance-display').innerText = d.balance;
                } catch(e) {}
            }

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                currentMode = modes[n];
                document.getElementById('log').innerHTML = '<div class="log-item">Избран режим: ' + currentMode + '</div>';
            }

            async function startTest() {
                document.getElementById('log').innerHTML = '<div class="log-item">Пресмятане на данни за април...</div>';
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ mode: currentMode })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('log').innerHTML = '<div class="log-item" style="color:#00ffa3">ГОТОВО! Отчетът е в Telegram.</div>';
                        document.getElementById('balance-display').innerText = data.currentBalance;
                    }
                } catch (e) { document.getElementById('log').innerHTML = 'Грешка.'; }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Backtester running`));
                 
