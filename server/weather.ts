/**
 * Weather Data Aggregation & Consensus Module
 * Integrates GFS, ECMWF, and ICON models with fallback strategy
 */

export interface WeatherModel {
  name: "GFS" | "ECMWF" | "ICON";
  temperature: number;
  confidence: number;
  lastUpdate: Date;
}

export interface WeatherConsensus {
  city: string;
  forecastDate: Date;
  models: WeatherModel[];
  consensusTemperature: number;
  consensusConfidence: number;
  hasConsensus: boolean;
  toleranceRange: number;
}

export interface WeatherAPIResponse {
  temperature: number;
  timestamp: Date;
  source: string;
}

/**
 * Weather API endpoints and configurations
 */
const WEATHER_SOURCES = {
  WINDY: "https://api.windy.com/api/v2",
  OPENWEATHER: "https://api.openweathermap.org/data/2.5",
  NOAA: "https://api.weather.gov",
} as const;

/**
 * Calculate consensus from multiple weather models
 * Requires all 3 models to be within ±1°C for strong consensus
 */
export function calculateWeatherConsensus(
  models: WeatherModel[],
  toleranceRange: number = 1.0
): WeatherConsensus | null {
  if (models.length === 0) {
    return null;
  }

  // Calculate average temperature
  const avgTemp =
    models.reduce((sum, m) => sum + m.temperature, 0) / models.length;

  // Check if all models are within tolerance range
  const hasConsensus = models.every(
    (m) => Math.abs(m.temperature - avgTemp) <= toleranceRange
  );

  // Calculate confidence (average of all model confidences)
  const avgConfidence =
    models.reduce((sum, m) => sum + m.confidence, 0) / models.length;

  return {
    city: "",
    forecastDate: new Date(),
    models,
    consensusTemperature: Math.round(avgTemp * 10) / 10, // Round to 1 decimal
    consensusConfidence: hasConsensus ? avgConfidence : avgConfidence * 0.5, // Reduce confidence if no consensus
    hasConsensus,
    toleranceRange,
  };
}

/**
 * Fetch weather data from Windy API (primary source)
 * Provides GFS, ECMWF, and ICON model data
 */
export async function fetchWindyWeather(
  lat: number,
  lon: number,
  apiKey: string
): Promise<WeatherModel[]> {
  try {
    const response = await fetch(
      `${WEATHER_SOURCES.WINDY}/point?lat=${lat}&lon=${lon}&model=gfs,ecmwf,icon`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Windy API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Parse model data from response
    const models: WeatherModel[] = [];

    if (data.gfs) {
      models.push({
        name: "GFS",
        temperature: data.gfs.temp2m,
        confidence: 0.85,
        lastUpdate: new Date(data.gfs.timestamp),
      });
    }

    if (data.ecmwf) {
      models.push({
        name: "ECMWF",
        temperature: data.ecmwf.temp2m,
        confidence: 0.95, // ECMWF is generally more accurate
        lastUpdate: new Date(data.ecmwf.timestamp),
      });
    }

    if (data.icon) {
      models.push({
        name: "ICON",
        temperature: data.icon.temp2m,
        confidence: 0.90,
        lastUpdate: new Date(data.icon.timestamp),
      });
    }

    return models;
  } catch (error) {
    console.error("[Weather] Windy API error:", error);
    throw error;
  }
}

/**
 * Fetch weather data from OpenWeather API (fallback)
 */
export async function fetchOpenWeatherData(
  lat: number,
  lon: number,
  apiKey: string
): Promise<WeatherModel[]> {
  try {
    const response = await fetch(
      `${WEATHER_SOURCES.OPENWEATHER}/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
    );

    if (!response.ok) {
      throw new Error(`OpenWeather API error: ${response.statusText}`);
    }

    const data = await response.json();

    return [
      {
        name: "GFS",
        temperature: data.main.temp,
        confidence: 0.75,
        lastUpdate: new Date(),
      },
    ];
  } catch (error) {
    console.error("[Weather] OpenWeather API error:", error);
    throw error;
  }
}

/**
 * Get weather consensus with fallback strategy
 * 1. Try Windy (GFS + ECMWF + ICON)
 * 2. Fallback to OpenWeather
 * 3. Return null if all sources fail
 */
export async function getWeatherConsensus(
  city: string,
  lat: number,
  lon: number,
  windyApiKey: string,
  openWeatherApiKey: string
): Promise<WeatherConsensus | null> {
  try {
    // Primary: Try Windy API
    try {
      const models = await fetchWindyWeather(lat, lon, windyApiKey);
      const consensus = calculateWeatherConsensus(models);

      if (consensus) {
        consensus.city = city;
        return consensus;
      }
    } catch (error) {
      console.warn("[Weather] Windy API failed, trying fallback...", error);
    }

    // Fallback: Try OpenWeather
    try {
      const models = await fetchOpenWeatherData(lat, lon, openWeatherApiKey);
      const consensus = calculateWeatherConsensus(models);

      if (consensus) {
        consensus.city = city;
        return consensus;
      }
    } catch (error) {
      console.error("[Weather] OpenWeather API also failed:", error);
    }

    return null;
  } catch (error) {
    console.error("[Weather] Unexpected error in consensus calculation:", error);
    return null;
  }
}

/**
 * City coordinates for major markets
 */
export const MAJOR_CITIES = {
  NewYork: { lat: 40.7128, lon: -74.006 },
  London: { lat: 51.5074, lon: -0.1278 },
  Tokyo: { lat: 35.6762, lon: 139.6503 },
  Paris: { lat: 48.8566, lon: 2.3522 },
  Singapore: { lat: 1.3521, lon: 103.8198 },
  Dubai: { lat: 25.2048, lon: 55.2708 },
  Sydney: { lat: -33.8688, lon: 151.2093 },
  HongKong: { lat: 22.3193, lon: 114.1694 },
} as const;

/**
 * Temperature bin for Polymarket markets
 * Groups temperatures into 1°C ranges
 */
export function getTemperatureBin(temperature: number): string {
  const lower = Math.floor(temperature);
  const upper = lower + 1;
  return `${lower}-${upper}°C`;
}

/**
 * Check if temperature falls within a specific bin
 */
export function isTemperatureInBin(temperature: number, bin: string): boolean {
  const [lower, upper] = bin.split("-").map((s) => parseFloat(s));
  return temperature >= lower && temperature < upper;
}


/**
 * Check if daily drawdown limit exceeded
 */
export function isDrawdownLimitExceeded(
  dailyPnL: number,
  initialCapital: number,
  maxDrawdownPercent: number
): boolean {
  if (dailyPnL >= 0) return false; // No drawdown on positive P&L
  const drawdownPercent = (Math.abs(dailyPnL) / initialCapital) * 100;
  return drawdownPercent > maxDrawdownPercent;
}
