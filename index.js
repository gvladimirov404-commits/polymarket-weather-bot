import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botEnabled = true;
let balance = 70.00;
let balanceHistory = [{ date: new Date().toISOString(), balance: 70.00 }];

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
