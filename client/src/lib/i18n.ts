/**
 * Internationalization (i18n) Configuration
 * Supports Bulgarian (BG) and English (EN)
 */

export type Language = "en" | "bg";

export const LANGUAGES = {
  en: "English",
  bg: "Български",
} as const;

export const translations = {
  en: {
    // Navigation
    nav: {
      dashboard: "Dashboard",
      positions: "Positions",
      trades: "Trades",
      alerts: "Alerts",
      settings: "Settings",
      admin: "Admin",
    },

    // Dashboard
    dashboard: {
      portfolioValue: "Portfolio Value",
      dailyPnL: "Daily P&L",
      activePositions: "Active Positions",
      botStatus: "Bot Status",
      healthy: "Healthy",
      lastCheck: "Last check",
      ago: "ago",
    },

    // Positions
    positions: {
      title: "Positions",
      city: "City",
      market: "Market",
      entry: "Entry",
      current: "Current",
      size: "Size",
      pnl: "P&L",
      status: "Status",
      open: "Open",
      closed: "Closed",
      hedged: "Hedged",
    },

    // Trades
    trades: {
      title: "Trades",
      type: "Type",
      price: "Price",
      quantity: "Quantity",
      time: "Time",
      status: "Status",
      buy: "BUY",
      sell: "SELL",
      hedge: "HEDGE",
      filled: "Filled",
      pending: "Pending",
      failed: "Failed",
    },

    // Alerts
    alerts: {
      title: "Alerts",
      tradeExecuted: "Trade Executed",
      forecastChange: "Forecast Change",
      botStatus: "Bot Status",
      riskThreshold: "Risk Threshold",
      connectivityLost: "Connectivity Lost",
      drawdownLimit: "Drawdown Limit Hit",
    },

    // Subscription
    subscription: {
      title: "Subscription",
      tier: "Tier",
      free: "Free",
      pro: "Pro",
      premium: "Premium",
      status: "Status",
      active: "Active",
      inactive: "Inactive",
      suspended: "Suspended",
      cancelled: "Cancelled",
      expiresAt: "Expires at",
      upgrade: "Upgrade",
      cancel: "Cancel",
    },

    // Wallet
    wallet: {
      connect: "Connect Wallet",
      disconnect: "Disconnect",
      connected: "Connected",
      address: "Address",
      balance: "Balance",
      selectWallet: "Select Wallet",
    },

    // Referral
    referral: {
      title: "Referral Program",
      code: "Referral Code",
      link: "Referral Link",
      stats: "Referral Stats",
      totalReferrals: "Total Referrals",
      totalCommissions: "Total Commissions",
      pendingCommissions: "Pending Commissions",
      copy: "Copy",
      copied: "Copied!",
    },

    // Settings
    settings: {
      title: "Settings",
      language: "Language",
      theme: "Theme",
      notifications: "Notifications",
      telegram: "Telegram",
      discord: "Discord",
      email: "Email",
      maxDailyDrawdown: "Max Daily Drawdown",
      perTradeBudget: "Per Trade Budget",
      slippageProtection: "Slippage Protection",
      save: "Save",
      saved: "Saved!",
    },

    // Admin
    admin: {
      title: "Admin Panel",
      users: "Users",
      analytics: "Analytics",
      subscriptions: "Subscriptions",
      totalUsers: "Total Users",
      activeSubscriptions: "Active Subscriptions",
      totalVolume: "Total Volume",
      platformPnL: "Platform P&L",
    },

    // Common
    common: {
      loading: "Loading...",
      error: "Error",
      success: "Success",
      cancel: "Cancel",
      save: "Save",
      delete: "Delete",
      edit: "Edit",
      close: "Close",
      back: "Back",
      next: "Next",
      previous: "Previous",
      search: "Search",
      filter: "Filter",
      sort: "Sort",
    },
  },

  bg: {
    // Navigation
    nav: {
      dashboard: "Табло",
      positions: "Позиции",
      trades: "Сделки",
      alerts: "Известия",
      settings: "Настройки",
      admin: "Администратор",
    },

    // Dashboard
    dashboard: {
      portfolioValue: "Стойност на портфолиото",
      dailyPnL: "Дневна печалба/загуба",
      activePositions: "Активни позиции",
      botStatus: "Статус на бота",
      healthy: "Здравословен",
      lastCheck: "Последна проверка",
      ago: "преди",
    },

    // Positions
    positions: {
      title: "Позиции",
      city: "Град",
      market: "Пазар",
      entry: "Вход",
      current: "Текущ",
      size: "Размер",
      pnl: "П&З",
      status: "Статус",
      open: "Отворена",
      closed: "Затворена",
      hedged: "Хеджирана",
    },

    // Trades
    trades: {
      title: "Сделки",
      type: "Тип",
      price: "Цена",
      quantity: "Количество",
      time: "Време",
      status: "Статус",
      buy: "ПОКУПКА",
      sell: "ПРОДАЖБА",
      hedge: "ХЕДЖИРАНЕ",
      filled: "Изпълнена",
      pending: "В очакване",
      failed: "Неуспешна",
    },

    // Alerts
    alerts: {
      title: "Известия",
      tradeExecuted: "Сделка изпълнена",
      forecastChange: "Промяна на прогнозата",
      botStatus: "Статус на бота",
      riskThreshold: "Праг на риска",
      connectivityLost: "Загубена връзка",
      drawdownLimit: "Лимит на спада",
    },

    // Subscription
    subscription: {
      title: "Абонамент",
      tier: "Ниво",
      free: "Безплатно",
      pro: "Про",
      premium: "Премиум",
      status: "Статус",
      active: "Активен",
      inactive: "Неактивен",
      suspended: "Спрян",
      cancelled: "Отменен",
      expiresAt: "Изтича на",
      upgrade: "Надстройка",
      cancel: "Отмяна",
    },

    // Wallet
    wallet: {
      connect: "Свързване на портфейл",
      disconnect: "Разкачване",
      connected: "Свързан",
      address: "Адрес",
      balance: "Баланс",
      selectWallet: "Избор на портфейл",
    },

    // Referral
    referral: {
      title: "Програма за препоръки",
      code: "Код за препоръка",
      link: "Линк за препоръка",
      stats: "Статистика на препоръките",
      totalReferrals: "Всички препоръки",
      totalCommissions: "Всички комисионни",
      pendingCommissions: "Очакващи комисионни",
      copy: "Копиране",
      copied: "Копирано!",
    },

    // Settings
    settings: {
      title: "Настройки",
      language: "Език",
      theme: "Тема",
      notifications: "Известия",
      telegram: "Телеграм",
      discord: "Дискорд",
      email: "Имейл",
      maxDailyDrawdown: "Макс. дневен спад",
      perTradeBudget: "Бюджет за сделка",
      slippageProtection: "Защита от проскок",
      save: "Запазване",
      saved: "Запазено!",
    },

    // Admin
    admin: {
      title: "Администраторски панел",
      users: "Потребители",
      analytics: "Аналитика",
      subscriptions: "Абонаменти",
      totalUsers: "Всички потребители",
      activeSubscriptions: "Активни абонаменти",
      totalVolume: "Всеки обем",
      platformPnL: "Платформа П&З",
    },

    // Common
    common: {
      loading: "Зареждане...",
      error: "Грешка",
      success: "Успех",
      cancel: "Отмяна",
      save: "Запазване",
      delete: "Изтриване",
      edit: "Редактиране",
      close: "Затваряне",
      back: "Назад",
      next: "Напред",
      previous: "Предишен",
      search: "Търсене",
      filter: "Филтър",
      sort: "Сортиране",
    },
  },
} as const;

/**
 * Get translation by key and language
 */
export function t(
  key: string,
  language: Language = "en"
): string {
  const keys = key.split(".");
  let value: any = translations[language];

  for (const k of keys) {
    value = value?.[k];
  }

  return value || key;
}

/**
 * Get current language from localStorage or browser preference
 */
export function getCurrentLanguage(): Language {
  const stored = localStorage.getItem("language");
  if (stored === "en" || stored === "bg") {
    return stored;
  }

  const browserLang = navigator.language.split("-")[0];
  return browserLang === "bg" ? "bg" : "en";
}

/**
 * Set current language
 */
export function setLanguage(language: Language): void {
  localStorage.setItem("language", language);
}
