import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateWeatherConsensus,
  getTemperatureBin,
  isTemperatureInBin,
  isDrawdownLimitExceeded,
} from "./weather";
import { isRateLimited, getRemainingRequests } from "./security";

describe("Weather Module", () => {
  describe("Weather Consensus", () => {
    it("should calculate consensus from multiple models", () => {
      const models = [
        {
          name: "GFS" as const,
          temperature: 15.2,
          confidence: 0.85,
          lastUpdate: new Date(),
        },
        {
          name: "ECMWF" as const,
          temperature: 15.1,
          confidence: 0.95,
          lastUpdate: new Date(),
        },
        {
          name: "ICON" as const,
          temperature: 15.3,
          confidence: 0.9,
          lastUpdate: new Date(),
        },
      ];

      const consensus = calculateWeatherConsensus(models);

      expect(consensus).toBeDefined();
      expect(consensus?.hasConsensus).toBe(true);
      expect(consensus?.consensusTemperature).toBeCloseTo(15.2, 1);
      expect(consensus?.consensusConfidence).toBeGreaterThan(0.8);
    });

    it("should detect lack of consensus when models diverge", () => {
      const models = [
        {
          name: "GFS" as const,
          temperature: 14.0,
          confidence: 0.85,
          lastUpdate: new Date(),
        },
        {
          name: "ECMWF" as const,
          temperature: 16.5,
          confidence: 0.95,
          lastUpdate: new Date(),
        },
        {
          name: "ICON" as const,
          temperature: 14.2,
          confidence: 0.9,
          lastUpdate: new Date(),
        },
      ];

      const consensus = calculateWeatherConsensus(models);

      expect(consensus?.hasConsensus).toBe(false);
      expect(consensus?.consensusConfidence).toBeLessThan(0.8);
    });

    it("should return null for empty models array", () => {
      const consensus = calculateWeatherConsensus([]);
      expect(consensus).toBeNull();
    });

    it("should handle single model consensus", () => {
      const models = [
        {
          name: "GFS" as const,
          temperature: 15.0,
          confidence: 0.85,
          lastUpdate: new Date(),
        },
      ];

      const consensus = calculateWeatherConsensus(models);
      expect(consensus).toBeDefined();
      expect(consensus?.consensusTemperature).toBe(15.0);
    });
  });

  describe("Temperature Bins", () => {
    it("should correctly bin temperatures", () => {
      expect(getTemperatureBin(15.2)).toBe("15-16°C");
      expect(getTemperatureBin(20.9)).toBe("20-21°C");
      expect(getTemperatureBin(0.0)).toBe("0-1°C");
      expect(getTemperatureBin(-5.5)).toBe("-6--5°C");
    });

    it("should check if temperature is in bin", () => {
      expect(isTemperatureInBin(15.2, "15-16°C")).toBe(true);
      expect(isTemperatureInBin(15.0, "15-16°C")).toBe(true);
      expect(isTemperatureInBin(15.99, "15-16°C")).toBe(true);
      expect(isTemperatureInBin(16.0, "15-16°C")).toBe(false);
      expect(isTemperatureInBin(14.9, "15-16°C")).toBe(false);
    });

    it("should handle edge cases for temperature bins", () => {
      expect(isTemperatureInBin(0.0, "0-1°C")).toBe(true);
      expect(isTemperatureInBin(0.99, "0-1°C")).toBe(true);
      expect(isTemperatureInBin(1.0, "0-1°C")).toBe(false);
    });
  });

  describe("Risk Management", () => {
    it("should detect drawdown limit exceeded", () => {
      const exceeded = isDrawdownLimitExceeded(-600, 10000, 5);
      expect(exceeded).toBe(true);
    });

    it("should allow trades within drawdown limit", () => {
      const exceeded = isDrawdownLimitExceeded(-300, 10000, 5);
      expect(exceeded).toBe(false);
    });

    it("should not trigger on positive P&L", () => {
      const exceeded = isDrawdownLimitExceeded(500, 10000, 5);
      expect(exceeded).toBe(false);
    });

    it("should handle edge case at exact limit", () => {
      // 5% of 10000 = 500
      const exceeded = isDrawdownLimitExceeded(-500, 10000, 5);
      expect(exceeded).toBe(false);
    });

    it("should handle small account with large loss", () => {
      const exceeded = isDrawdownLimitExceeded(-100, 100, 50);
      expect(exceeded).toBe(true);
    });
  });
});

