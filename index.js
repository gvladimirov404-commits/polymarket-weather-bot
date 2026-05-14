const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// КОНФИГУРАЦИЯ (Въведи своите данни в Railway Variables)
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CREATOR_ID = process.env.MY_TELEGRAM_ID; // Твоят личен Телеграм ID за безплатен достъп

app.use(express.json());

// Функция за изпращане на съобщения (Лог в Телеграм)
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

app.post('/execute-trade', async (req, res) => {
    const { mode, lang, userId } = req.body;
    
    // Проверка за Creator (Безплатен достъп)
    const isAdmin = (userId === CREATOR_ID);
    const feeStatus = isAdmin ? "FREE (CREATOR)" : "FEE APPLIED";
    
    // ЛОГИКА ЗА ЛИМИТИРАНИ ПОРЪЧКИ
    const orderType = "LIMIT ORDER (CLOB)";
    const strategy = mode === "Aggressive" ? "High Yield Focus" : (mode === "Balanced" ? "Optimal Spread" : "Safety First");

    const alertMsg = `
<b>Режим:</b> ${mode}
<b>Тип:</b> ${orderType}
<b>Стратегия:</b> ${strategy}
<b>Статус такса:</b> ${feeStatus}
<b>Действие:</b> Изчакване на най-добра цена в ордер бука...`;

    await sendToTelegram(alertMsg);
    res.json({ success: true, admin: isAdmin });
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
            select { background: #1a1a1a; color: var(--green); border: 1px solid #333; padding: 5px; border-radius: 4px; font-weight: bold; }

            .data-card { background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid #222; text-align: center; margin-bottom: 20px; }
            .label { font-size: 13px; color: #aaa; text-transform: uppercase; margin-bottom: 10px; display: block; font-weight: 500; }
            .value { font-size: 38px; font-family: 'Courier New', monospace; font-weight: bold; color: var(--text); text-shadow: 0 0 10px rgba(255,255,255,0.1); }

            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
            .m-btn { padding: 12px 5px; background: #1a1a1a; border: 1px solid #333; color: #777; cursor: pointer; border-radius: 8px; font-size: 10px; font-weight: bold; transition: 0.2s; }
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); box-shadow: 0 4px 12px rgba(0,163,255,0.4); }

            .ref-box { border: 1px dashed #333; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
            .ref-link { background: #000; padding: 10px; border-radius: 6px; font-size: 11px; color: var(--blue); margin-top: 10px; display: block; border: 1px solid #222; text-decoration: none; word-break: break-all; }

            .log { background: #000; padding: 15px; height: 110px; border-radius: 8px; font-size: 12px; color: #00ff00; overflow-y: auto; border: 1px solid #1a1a1a; font-family: 'Consolas', monospace; margin-bottom: 20px; line-height: 1.5; }
            .log-item { margin-bottom: 6px; border-left: 3px solid #222; padding-left: 10px; }

            .btn-exec { width: 100%; padding: 20px; background: var(--green); border: none; border-radius: 12px; font-weight: 900; font-size: 15px; cursor: pointer; color: #000; text-transform: uppercase; letter-spacing: 1px; transition: 0.2s; }
            .btn-exec:hover { filter: brightness(1.1); }
            .btn-exec:active { transform: scale(0.97); }
        </style>
    </head>
    <body>
        <div class="panel">
            <div class="header">
                <div class="brand">HYPERMETEO MASTER</div>
                <select id="lang" onchange="updateLang()">
                    <option value="bg">BG</option><option value="en">EN</option><option value="ru">RU</option>
                </select>
            </div>
            
            <div class="data-card">
                <span id="t-bal" class="label">ТЕКУЩ БАЛАНС (USDC)</span>
                <div class="value">--.--</div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setM(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="ref-box">
                <span id="t-ref" class="label" style="color:var(--blue)">ПРОГРАМА ЗА ЛОЯЛНОСТ</span>
                <div class="ref-link" onclick="copyRef()">t.me/HyperMeteoBot?start=user_id</div>
            </div>

            <div class="log" id="log">
                <div class="log-item">>> Система готова. Очаквам команди...</div>
            </div>

            <button id="t-btn" class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ СДЕЛКА (LIMIT)</button>
        </div>

        <script>
            let currentMode = "Conservative";
            const translations = {
                bg: { bal: "ТЕКУЩ БАЛАНС (USDC)", ref: "ПРОГРАМА ЗА ЛОЯЛНОСТ", btn: "ИЗПЪЛНИ СДЕЛКА (LIMIT)", log: "Режим: " },
                en: { bal: "CURRENT BALANCE (USDC)", ref: "LOYALTY PROGRAM", btn: "EXECUTE TRADE (LIMIT)", log: "Mode: " },
                ru: { bal: "ТЕКУЩИЙ БАЛАНС (USDC)", ref: "ПРОГРАММА ЛОЯЛЬНОСТИ", btn: "ВЫПОЛНИТЬ СДЕЛКУ (LIMIT)", log: "Режим: " }
            };

            function updateLang() {
                const l = document.getElementById('lang').value;
                document.getElementById('t-bal').innerText = translations[l].bal;
                document.getElementById('t-ref').innerText = translations[l].ref;
                document.getElementById('t-btn').innerText = translations[l].btn;
            }

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                currentMode = modes[n];
                addLog(translations[document.getElementById('lang').value].log + currentMode);
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = '<div class="log-item">[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + l.innerHTML;
            }

            function copyRef() {
                alert("Линкът е копиран! Изпратете го на приятел.");
            }

            async function startTrade() {
                const l = document.getElementById('lang').value;
                addLog(l === 'bg' ? "Изпращане на лимитиран ордер..." : "Sending limit order...");
                
                try {
                    const res = await fetch('/execute-trade', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            mode: currentMode, 
                            lang: l,
                            userId: "USER_ID_FROM_TELEGRAM" // Тук ще дойде ID от Mini App
                        })
                    });
                    if (res.ok) addLog("OK: Сигналът е заведен в лога.");
                } catch (e) { addLog("Грешка при връзка."); }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`HyperMeteo Engine running`));
             
