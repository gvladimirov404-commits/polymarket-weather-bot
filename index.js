const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// ТВОИТЕ НАСТРОЙКИ (Въведи ги в Railway Variables)
const TG_TOKEN = process.env.TELEGRAM_TOKEN; // Токенът на твоя бот
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Твоят ID или ID на канала

// Функция за пращане на съобщение в Телеграм
async function sendTgLog(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: `🚀 HyperMeteo Alert:\n${message}`
        });
    } catch (e) { console.log("TG Error"); }
}

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="bg">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            :root { --green: #00ffa3; --blue: #00a3ff; --bg: #0a0a0a; --text: #ffffff; }
            body { background: var(--bg); color: var(--text); font-family: sans-serif; padding: 20px; display: flex; justify-content: center; }
            .panel { width: 100%; max-width: 400px; border: 1px solid #333; border-radius: 12px; padding: 20px; }
            
            h2 { color: var(--green); font-size: 18px; margin-bottom: 20px; text-align: center; }
            
            .data-row { background: #151515; padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #222; }
            .label { font-size: 12px; color: #888; display: block; margin-bottom: 5px; }
            .value { font-size: 24px; font-weight: bold; font-family: monospace; }

            /* ТРИ РЕЖИМА */
            .modes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin: 20px 0; }
            .m-btn { padding: 10px 5px; background: #222; border: 1px solid #444; color: #888; cursor: pointer; border-radius: 5px; font-size: 10px; font-weight: bold; }
            .m-btn.active { background: var(--blue); color: white; border-color: var(--blue); }

            .log { background: #000; padding: 10px; height: 100px; border-radius: 5px; font-size: 11px; color: #00ff00; overflow-y: auto; margin-bottom: 15px; border: 1px solid #1a1a1a; }
            
            .btn-exec { width: 100%; padding: 15px; background: var(--green); border: none; border-radius: 8px; font-weight: bold; font-size: 14px; cursor: pointer; color: #000; }
        </style>
    </head>
    <body>
        <div class="panel">
            <h2>HYPERMETEO MASTER PANEL</h2>
            
            <div class="data-row">
                <span class="label">ТЕКУЩ БАЛАНС (USDC)</span>
                <div class="value" id="bal">--.--</div>
            </div>

            <div class="modes">
                <div id="m1" class="m-btn active" onclick="setMode(1)">CONSERVATIVE</div>
                <div id="m2" class="m-btn" onclick="setM(2)">BALANCED</div>
                <div id="m3" class="m-btn" onclick="setM(3)">AGGRESSIVE</div>
            </div>

            <div class="log" id="log">>> Изчакване на пазарен сигнал...</div>

            <button class="btn-exec" onclick="startTrade()">ИЗПЪЛНИ СДЕЛКА СЕГА</button>
        </div>

        <script>
            let mode = "Conservative";

            function setM(n) {
                document.querySelectorAll('.m-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('m'+n).classList.add('active');
                const modes = ["", "Conservative", "Balanced", "Aggressive"];
                mode = modes[n];
                addLog("Режим променен на: " + mode);
            }

            function addLog(msg) {
                const l = document.getElementById('log');
                l.innerHTML = ">> " + msg + "<br>" + l.innerHTML;
            }

            async function startTrade() {
                addLog("Свързване с Polymarket...");
                // Тук по-късно ще добавим fetch() към API-то на Polymarket
                setTimeout(() => {
                    addLog("Сигнал получен! Изпращане към Телеграм...");
                    // Имитираме успешно изпращане
                }, 1000);
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
