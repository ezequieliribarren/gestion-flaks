'use strict';

// Datos externos para las tarjetas chicas del Inicio: dólar MEP y clima de Capital
// Federal. Ambas son APIs públicas sin API key. Se cachean en memoria unos minutos
// y si fallan (sin internet, API caída) devuelven null — nunca rompen la página.

const CACHE_MS_DOLAR = 10 * 60 * 1000;
const CACHE_MS_CLIMA = 30 * 60 * 1000;

let cacheDolar = null; // { at, data }
let cacheClima = null;

async function fetchJSON(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Dólar MEP (bolsa): { compra, venta } o null.
async function dolarMEP() {
  if (cacheDolar && Date.now() - cacheDolar.at < CACHE_MS_DOLAR) return cacheDolar.data;
  const j = await fetchJSON('https://dolarapi.com/v1/dolares/bolsa');
  const data = j && typeof j.compra === 'number' && typeof j.venta === 'number' ? { compra: j.compra, venta: j.venta } : null;
  cacheDolar = { at: Date.now(), data };
  return data;
}

const WMO = {
  0: ['Despejado', '☀️'], 1: ['Mayormente despejado', '🌤️'], 2: ['Parcialmente nublado', '⛅'], 3: ['Nublado', '☁️'],
  45: ['Niebla', '🌫️'], 48: ['Niebla', '🌫️'],
  51: ['Llovizna', '🌦️'], 53: ['Llovizna', '🌦️'], 55: ['Llovizna', '🌦️'],
  56: ['Llovizna helada', '🌧️'], 57: ['Llovizna helada', '🌧️'],
  61: ['Lluvia', '🌧️'], 63: ['Lluvia', '🌧️'], 65: ['Lluvia fuerte', '🌧️'],
  66: ['Lluvia helada', '🌧️'], 67: ['Lluvia helada', '🌧️'],
  71: ['Nieve', '❄️'], 73: ['Nieve', '❄️'], 75: ['Nieve fuerte', '❄️'], 77: ['Granizo', '❄️'],
  80: ['Chubascos', '🌦️'], 81: ['Chubascos', '🌦️'], 82: ['Chubascos fuertes', '⛈️'],
  85: ['Chubascos de nieve', '❄️'], 86: ['Chubascos de nieve', '❄️'],
  95: ['Tormenta', '⛈️'], 96: ['Tormenta con granizo', '⛈️'], 99: ['Tormenta con granizo', '⛈️'],
};

// Clima actual en Capital Federal (CABA): { temp, descripcion, icono } o null.
async function climaCaba() {
  if (cacheClima && Date.now() - cacheClima.at < CACHE_MS_CLIMA) return cacheClima.data;
  const j = await fetchJSON('https://api.open-meteo.com/v1/forecast?latitude=-34.61&longitude=-58.38&current_weather=true');
  let data = null;
  if (j && j.current_weather) {
    const cw = j.current_weather;
    const w = WMO[cw.weathercode] || ['—', '🌡️'];
    data = { temp: Math.round(cw.temperature), descripcion: w[0], icono: w[1] };
  }
  cacheClima = { at: Date.now(), data };
  return data;
}

module.exports = { dolarMEP, climaCaba };