describe("Security Module", () => {
  describe("Rate Limiting", () => {
    beforeEach(() => {
      // Clear rate limit store between tests
      // Note: In production, use Redis for distributed rate limiting
    });

    it("should allow requests within limit", () => {
      const key = `test-user-${Date.now()}-1`;
      const config = { maxRequests: 5, windowMs: 60000 };

      const limited1 = isRateLimited(key, config);
      const limited2 = isRateLimited(key, config);

      expect(limited1).toBe(false);
      expect(limited2).toBe(false);
    });

    it("should block requests exceeding limit", () => {
      const key = `test-user-${Date.now()}-2`;
      const config = { maxRequests: 2, windowMs: 60000 };

      isRateLimited(key, config);
      isRateLimited(key, config);
      const limited = isRateLimited(key, config);

      expect(limited).toBe(true);
    });

    it("should return remaining requests", () => {
      const key = `test-user-${Date.now()}-3`;
      const config = { maxRequests: 5, windowMs: 60000 };

      isRateLimited(key, config);
      isRateLimited(key, config);

      const remaining = getRemainingRequests(key, config);
      expect(remaining).toBe(3);
    });

    it("should handle zero remaining requests", () => {
      const key = `test-user-${Date.now()}-4`;
      const config = { maxRequests: 1, windowMs: 60000 };

      isRateLimited(key, config);
      isRateLimited(key, config);

      const remaining = getRemainingRequests(key, config);
      expect(remaining).toBe(0);
    });
  });
});

describe("Integration Tests", () => {
  it("should handle complete trading workflow", () => {
    // Simulate weather consensus -> trade signal -> rate limiting

    // 1. Weather consensus
    const weatherModels = [
      {
        name: "GFS" as const,
        temperature: 15.1,
        confidence: 0.85,
        lastUpdate: new Date(),
      },
      {
        name: "ECMWF" as const,
        temperature: 15.2,
        confidence: 0.95,
        lastUpdate: new Date(),
      },
      {
        name: "ICON" as const,
        temperature: 15.0,
        confidence: 0.9,
        lastUpdate: new Date(),
      },
    ];

    const consensus = calculateWeatherConsensus(weatherModels);
    expect(consensus?.hasConsensus).toBe(true);

    // 2. Temperature bin
    const bin = getTemperatureBin(consensus!.consensusTemperature);
    expect(bin).toBe("15-16°C");

    // 3. Verify temperature in bin
    expect(isTemperatureInBin(consensus!.consensusTemperature, bin)).toBe(true);

    // 4. Check rate limiting for trade execution
    const tradeKey = `trade-user-1-${Date.now()}`;
    const tradeConfig = { maxRequests: 10, windowMs: 60000 };

    for (let i = 0; i < 5; i++) {
      const limited = isRateLimited(tradeKey, tradeConfig);
      expect(limited).toBe(false);
    }

    const remaining = getRemainingRequests(tradeKey, tradeConfig);
    expect(remaining).toBe(5);
  });

  it("should prevent excessive trading via rate limiting", () => {
    const userKey = `user-${Date.now()}`;
    const tradeConfig = { maxRequests: 3, windowMs: 60000 };

    // Execute 3 trades (allowed)
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited(userKey, tradeConfig)).toBe(false);
    }

    // 4th trade should be blocked
    expect(isRateLimited(userKey, tradeConfig)).toBe(true);
  });
});
