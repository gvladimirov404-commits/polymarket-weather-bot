import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Activity, AlertCircle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Mock data for charts
const chartData = [
  { time: "00:00", price: 0.45, pnl: 0 },
  { time: "04:00", price: 0.48, pnl: 150 },
  { time: "08:00", price: 0.46, pnl: 100 },
  { time: "12:00", price: 0.52, pnl: 450 },
  { time: "16:00", price: 0.50, pnl: 350 },
  { time: "20:00", price: 0.55, pnl: 650 },
];

const positionsData = [
  {
    id: 1,
    city: "New York",
    market: "NYC Temp 15-16°C",
    entry: 0.52,
    current: 0.58,
    size: 100,
    pnl: 600,
    status: "open",
  },
  {
    id: 2,
    city: "London",
    market: "LON Temp 8-9°C",
    entry: 0.45,
    current: 0.42,
    size: 150,
    pnl: -450,
    status: "open",
  },
  {
    id: 3,
    city: "Tokyo",
    market: "TYO Temp 20-21°C",
    entry: 0.60,
    current: 0.65,
    size: 80,
    pnl: 400,
    status: "closed",
  },
];

const tradeHistoryData = [
  {
    id: 1,
    type: "BUY",
    market: "NYC Temp 15-16°C",
    price: 0.52,
    quantity: 100,
    time: "2026-05-02 14:32",
    status: "filled",
  },
  {
    id: 2,
    type: "SELL",
    market: "LON Temp 8-9°C",
    price: 0.42,
    quantity: 150,
    time: "2026-05-02 13:15",
    status: "filled",
  },
  {
    id: 3,
    type: "BUY",
    market: "TYO Temp 20-21°C",
    price: 0.60,
    quantity: 80,
    time: "2026-05-02 12:00",
    status: "filled",
  },
];

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Portfolio Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">$12,450.50</div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-green-400">+$1,250.50</span> today
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Daily P&L
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">+$1,250.50</div>
              <p className="text-xs text-muted-foreground mt-1">+11.2% return</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-400">2</div>
              <p className="text-xs text-muted-foreground mt-1">3 closed today</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Bot Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-sm font-semibold text-green-400">Healthy</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Last check: 2m ago</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Charts Section */}
        <Tabs defaultValue="pnl" className="w-full">
          <TabsList className="bg-card border-border">
            <TabsTrigger value="pnl">P&L Chart</TabsTrigger>
            <TabsTrigger value="price">Price Action</TabsTrigger>
            <TabsTrigger value="orderbook">Order Book</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Daily P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ffff" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00ffff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                    <XAxis dataKey="time" stroke="#666" />
                    <YAxis stroke="#666" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="#00ffff"
                      fillOpacity={1}
                      fill="url(#colorPnl)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="price" className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Market Price Action</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                    <XAxis dataKey="time" stroke="#666" />
                    <YAxis stroke="#666" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#00ffff"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orderbook" className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">Order Book - NYC Temp 15-16°C</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-red-400 mb-2">ASKS</h4>
                    <div className="space-y-1">
                      {[0.58, 0.57, 0.56].map((price, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">${price}</span>
                          <span className="text-red-400">2.5K</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-border py-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Spread</span>
                      <span className="text-cyan-400">0.01 (1.8%)</span>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-green-400 mb-2">BIDS</h4>
                    <div className="space-y-1">
                      {[0.55, 0.54, 0.53].map((price, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">${price}</span>
                          <span className="text-green-400">3.2K</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Positions and Trade History */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Active Positions */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                Active Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {positionsData
                  .filter((p) => p.status === "open")
                  .map((position) => (
                    <div
                      key={position.id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border"
                    >
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-foreground">
                          {position.city}
                        </p>
                        <p className="text-xs text-muted-foreground">{position.market}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {position.pnl > 0 ? (
                            <span className="text-green-400">+${position.pnl}</span>
                          ) : (
                            <span className="text-red-400">${position.pnl}</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Entry: ${position.entry}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Trade History */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" />
                Recent Trades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tradeHistoryData.slice(0, 4).map((trade) => (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={trade.type === "BUY" ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {trade.type}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{trade.time}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{trade.market}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">
                        ${trade.price}
                      </p>
                      <p className="text-xs text-muted-foreground">{trade.quantity} qty</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alerts Section */}
        <Card className="bg-card border-border border-yellow-500/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              System Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm text-yellow-400">
                  Weather forecast update: ECMWF model shows 15.2°C for NYC (consensus: 15.1°C)
                </p>
              </div>
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-sm text-green-400">
                  Position closed: TYO Temp 20-21°C +$400 P&L
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
