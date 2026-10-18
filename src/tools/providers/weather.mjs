// src/tools/providers/weather.mjs
// Open-Meteo provider (no API key). Geocodes a city name then returns the
// current forecast. Provenance, source and license are attached to results.
import { safeFetch } from "../netguard.mjs";

const GEO_ALLOW = ["geocoding-api.open-meteo.com"];
const FORECAST_ALLOW = ["api.open-meteo.com"];

export const weatherProvider = {
  id: "weather.current",
  version: "1.0.0",
  label: "Current Weather",
  category: "weather",
  description: "Current conditions from Open-Meteo by city name or coordinates.",
  permissions: { network: GEO_ALLOW.concat(FORECAST_ALLOW), write: false },
  timeoutMs: 8000,
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", maxLength: 80 },
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 }
    }
  },
  outputSchema: { type: "object", required: ["temperature_c"], properties: { temperature_c: { type: "number" } } },
  async run(args) {
    let lat = args.latitude;
    let lon = args.longitude;
    let place = null;
    if (lat === undefined || lon === undefined) {
      if (!args.city) throw new Error("Provide city or latitude/longitude");
      const geo = await safeFetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1`, { allowlist: GEO_ALLOW, timeoutMs: 6000 });
      const parsed = JSON.parse(geo.text);
      const hit = parsed.results?.[0];
      if (!hit) throw new Error(`No location found for "${args.city}"`);
      lat = hit.latitude; lon = hit.longitude;
      place = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
    }
    const forecast = await safeFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`,
      { allowlist: FORECAST_ALLOW, timeoutMs: 6000 }
    );
    const data = JSON.parse(forecast.text);
    const current = data.current || {};
    return {
      data: {
        place: place || `${lat}, ${lon}`,
        temperature_c: current.temperature_2m,
        humidity_pct: current.relative_humidity_2m,
        wind_kph: current.wind_speed_10m,
        weather_code: current.weather_code,
        observed_at: current.time || null
      },
      meta: {
        source: "open-meteo.com",
        source_url: forecast.status ? "https://api.open-meteo.com/v1/forecast" : null,
        license: "Open-Meteo (CC-BY 4.0, non-commercial free tier)",
        timestamp: new Date().toISOString()
      }
    };
  }
};
