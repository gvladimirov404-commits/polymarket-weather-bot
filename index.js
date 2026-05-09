import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Състояние на бота
let botEnabled = true;
let balance = 70.00;
let balanceHistory = [{ date: new Date().toISOString(), balance: 70.00 }];

// API маршрути
app.get('/api/status', (req, res) => {
    res.json({
        botEnabled: botEnabled,
        balance: balance.toFixed(2),
        dailyPnL: "0.00",
        monthlyPnL: "0.00",
        activePositions: 0,
        balance_history: balanceHistory
    });
});

app.post('/api/bot/toggle', (req, res) => {
    botEnabled = !botEnabled;
    res.json({ botEnabled: botEnabled });
});

// Уеб интерфейс (вграден)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>Polymarket Weather Bot</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body { font-family: system-ui, sans-serif; padding: 16px; max-width: 700px; margin: 0 auto; background: #0a0f1e; color: #e0e0e0; }
        .card { background: #1e2436; border-radius: 24px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        button { background: #2c3e66; border: none; color: white; padding: 12px 24px; border-radius: 40px; font-size: 16px; font-weight: bold; margin: 8px 8px 0 0; cursor: pointer; }
        .status { font-size: 14px; color: #aaa; margin-top: 8px; }
        canvas { max-height: 300px; width: 100% !important; margin-top: 20px; }
        h2 { margin-top: 0; color: #6c8eff; }
    </style>
</head>
<body>
<div class="card">
    <h2>📈 Polymarket Weather Bot</h2>
    <div id="status">Зареждане...</div>
    <button id="toggleBtn">🔴 Изключи бота</button>
    <canvas id="balanceChart" width="400" height="200"></canvas>
</div>
<script>
    let balanceChart = null;
    async function fetchStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            document.getElementById('status').innerHTML = \`
                🟢 <strong>Ботът е \${data.botEnabled ? 'ВКЛЮЧЕН' : 'ИЗКЛЮЧЕН'}</strong><br>
                💰 Баланс: $\${data.balance}<br>
                📉 Дневна PnL: $\${data.dailyPnL}<br>
                📊 Активни позиции: \${data.activePositions}
            \`;
            document.getElementById('toggleBtn').textContent = data.botEnabled ? '🔴 Изключи бота' : '🟢 Включи бота';

            if (balanceChart) balanceChart.destroy();
            const ctx = document.getElementById('balanceChart').getContext('2d');
            const history = data.balance_history || [];
            balanceChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: history.map(p => new Date(p.date).toLocaleDateString()),
                    datasets: [{ label: 'Баланс (USDC)', data: history.map(p => p.balance), borderColor: '#6c8eff', tension: 0.1 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: { legend: { position: 'top' } },
                    scales: { y: { beginAtZero: false, title: { display: true, text: 'Баланс (USDC)' } } }
                }
            });
        } catch(e) {
            document.getElementById('status').innerHTML = '❌ Грешка при зареждане на данни';
        }
    }
    async function toggleBot() { await fetch('/api/bot/toggle', { method: 'POST' }); await fetchStatus(); }
    document.getElementById('toggleBtn').onclick = toggleBot;
    fetchStatus();
    setInterval(fetchStatus, 30000);
</script>
</body>
</html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(\`Server running on port \${PORT}\`);
});
