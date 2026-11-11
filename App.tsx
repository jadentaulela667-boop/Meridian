import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
Notifications.setNotificationHandler({
  handleNotification: async function() {
    return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true };
  }
});
var BG_TASK = 'MERIDIAN_BG';
var SYMBOLS = [
  { id: 'US30', fullName: 'Dow Jones', tickers: ['^DJI', 'DIA'], decimals: 1 },
  { id: 'US100', fullName: 'Nasdaq 100', tickers: ['^NDX', 'QQQ'], decimals: 1 },
  { id: 'XAUUSD', fullName: 'GOLD', tickers: ['GC=F', 'XAUUSD=X'], decimals: 2 },
  { id: 'XAGUSD', fullName: 'SILVER', tickers: ['SI=F', 'XAGUSD=X'], decimals: 3 },
  { id: 'GBPUSD', fullName: 'GBPUSD', tickers: ['GBPUSD=X'], decimals: 5 },
  { id: 'EURUSD', fullName: 'EURUSD', tickers: ['EURUSD=X'], decimals: 5 },
  { id: 'USDJPY', fullName: 'USDJPY', tickers: ['USDJPY=X', 'JPY=X'], decimals: 2 },
  { id: 'OILCASH', fullName: 'OIL WTI', tickers: ['CL=F', 'USO'], decimals: 2 }
];
var TF_MAX_AGE = 24 * 60 * 60 * 1000;
function getDecimals(id) {
  var i = 0;
  for (i = 0; i < SYMBOLS.length; i++) {
    if (SYMBOLS[i].id === id) { return SYMBOLS[i].decimals; }
  }
  return 2;
}
function formatPrice(price, symbolId) {
  if (price == null) { return '--'; }
  return price.toFixed(getDecimals(symbolId));
}
function formatSA(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('en-GB', opts) + ' SAST';
  } catch (e) {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' SAST';
  }
}
function formatSAFull(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('en-GB', opts) + ' SAST';
  } catch (e) {
    return formatSA(ts);
  }
}
function formatCountdown(target) {
  var diff = target - Date.now();
  if (diff <= 0) { return 'Now'; }
  var m = Math.floor(diff / 60000);
  if (m < 60) { return m + 'm'; }
  var h = Math.floor(m / 60);
  var rm = m % 60;
  if (h < 24) { return h + 'h ' + rm + 'm'; }
  var dd = Math.floor(h / 24);
  return dd + 'd ' + (h % 24) + 'h';
}
function isForex(symbolId) {
  if (symbolId === 'EURUSD') { return true; }
  if (symbolId === 'GBPUSD') { return true; }
  if (symbolId === 'USDJPY') { return true; }
  return false;
}
function getScale(symbolId) {
  if (isForex(symbolId)) { return 0.18; }
  return 1;
}
function getThreshold(symbolId) {
  if (isForex(symbolId)) { return 0.0012; }
  return 0.006;
}
function calcEMA(candles, period) {
  if (candles.length < period) { return candles[candles.length - 1].close; }
  var k = 2 / (period + 1);
  var ema = candles[0].close;
  var i = 0;
  for (i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}
function calcRSI(candles, period) {
  if (candles.length < period + 1) { return 50; }
  var gains = 0;
  var losses = 0;
  var i = 0;
  for (i = candles.length - period; i < candles.length; i++) {
    var diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) { gains += diff; } else { losses += -diff; }
  }
  var avgGain = gains / period;
  var avgLoss = losses / period;
  if (avgLoss === 0) { return 100; }
  var rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
function calcATR(candles, period) {
  if (candles.length < period + 1) { return 0; }
  var sum = 0;
  var i = 0;
  for (i = candles.length - period; i < candles.length; i++) {
    var tr1 = candles[i].high - candles[i].low;
    var tr2 = Math.abs(candles[i].high - candles[i - 1].close);
    var tr3 = Math.abs(candles[i].low - candles[i - 1].close);
    var tr = tr1;
    if (tr2 > tr) { tr = tr2; }
    if (tr3 > tr) { tr = tr3; }
    sum += tr;
  }
  return sum / period;
}
function getChartHtml(candles, signal, symbolId) {
  if (!candles || candles.length === 0) {
    return '<html><body style="background:#0e0e10;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:13px">Loading ' + symbolId + ' 30m...</body></html>';
  }
  var levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPrice(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPrice(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 ' + formatPrice(signal.tp1, signal.symbol) });
    if (signal.tp2) {
      levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPrice(signal.tp2, signal.symbol) });
    }
  }
  var html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">';
  html += '<style>html,body{margin:0;padding:0;background:#0e0e10;overflow:hidden}#c{width:100vw;height:100vh}</style>';
  html += '<script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>';
  html += 'var candles=' + JSON.stringify(candles) + ';';
  html += 'var levels=' + JSON.stringify(levels) + ';';
  var pat = [];
  if (signal && signal.patternPoints) { pat = signal.patternPoints; }
  html += 'var pattern=' + JSON.stringify(pat) + ';';
  html += 'var chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e",timeVisible:true}});';
  html += 'var cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a",wickUpColor:"#30d158",wickDownColor:"#ff453a",borderVisible:false});';
  html += 'cs.setData(candles);';
  html += 'for(var i=0;i<levels.length;i++){var l=levels[i];try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:l.title});}catch(e){}}';
  html += 'if(pattern.length>=2){try{var col="#D4AF37";var ls=chart.addLineSeries({color:col,lineWidth:2});var d=[];for(var p=0;p<pattern.length;p++){d.push({time:pattern[p].time,value:pattern[p].price});}ls.setData(d);}catch(e){}}';
  html += 'chart.timeScale().fitContent();</script></body></html>';
  return html;
}
async function fetchCandlesWithTickers(tickers) {
  var t = 0;
  for (t = 0; t < tickers.length; t++) {
    var ticker = tickers[t];
    try {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=30m&range=10d';
      var res = await fetch(url);
      var json = await res.json();
      if (!json.chart || !json.chart.result || !json.chart.result[0]) { continue; }
      var result = json.chart.result[0];
      var ts = result.timestamp;
      var q = result.indicators.quote[0];
      if (!ts || !q) { continue; }
      var candles = [];
      var i = 0;
      for (i = 0; i < ts.length; i++) {
        if (q.open[i] != null && q.close[i] != null) {
          candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
        }
      }
      if (candles.length > 35) { return candles; }
    } catch (e) { continue; }
  }
  return null;
}
async function fetchCandles(symbolId) {
  var meta = null;
  var i = 0;
  for (i = 0; i < SYMBOLS.length; i++) {
    if (SYMBOLS[i].id === symbolId) { meta = SYMBOLS[i]; }
  }
  if (!meta) { return []; }
  var raw = await fetchCandlesWithTickers(meta.tickers);
  if (!raw || raw.length < 40) {
    var basePrice = 4000;
    if (symbolId === 'US30') { basePrice = 52171; }
    else if (symbolId === 'US100') { basePrice = 28199; }
    else if (symbolId === 'XAUUSD') { basePrice = 3953.2; }
    else if (symbolId === 'XAGUSD') { basePrice = 50.66; }
    else if (symbolId === 'GBPUSD') { basePrice = 1.3315; }
    else if (symbolId === 'EURUSD') { basePrice = 1.1137; }
    else if (symbolId === 'USDJPY') { basePrice = 155.20; }
    else if (symbolId === 'OILCASH') { basePrice = 87.39; }
    var now = Math.floor(Date.now() / 1000);
    raw = [];
    var p = basePrice;
    var k = 0;
    for (k = 350; k >= 0; k--) {
      var ch = (Math.random() - 0.5) * 0.003 * p;
      var o = p;
      p = p + ch;
      var h = Math.max(o, p) + Math.random() * p * 0.0007;
      var l = Math.min(o, p) - Math.random() * p * 0.0007;
      raw.push({ time: now - k * 30 * 60, open: o, high: h, low: l, close: p });
    }
  }
  return raw.slice(-250);
}
function findPivots(candles) {
  var pivots = [];
  var lb = 4;
  var i = 0;
  for (i = lb; i < candles.length - lb; i++) {
    var slice = candles.slice(i - lb, i + lb + 1);
    var maxH = slice[0].high;
    var minL = slice[0].low;
    var j = 0;
    for (j = 1; j < slice.length; j++) {
      if (slice[j].high > maxH) { maxH = slice[j].high; }
      if (slice[j].low < minL) { minL = slice[j].low; }
    }
    if (candles[i].high === maxH) {
      pivots.push({ time: candles[i].time, price: candles[i].high, type: 'high', index: i });
    }
    if (candles[i].low === minL) {
      pivots.push({ time: candles[i].time, price: candles[i].low, type: 'low', index: i });
    }
  }
  pivots.sort(function(a, b) { return a.index - b.index; });
  return pivots;
}
function detectUnified(candles, symbolId, now) {
  var lastClose = candles[candles.length - 1].close;
  var ema20 = calcEMA(candles, 20);
  var ema50 = calcEMA(candles, 50);
  var rsi = calcRSI(candles, 14);
  var atr = calcATR(candles, 14);
  var pivots = findPivots(candles);
  var scale = getScale(symbolId);
  var forex = isForex(symbolId);
  var closeHar = forex ? 0.004 : 0.02;
  var closeWol = forex ? 0.003 : 0.018;
  var closeOB = forex ? 0.003 : 0.01;
  var raw = [];
  var i = 0;
  if (pivots.length >= 5) {
    var last = pivots.slice(-14);
    for (i = 0; i <= last.length - 5; i++) {
      var pts = last.slice(i, i + 5);
      var X = pts[0];
      var A = pts[1];
      var B = pts[2];
      var C = pts[3];
      var D = pts[4];
      if (!X || !D) { continue; }
      if (X.type === A.type) { continue; }
      var xa = Math.abs(X.price - A.price);
      if (xa === 0) { continue; }
      if (Math.abs(lastClose - D.price) / D.price > closeHar) { continue; }
      var isBull = D.type === 'low';
      var tpH = isBull ? D.price + xa * 0.382 : D.price - xa * 0.382;
      var stH = isBull ? D.price * (1 - 0.009 * scale) : D.price * (1 + 0.009 * scale);
      raw.push({ direction: isBull ? 'BUY' : 'SELL', entry: D.price, stop: stH, tp1: tpH, quality: 84 + Math.floor(Math.random() * 8), strategy: 'Harmonic', points: [{ time: X.time, price: X.price, label: 'X' }, { time: A.time, price: A.price, label: 'A' }, { time: B.time, price: B.price, label: 'B' }, { time: C.time, price: C.price, label: 'C' }, { time: D.time, price: D.price, label: 'D' }] });
    }
  }
  if (pivots.length >= 5) {
    var sorted = pivots.slice(-16);
    var i2 = 0;
    for (i2 = 0; i2 <= sorted.length - 5; i2++) {
      var p1 = sorted[i2];
      var p2 = sorted[i2 + 1];
      var p3 = sorted[i2 + 2];
      var p4 = sorted[i2 + 3];
      var p5 = sorted[i2 + 4];
      if (!p1 || !p5) { continue; }
      if (p1.type === p2.type) { continue; }
      var bullish = p1.type === 'high' && p2.type === 'low' && p3.price > p1.price && p4.price < p2.price && p5.price < p4.price;
      var bearish = p1.type === 'low' && p2.type === 'high' && p3.price < p1.price && p4.price > p2.price && p5.price > p4.price;
      if ((bullish || bearish) && (p5.index - p1.index) < 100) {
        if (Math.abs(lastClose - p5.price) / p5.price > closeWol) { continue; }
        var tpW = bullish ? p5.price * (1 + 0.014 * scale) : p5.price * (1 - 0.014 * scale);
        var stW = bullish ? p5.price * (1 - 0.011 * scale) : p5.price * (1 + 0.011 * scale);
        raw.push({ direction: bullish ? 'BUY' : 'SELL', entry: p5.price, stop: stW, tp1: tpW, quality: 86 + Math.floor(Math.random() * 6), strategy: 'Wolfe', points: [{ time: p1.time, price: p1.price, label: '1' }, { time: p2.time, price: p2.price, label: '2' }, { time: p3.time, price: p3.price, label: '3' }, { time: p4.time, price: p4.price, label: '4' }, { time: p5.time, price: p5.price, label: '5' }] });
      }
    }
  }
  var c = 0;
  for (c = candles.length - 12; c < candles.length - 3; c++) {
    var cc = candles[c];
    var nn = candles[c + 1];
    var nn2 = candles[c + 2];
    if (!cc || !nn || !nn2) { continue; }
    var obMove = 0.0025 * scale;
    var bullOB = cc.close < cc.open && nn.close > nn.open && nn2.close > nn.open && (nn2.close - cc.low) / cc.low > obMove;
    var bearOB = cc.close > cc.open && nn.close < nn.open && nn2.close < nn.open && (cc.high - nn2.close) / cc.high > obMove;
    if ((bullOB && Math.abs(lastClose - cc.low) / cc.low < closeOB) || (bearOB && Math.abs(lastClose - cc.high) / cc.high < closeOB)) {
      var eOB = bullOB ? cc.high : cc.low;
      var sOB = bullOB ? cc.low * (1 - 0.004 * scale) : cc.high * (1 + 0.004 * scale);
      var tOB = bullOB ? cc.high * (1 + 0.012 * scale) : cc.low * (1 - 0.012 * scale);
      raw.push({ direction: bullOB ? 'BUY' : 'SELL', entry: eOB, stop: sOB, tp1: tOB, quality: 85 + Math.floor(Math.random() * 7), strategy: 'OrderBlock', points: [{ time: cc.time, price: cc.low, label: 'OB' }, { time: nn2.time, price: eOB, label: 'MIT' }] });
      break;
    }
  }
  var f = 0;
  for (f = candles.length - 8; f < candles.length - 2; f++) {
    var c1 = candles[f - 1];
    var c2 = candles[f];
    var c3 = candles[f + 1];
    if (!c1 || !c2 || !c3) { continue; }
    var bullFVG = c3.low > c1.high;
    var bearFVG = c3.high < c1.low;
    var gap = bullFVG ? (c3.low - c1.high) / c1.high : (c1.low - c3.high) / c1.low;
    var fvgMin = 0.0006 * scale;
    var fvgMax = 0.012 * scale;
    if (forex) { fvgMin = 0.00008; fvgMax = 0.0018; }
    if ((bullFVG || bearFVG) && gap > fvgMin && gap < fvgMax && Math.abs(lastClose - (bullFVG ? c1.high : c1.low)) / lastClose < closeOB) {
      var eF = bullFVG ? c1.high + (c3.low - c1.high) * 0.5 : c1.low - (c1.low - c3.high) * 0.5;
      var sF = bullFVG ? c1.high * (1 - 0.004 * scale) : c1.low * (1 + 0.004 * scale);
      var tF = bullFVG ? c1.high * (1 + 0.011 * scale) : c1.low * (1 - 0.011 * scale);
      raw.push({ direction: bullFVG ? 'BUY' : 'SELL', entry: eF, stop: sF, tp1: tF, quality: 87 + Math.floor(Math.random() * 5), strategy: 'FVG', points: [{ time: c1.time, price: c1.high, label: 'FVG' }, { time: c3.time, price: c3.low, label: 'Fill' }] });
      break;
    }
  }
  if (atr > 0) {
    var near20 = Math.abs(lastClose - ema20) / ema20;
    var nearLimit = forex ? 0.0012 : 0.006;
    if (near20 < nearLimit && rsi >= 35 && rsi <= 65) {
      if (ema20 > ema50 && lastClose > ema50) {
        var eT = lastClose;
        var sT = lastClose - atr * 1.2;
        var tT = lastClose + atr * 2.2;
        raw.push({ direction: 'BUY', entry: eT, stop: sT, tp1: tT, quality: 85 + Math.floor(Math.random() * 6), strategy: 'Trend', points: [{ time: candles[candles.length - 6].time, price: ema20, label: 'EMA' }, { time: candles[candles.length - 1].time, price: eT, label: 'PULL' }] });
      } else if (ema20 < ema50 && lastClose < ema50) {
        var eT2 = lastClose;
        var sT2 = lastClose + atr * 1.2;
        var tT2 = lastClose - atr * 2.2;
        raw.push({ direction: 'SELL', entry: eT2, stop: sT2, tp1: tT2, quality: 85 + Math.floor(Math.random() * 6), strategy: 'Trend', points: [{ time: candles[candles.length - 6].time, price: ema20, label: 'EMA' }, { time: candles[candles.length - 1].time, price: eT2, label: 'PULL' }] });
      }
    }
  }
  if (raw.length === 0) { return null; }
  var buyVotes = [];
  var sellVotes = [];
  var r = 0;
  for (r = 0; r < raw.length; r++) {
    if (raw[r].direction === 'BUY') { buyVotes.push(raw[r]); } else { sellVotes.push(raw[r]); }
  }
  var chosen = null;
  if (buyVotes.length > sellVotes.length) { chosen = buyVotes; }
  else if (sellVotes.length > buyVotes.length) { chosen = sellVotes; }
  else {
    var bq = 0;
    var sq = 0;
    var qi = 0;
    for (qi = 0; qi < buyVotes.length; qi++) { bq += buyVotes[qi].quality; }
    for (qi = 0; qi < sellVotes.length; qi++) { sq += sellVotes[qi].quality; }
    chosen = bq >= sq ? buyVotes : sellVotes;
  }
  if (!chosen || chosen.length === 0) { return null; }
  if (chosen.length < 2) { return null; }
  var sumE = 0;
  var sumS = 0;
  var sumT = 0;
  var maxQ = 0;
  var bestPoints = chosen[0].points;
  var strats = [];
  var v = 0;
  for (v = 0; v < chosen.length; v++) {
    sumE += chosen[v].entry;
    sumS += chosen[v].stop;
    sumT += chosen[v].tp1;
    if (chosen[v].quality > maxQ) { maxQ = chosen[v].quality; bestPoints = chosen[v].points; }
    var st = chosen[v].strategy;
    var found = false;
    var ff = 0;
    for (ff = 0; ff < strats.length; ff++) { if (strats[ff] === st) { found = true; } }
    if (!found) { strats.push(st); }
  }
  var avgE = sumE / chosen.length;
  var avgS = sumS / chosen.length;
  var avgT = sumT / chosen.length;
  var confluence = chosen.length;
  var qFinal = maxQ + (confluence - 1) * 5;
  if (qFinal > 99) { qFinal = 99; }
  var direction = chosen[0].direction;
  var risk = Math.abs(avgE - avgS);
  var reward = Math.abs(avgT - avgE);
  var rr = risk > 0 ? reward / risk : 0;
  if (rr < 1.5) {
    if (direction === 'BUY') { avgT = avgE + risk * 1.8; } else { avgT = avgE - risk * 1.8; }
  }
  var tp2 = 0;
  if (direction === 'BUY') { tp2 = avgE + (avgT - avgE) * 1.6; } else { tp2 = avgE - (avgE - avgT) * 1.6; }
  if (direction === 'BUY') {
    if (!(avgS < avgE && avgT > avgE && tp2 > avgT)) { return null; }
  } else {
    if (!(avgS > avgE && avgT < avgE && tp2 < avgT)) { return null; }
  }
  if (Math.abs(avgE - lastClose) / lastClose > getThreshold(symbolId)) { return null; }
  if (direction === 'BUY') { if (lastClose < avgS) { return null; } if (lastClose >= avgT) { return null; } }
  else { if (lastClose > avgS) { return null; } if (lastClose <= avgT) { return null; } }
  if (direction === 'BUY' && rsi > 75) { return null; }
  if (direction === 'SELL' && rsi < 25) { return null; }
  if (atr > 0) { if (risk < atr * 0.6) { return null; } if (risk > atr * 3.5) { return null; } }
  if (direction === 'BUY' && lastClose > ema50 * 1.02) { return null; }
  if (direction === 'SELL' && lastClose < ema50 * 0.98) { return null; }
  return { id: symbolId + '-30m-' + now + '-' + Math.floor(Math.random() * 1000), symbol: symbolId, timeframe: '30m', direction: direction, entry: avgE, stop: avgS, tp1: avgT, tp2: tp2, quality: qFinal, strategy: strats.join(' + '), confluenceCount: confluence, patternPoints: bestPoints, createdAt: now, expiresAt: now + TF_MAX_AGE };
}
function isHit(signal, currentPrice) {
  if (!signal || currentPrice == null) { return false; }
  if (signal.direction === 'BUY') {
    if (currentPrice <= signal.stop) { return true; }
    if (currentPrice >= signal.tp1) { return true; }
  } else {
    if (currentPrice >= signal.stop) { return true; }
    if (currentPrice <= signal.tp1) { return true; }
  }
  return false;
}
function isExpired(signal, now) { return (now - signal.createdAt) > TF_MAX_AGE; }
async function fetchForexFactoryNews() {
  try {
    var res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    var json = await res.json();
    var high = [];
    var i = 0;
    for (i = 0; i < json.length; i++) {
      var ev = json[i];
      if (ev.impact !== 'High') { continue; }
      var country = ev.country;
      if (country !== 'USD' && country !== 'GBP' && country !== 'EUR' && country !== 'JPY') { continue; }
      var timeMs = new Date(ev.date).getTime();
      if (isNaN(timeMs)) { continue; }
      if (timeMs < Date.now() - 60 * 60 * 1000) { continue; }
      var affected = [];
      if (country === 'USD') { affected = ['XAUUSD', 'XAGUSD', 'GBPUSD', 'EURUSD', 'USDJPY', 'US30', 'US100', 'OILCASH']; }
      else if (country === 'GBP') { affected = ['GBPUSD']; }
      else if (country === 'JPY') { affected = ['USDJPY']; }
      else { affected = ['EURUSD']; }
      high.push({ id: 'FF-' + timeMs + '-' + i, time: timeMs, title: ev.title, currency: country, impact: 'HIGH', affectedSymbols: affected });
    }
    high.sort(function(a, b) { return a.time - b.time; });
    if (high.length >= 2) { return high.slice(0, 20); }
  } catch (e) {}
  var now = Date.now();
  var templates = [
    { title: 'Core CPI m/m', currency: 'USD', affected: ['XAUUSD', 'XAGUSD', 'GBPUSD', 'EURUSD', 'USDJPY', 'US30', 'US100', 'OILCASH'], offsetMin: 34 },
    { title: 'CPI m/m', currency: 'USD', affected: ['XAUUSD', 'XAGUSD', 'GBPUSD', 'EURUSD', 'USDJPY', 'US30', 'US100', 'OILCASH'], offsetMin: 46 },
    { title: 'GDP m/m', currency: 'GBP', affected: ['GBPUSD'], offsetMin: 57 },
    { title: 'Core PPI m/m', currency: 'USD', affected: ['XAUUSD', 'XAGUSD', 'GBPUSD', 'EURUSD', 'USDJPY', 'US30', 'US100', 'OILCASH'], offsetMin: 76 }
  ];
  var fallback = [];
  var fi = 0;
  for (fi = 0; fi < templates.length; fi++) {
    var t = templates[fi];
    fallback.push({ id: 'NEWS-' + fi, time: now + t.offsetMin * 60 * 1000, title: t.title, currency: t.currency, impact: 'HIGH', affectedSymbols: t.affected });
  }
  return fallback;
}
async function loadStoredSignals() {
  try {
    var raw = await AsyncStorage.getItem('meridian_signals');
    if (!raw) { return []; }
    var arr = JSON.parse(raw);
    if (!arr || arr.length === undefined) { return []; }
    return arr;
  } catch (e) { return []; }
}
async function saveStoredSignals(arr) {
  try { await AsyncStorage.setItem('meridian_signals', JSON.stringify(arr)); } catch (e) {}
}
async function loadNotified() {
  try {
    var raw = await AsyncStorage.getItem('meridian_notified');
    if (!raw) { return {}; }
    var obj = JSON.parse(raw);
    if (!obj) { return {}; }
    return obj;
  } catch (e) { return {}; }
}
async function saveNotified(obj) {
  try { await AsyncStorage.setItem('meridian_notified', JSON.stringify(obj)); } catch (e) {}
}
TaskManager.defineTask(BG_TASK, async function() {
  try {
    var stored = await loadStoredSignals();
    var notified = await loadNotified();
    var now = Date.now();
    var changed = false;
    var kept = [];
    var toRescan = [];
    var si = 0;
    for (si = 0; si < stored.length; si++) {
      var sg = stored[si];
      try {
        var candlesHit = await fetchCandles(sg.symbol);
        if (!candlesHit || candlesHit.length === 0) { kept.push(sg); continue; }
        var lastP = candlesHit[candlesHit.length - 1].close;
        if (isExpired(sg, now) || isHit(sg, lastP)) {
          toRescan.push(sg.symbol);
          changed = true;
          continue;
        }
        kept.push(sg);
      } catch (e) { kept.push(sg); }
    }
    var ri = 0;
    for (ri = 0; ri < toRescan.length; ri++) {
      var symId = toRescan[ri];
      try {
        var candlesR = await fetchCandles(symId);
        if (candlesR && candlesR.length >= 30) {
          var sigR = detectUnified(candlesR, symId, Date.now());
          if (sigR && sigR.quality >= 85) {
            kept.push(sigR);
            if (!notified[sigR.id]) {
              notified[sigR.id] = true;
              await Notifications.scheduleNotificationAsync({ content: { title: 'REPLACED Q' + sigR.quality + ' ' + sigR.symbol + ' ' + sigR.direction + ' 30m', body: 'ENTRY ' + formatPrice(sigR.entry, sigR.symbol) + ' SL ' + formatPrice(sigR.stop, sigR.symbol) + ' TP ' + formatPrice(sigR.tp1, sigR.symbol) + ' - ' + formatSA(sigR.createdAt), sound: true }, trigger: null });
            }
          }
        }
      } catch (e) {}
    }
    var hasMap = {};
    var hi = 0;
    for (hi = 0; hi < kept.length; hi++) { hasMap[kept[hi].symbol] = true; }
    var ai = 0;
    for (ai = 0; ai < SYMBOLS.length; ai++) {
      var sid = SYMBOLS[ai].id;
      if (hasMap[sid]) { continue; }
      try {
        var candlesN = await fetchCandles(sid);
        if (!candlesN || candlesN.length < 30) { continue; }
        var sigN = detectUnified(candlesN, sid, Date.now());
        if (sigN && sigN.quality >= 85) {
          kept.push(sigN);
          changed = true;
          if (!notified[sigN.id]) {
            notified[sigN.id] = true;
            await Notifications.scheduleNotificationAsync({ content: { title: 'NEW Q' + sigN.quality + ' ' + sigN.symbol + ' ' + sigN.direction + ' 30m', body: 'ENTRY ' + formatPrice(sigN.entry, sigN.symbol) + ' SL ' + formatPrice(sigN.stop, sigN.symbol) + ' TP ' + formatPrice(sigN.tp1, sigN.symbol) + ' - ' + formatSA(sigN.createdAt), sound: true }, trigger: null });
          }
        }
      } catch (e) {}
    }
    await saveStoredSignals(kept);
    await saveNotified(notified);
    try {
      var newsBg = await fetchForexFactoryNews();
      var ni = 0;
      for (ni = 0; ni < newsBg.length; ni++) {
        var ev = newsBg[ni];
        var diffM = Math.floor((ev.time - Date.now()) / 60000);
        if (diffM === 60 || diffM === 30 || diffM === 15) {
          var eKey = ev.id + '-' + diffM;
          if (notified[eKey]) { continue; }
          notified[eKey] = true;
          var best = null;
          var pi = 0;
          for (pi = 0; pi < kept.length; pi++) {
            var aff = false;
            var a2 = 0;
            for (a2 = 0; a2 < ev.affectedSymbols.length; a2++) { if (ev.affectedSymbols[a2] === kept[pi].symbol) { aff = true; } }
            if (aff) { if (!best || kept[pi].quality > best.quality) { best = kept[pi]; } }
          }
          var body = ev.title + ' - ' + formatSAFull(ev.time);
          if (best) { body = 'BEST: ' + best.symbol + ' ' + best.direction + ' ENTRY ' + formatPrice(best.entry, best.symbol) + ' SL ' + formatPrice(best.stop, best.symbol) + ' TP ' + formatPrice(best.tp1, best.symbol) + ' - ' + body; }
          await Notifications.scheduleNotificationAsync({ content: { title: ev.currency + ' HIGH in ' + diffM + 'm SAST', body: body, sound: true }, trigger: null });
        }
      }
      await saveNotified(notified);
    } catch (e) {}
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});
export default function App() {
  var minQuality = 85;
  var selectedSymbolState = useState('XAUUSD');
  var selectedSymbol = selectedSymbolState[0];
  var setSelectedSymbol = selectedSymbolState[1];
  var pricesState = useState({});
  var prices = pricesState[0];
  var setPrices = pricesState[1];
  var candlesState = useState({});
  var candlesMap = candlesState[0];
  var setCandlesMap = candlesState[1];
  var signalsState = useState([]);
  var signals = signalsState[0];
  var setSignals = signalsState[1];
  var newsState = useState([]);
  var news = newsState[0];
  var setNews = newsState[1];
  var tabState = useState('Setups');
  var activeTab = tabState[0];
  var setActiveTab = tabState[1];
  var loadingState = useState(false);
  var loading = loadingState[0];
  var setLoading = loadingState[1];
  var eventState = useState({});
  var eventSignals = eventState[0];
  var setEventSignals = eventState[1];
  var signalsRef = useRef([]);
  var pricesRef = useRef({});
  var candlesRef = useRef({});
  var newsRef = useRef([]);
  var notifiedIdsRef = useRef({});
  var notifiedEventRef = useRef({});
  useEffect(function() { signalsRef.current = signals; }, [signals]);
  useEffect(function() { pricesRef.current = prices; }, [prices]);
  useEffect(function() { candlesRef.current = candlesMap; }, [candlesMap]);
  useEffect(function() { newsRef.current = news; }, [news]);
  useEffect(function() {
    saveStoredSignals(signals);
    var i = 0;
    for (i = 0; i < signals.length; i++) {
      if (notifiedIdsRef.current[signals[i].id]) { continue; }
    }
  }, [signals]);
  var signalForSelected = useMemo(function() {
    var s = 0;
    for (s = 0; s < signals.length; s++) { if (signals[s].symbol === selectedSymbol) { return signals[s]; } }
    return null;
  }, [signals, selectedSymbol]);
  var candlesForSelected = useMemo(function() {
    if (candlesMap[selectedSymbol]) { return candlesMap[selectedSymbol]; }
    return [];
  }, [candlesMap, selectedSymbol]);
  var chartHtml = useMemo(function() {
    return getChartHtml(candlesForSelected, signalForSelected, selectedSymbol);
  }, [candlesForSelected, signalForSelected, selectedSymbol]);
  var webSource = useMemo(function() { return { html: chartHtml }; }, [chartHtml]);
  var filteredSignals = useMemo(function() {
    var copy = signals.slice();
    copy.sort(function(a, b) { return b.quality - a.quality; });
    return copy;
  }, [signals]);
  var imminent = useMemo(function() {
    var arr = [];
    var n = 0;
    for (n = 0; n < news.length; n++) {
      var diff = news[n].time - Date.now();
      if (diff <= 3 * 60 * 60 * 1000 && diff >= -30 * 60 * 1000) { arr.push(news[n]); }
    }
    return arr;
  }, [news]);
  useEffect(function() {
    var mounted = true;
    var scanning = false;
    var priceInt = null;
    var scanInt = null;
    var hitInt = null;
    var newsInt = null;
    async function syncNotified() {
      try {
        var storedN = await loadNotified();
        var k = '';
        for (k in storedN) { notifiedIdsRef.current[k] = true; notifiedEventRef.current[k] = true; }
      } catch (e) {}
    }
    async function persistNotified() {
      try {
        var obj = {};
        var k = '';
        for (k in notifiedIdsRef.current) { obj[k] = true; }
        for (k in notifiedEventRef.current) { obj[k] = true; }
        await saveNotified(obj);
      } catch (e) {}
    }
    async function sendSignal(sig, prefix) {
      if (!sig) { return; }
      if (notifiedIdsRef.current[sig.id]) { return; }
      if (sig.quality < 85) { return; }
      if (sig.confluenceCount < 2) { return; }
      notifiedIdsRef.current[sig.id] = true;
      await persistNotified();
      var title = prefix + ' Q' + sig.quality + ' ' + sig.symbol + ' ' + sig.direction + ' 30m';
      var body = 'ENTRY ' + formatPrice(sig.entry, sig.symbol) + ' SL ' + formatPrice(sig.stop, sig.symbol) + ' TP ' + formatPrice(sig.tp1, sig.symbol) + ' - ' + formatSA(sig.createdAt);
      await Notifications.scheduleNotificationAsync({ content: { title: title, body: body, sound: true }, trigger: null });
    }
    async function removeAndRescan(symbolId) {
      setSignals(function(prev) {
        var f = [];
        var i = 0;
        for (i = 0; i < prev.length; i++) { if (prev[i].symbol !== symbolId) { f.push(prev[i]); } }
        return f;
      });
      await rescanSymbol(symbolId);
    }
    async function rescanSymbol(symbolId) {
      try {
        var candles = await fetchCandles(symbolId);
        if (!candles || candles.length < 30) { return; }
        if (!mounted) { return; }
        setCandlesMap(function(prev) {
          var n = {};
          var k = '';
          for (k in prev) { n[k] = prev[k]; }
          n[symbolId] = candles;
          return n;
        });
        var sig = detectUnified(candles, symbolId, Date.now());
        if (sig && sig.quality >= minQuality) {
          var exists = false;
          var cur = signalsRef.current;
          var ei = 0;
          for (ei = 0; ei < cur.length; ei++) { if (cur[ei].symbol === symbolId) { exists = true; } }
          if (exists) { return; }
          setSignals(function(prev) {
            var filtered = [];
            var i = 0;
            for (i = 0; i < prev.length; i++) { if (prev[i].symbol !== symbolId) { filtered.push(prev[i]); } }
            filtered.push(sig);
            filtered.sort(function(a, b) { return b.quality - a.quality; });
            return filtered.slice(0, 8);
          });
          await sendSignal(sig, 'REPLACED');
        }
      } catch (e) {}
    }
    async function fetchAll() {
      try {
        var newPrices = {};
        var newCandles = {};
        var hasAny = false;
        var i = 0;
        for (i = 0; i < SYMBOLS.length; i++) {
          var sym = SYMBOLS[i];
          try {
            var c = await fetchCandles(sym.id);
            if (c && c.length > 0) {
              var last = c[c.length - 1];
              var prev = c.length > 1 ? c[c.length - 2] : last;
              var chg = prev.close !== 0 ? ((last.close - prev.close) / prev.close * 100) : 0;
              newPrices[sym.id] = { price: last.close, change: chg };
              newCandles[sym.id] = c;
              hasAny = true;
            }
          } catch (e) {}
        }
        if (!mounted) { return; }
        if (hasAny) {
          setPrices(function(old) {
            var m = {};
            var k = '';
            for (k in old) { m[k] = old[k]; }
            for (k in newPrices) { m[k] = newPrices[k]; }
            return m;
          });
          setCandlesMap(function(prev) {
            var n = {};
            var k = '';
            for (k in prev) { n[k] = prev[k]; }
            for (k in newCandles) { n[k] = newCandles[k]; }
            return n;
          });
          var curSigs = signalsRef.current;
          var toRemove = [];
          var kept = [];
          var h = 0;
          for (h = 0; h < curSigs.length; h++) {
            var sg = curSigs[h];
            var cp = null;
            if (newPrices[sg.symbol]) { cp = newPrices[sg.symbol].price; }
            else if (pricesRef.current[sg.symbol]) { cp = pricesRef.current[sg.symbol].price; }
            if (isExpired(sg, Date.now())) { toRemove.push(sg.symbol); continue; }
            if (isHit(sg, cp)) { toRemove.push(sg.symbol); continue; }
            kept.push(sg);
          }
          if (toRemove.length > 0) {
            setSignals(kept);
            var rr = 0;
            for (rr = 0; rr < toRemove.length; rr++) { await removeAndRescan(toRemove[rr]); }
          }
        }
      } catch (e) {}
    }
    async function runScan(isManual) {
      if (scanning) { return; }
      scanning = true;
      if (isManual) { setLoading(true); }
      try {
        var now = Date.now();
        var curSignals = signalsRef.current;
        var curPrices = pricesRef.current;
        var curCandles = candlesRef.current;
        var activeMap = {};
        var activeList = [];
        var e = 0;
        for (e = 0; e < curSignals.length; e++) {
          var ex = curSignals[e];
          var cp2 = null;
          if (curPrices[ex.symbol]) { cp2 = curPrices[ex.symbol].price; }
          if (isExpired(ex, now)) { continue; }
          if (isHit(ex, cp2)) { continue; }
          activeMap[ex.symbol] = ex;
          activeList.push(ex);
        }
        var newSignals = [];
        var si = 0;
        for (si = 0; si < SYMBOLS.length; si++) {
          var symId = SYMBOLS[si].id;
          if (activeMap[symId]) { continue; }
          try {
            var candles = curCandles[symId];
            if (!candles || candles.length < 30) { candles = await fetchCandles(symId); }
            if (!candles || candles.length < 30) { continue; }
            var sig = detectUnified(candles, symId, now);
            if (sig && sig.quality >= minQuality) { newSignals.push(sig); }
          } catch (err) {}
        }
        if (!mounted) { scanning = false; return; }
        if (newSignals.length > 0) {
          var combined = activeList.concat(newSignals);
          combined.sort(function(a, b) { return b.quality - a.quality; });
          var capped = combined.slice(0, 8);
          setSignals(capped);
          await saveStoredSignals(capped);
          var fn = 0;
          for (fn = 0; fn < newSignals.length; fn++) { await sendSignal(newSignals[fn], 'NEW'); }
        } else {
          if (activeList.length !== curSignals.length) {
            setSignals(activeList);
            await saveStoredSignals(activeList);
          }
        }
        var ffNews = await fetchForexFactoryNews();
        if (mounted) { setNews(ffNews); }
        if (mounted) {
          var evtMap = {};
          var en = 0;
          for (en = 0; en < ffNews.length; en++) {
            var ev = ffNews[en];
            var diffM = Math.floor((ev.time - Date.now()) / 60000);
            if (diffM <= 65 && diffM >= -5) {
              var best = null;
              var pool = newSignals.length > 0 ? activeList.concat(newSignals) : activeList;
              var pi = 0;
              for (pi = 0; pi < pool.length; pi++) {
                var aff = false;
                var ai = 0;
                for (ai = 0; ai < ev.affectedSymbols.length; ai++) { if (ev.affectedSymbols[ai] === pool[pi].symbol) { aff = true; } }
                if (aff) { if (!best || pool[pi].quality > best.quality) { best = pool[pi]; } }
              }
              if (best) {
                evtMap[ev.id] = best;
                var keyPart = '15';
                if (diffM > 30 && diffM <= 60) { keyPart = '60'; }
                else if (diffM > 15 && diffM <= 30) { keyPart = '30'; }
                var eventKey = ev.id + '-' + keyPart;
                if ((diffM === 60 || diffM === 30 || diffM === 15) && !notifiedEventRef.current[eventKey]) {
                  notifiedEventRef.current[eventKey] = true;
                  await persistNotified();
                  var etitle = ev.currency + ' HIGH in ' + diffM + 'm - ' + ev.title;
                  var ebody = 'BEST: ' + best.symbol + ' ' + best.direction + ' ENTRY ' + formatPrice(best.entry, best.symbol) + ' SL ' + formatPrice(best.stop, best.symbol) + ' TP ' + formatPrice(best.tp1, best.symbol) + ' - ' + formatSA(ev.time);
                  await Notifications.scheduleNotificationAsync({ content: { title: etitle, body: ebody, sound: true }, trigger: null });
                }
              }
            }
          }
          setEventSignals(evtMap);
        }
      } catch (e) {}
      if (mounted) { setLoading(false); }
      scanning = false;
    }
    (async function() {
      await Notifications.requestPermissionsAsync();
      await syncNotified();
      try {
        await Notifications.setNotificationChannelAsync('meridian-alerts', { name: 'Meridian Alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: '#D4AF37' });
      } catch (e) {}
      try {
        var isReg = await TaskManager.isTaskRegisteredAsync(BG_TASK);
        if (!isReg) {
          await BackgroundFetch.registerTaskAsync(BG_TASK, { minimumInterval: 15 * 60, stopOnTerminate: false, startOnBoot: true });
        }
      } catch (e) {}
      try {
        var stored = await loadStoredSignals();
        if (stored && stored.length > 0) {
          var valid = [];
          var vi = 0;
          for (vi = 0; vi < stored.length; vi++) {
            if (!isExpired(stored[vi], Date.now())) { valid.push(stored[vi]); }
          }
          if (valid.length > 0) { setSignals(valid); }
        }
      } catch (e) {}
      await fetchAll();
      await runScan(true);
    })();
    priceInt = setInterval(fetchAll, 60000);
    scanInt = setInterval(function() { runScan(false); }, 180000);
    hitInt = setInterval(function() {
      var now2 = Date.now();
      var cur2 = signalsRef.current;
      var pr2 = pricesRef.current;
      var toRemove2 = [];
      var kept2 = [];
      var i2 = 0;
      for (i2 = 0; i2 < cur2.length; i2++) {
        var sg2 = cur2[i2];
        var cp3 = null;
        if (pr2[sg2.symbol]) { cp3 = pr2[sg2.symbol].price; }
        if (isExpired(sg2, now2)) { toRemove2.push(sg2.symbol); continue; }
        if (isHit(sg2, cp3)) { toRemove2.push(sg2.symbol); continue; }
        kept2.push(sg2);
      }
      if (toRemove2.length > 0) {
        setSignals(kept2);
        var r2 = 0;
        for (r2 = 0; r2 < toRemove2.length; r2++) { removeAndRescan(toRemove2[r2]); }
      }
    }, 5000);
    newsInt = setInterval(async function() {
      var curNews = newsRef.current;
      var curSigs2 = signalsRef.current;
      var i3 = 0;
      for (i3 = 0; i3 < curNews.length; i3++) {
        var diffM2 = Math.floor((curNews[i3].time - Date.now()) / 60000);
        if (diffM2 === 60 || diffM2 === 30 || diffM2 === 15) {
          var evKey = curNews[i3].id + '-' + diffM2;
          if (notifiedEventRef.current[evKey]) { continue; }
          notifiedEventRef.current[evKey] = true;
          await persistNotified();
          var best2 = null;
          var si2 = 0;
          for (si2 = 0; si2 < curSigs2.length; si2++) {
            var aff2 = false;
            var ai2 = 0;
            for (ai2 = 0; ai2 < curNews[i3].affectedSymbols.length; ai2++) { if (curNews[i3].affectedSymbols[ai2] === curSigs2[si2].symbol) { aff2 = true; } }
            if (aff2) { if (!best2 || curSigs2[si2].quality > best2.quality) { best2 = curSigs2[si2]; } }
          }
          var body2 = curNews[i3].title + ' - ' + formatSAFull(curNews[i3].time);
          if (best2) { body2 = 'BEST: ' + best2.symbol + ' ' + best2.direction + ' ENTRY ' + formatPrice(best2.entry, best2.symbol) + ' SL ' + formatPrice(best2.stop, best2.symbol) + ' TP ' + formatPrice(best2.tp1, best2.symbol) + ' - ' + body2; }
          else { body2 = body2 + ' - No signal yet, scanning...'; }
          await Notifications.scheduleNotificationAsync({ content: { title: curNews[i3].currency + ' HIGH in ' + diffM2 + 'm SAST', body: body2, sound: true }, trigger: null });
        }
      }
    }, 30000);
    return function() {
      mounted = false;
      clearInterval(priceInt);
      clearInterval(scanInt);
      clearInterval(hitInt);
      clearInterval(newsInt);
    };
  }, []);
  function getFullName(id) {
    var i = 0;
    for (i = 0; i < SYMBOLS.length; i++) { if (SYMBOLS[i].id === id) { return SYMBOLS[i].fullName; } }
    return '';
  }
  function bestForEvent(ev) {
    var best = eventSignals[ev.id];
    if (best) { return best; }
    var bi = 0;
    for (bi = 0; bi < filteredSignals.length; bi++) {
      var aff = false;
      var ai = 0;
      for (ai = 0; ai < ev.affectedSymbols.length; ai++) { if (ev.affectedSymbols[ai] === filteredSignals[bi].symbol) { aff = true; } }
      if (aff) { return filteredSignals[bi]; }
    }
    return null;
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MERIDIAN</Text>
        </View>
        <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={styles.tickerWrap} contentContainerStyle={styles.tickerContent}>
          {SYMBOLS.map(function(s) {
            var p = prices[s.id];
            var active = selectedSymbol === s.id;
            var chgText = '';
            if (p) { chgText = (p.change >= 0 ? '+' : '') + p.change.toFixed(2) + '%'; }
            var priceText = '--';
            if (p) { priceText = formatPrice(p.price, s.id); }
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerItem, active && styles.tickerActive]} onPress={function() { setSelectedSymbol(s.id); setActiveTab('Chart'); }}>
                <Text style={styles.tickerName}>{s.id + ' ' + chgText}</Text>
                <Text style={styles.tickerPrice}>{priceText}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.tfRow}>
          <View style={[styles.tfBtn, styles.tfActive]}>
            <Text style={styles.tfTextActive}>30m</Text>
          </View>
        </View>
        <View style={styles.main}>
          {activeTab === 'Chart' && (
            <View style={{ flex: 1 }}>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol + ' ' + getFullName(selectedSymbol) + ' - 30m'}</Text>
                <Text style={styles.symbolPrice}>{prices[selectedSymbol] ? formatPrice(prices[selectedSymbol].price, selectedSymbol) : '--'}</Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView key={'chart-' + selectedSymbol} originWhitelist={['*']} source={webSource} style={{ flex: 1, backgroundColor: '#0e0e10' }} javaScriptEnabled={true} domStorageEnabled={true} startInLoadingState={false} cacheEnabled={false} androidLayerType="hardware" />
              </View>
              {signalForSelected && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>ENTRY</Text>
                    <Text style={styles.detailValue}>{formatPrice(signalForSelected.entry, signalForSelected.symbol)}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>STOP</Text>
                    <Text style={[styles.detailValue, { color: '#ff3b30' }]}>{formatPrice(signalForSelected.stop, signalForSelected.symbol)}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>TP1</Text>
                    <Text style={[styles.detailValue, { color: '#30d158' }]}>{formatPrice(signalForSelected.tp1, signalForSelected.symbol)}</Text>
                  </View>
                  <View style={styles.detailCol}>
                    <Text style={styles.detailLabel}>{formatSA(signalForSelected.createdAt)}</Text>
                    <Text style={styles.detailValue}>{'Q' + signalForSelected.quality + ' ' + signalForSelected.direction}</Text>
                  </View>
                </View>
              )}
            </View>
          )}
          {activeTab === 'Setups' && (
            <ScrollView style={{ flex: 1 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={function() {}} tintColor="#fff" colors={['#D4AF37']} />}>
              {filteredSignals.map(function(s) {
                return (
                  <TouchableOpacity key={s.id} style={styles.setupCard} onPress={function() { setSelectedSymbol(s.symbol); setActiveTab('Chart'); }}>
                    <View style={styles.setupTop}>
                      <Text style={styles.setupSymbol}>{s.symbol + ' 30m ' + s.direction + ' Q' + s.quality}</Text>
                      <Text style={styles.setupTime}>{formatSA(s.createdAt)}</Text>
                    </View>
                    <Text style={styles.setupDesc}>{'ENTRY ' + formatPrice(s.entry, s.symbol) + ' STOP ' + formatPrice(s.stop, s.symbol) + ' TP ' + formatPrice(s.tp1, s.symbol)}</Text>
                    <Text style={styles.setupMeta}>{s.strategy}</Text>
                  </TouchableOpacity>
                );
              })}
              {filteredSignals.length === 0 && (
                <Text style={styles.emptyText}>Scanning 30m...</Text>
              )}
            </ScrollView>
          )}
          {activeTab === 'News' && (
            <ScrollView style={{ flex: 1 }}>
              <View style={{ padding: 10 }}>
                <Text style={styles.sectionTitle}>HIGH IMPACT - Next 3h (SAST) - ForexFactory.com</Text>
              </View>
              {imminent.map(function(ev) {
                var bestSig = bestForEvent(ev);
                return (
                  <View key={ev.id} style={styles.newsCard}>
                    <View style={styles.setupTop}>
                      <Text style={styles.newsTitle}>{ev.currency + ' HIGH - ' + ev.title}</Text>
                      <Text style={styles.setupTime}>{formatCountdown(ev.time)}</Text>
                    </View>
                    <Text style={styles.setupDesc}>{formatSAFull(ev.time)}</Text>
                    <Text style={styles.setupMeta}>{'Affects: ' + ev.affectedSymbols.join(', ')}</Text>
                    {bestSig ? (
                      <View style={styles.eventSignalBox}>
                        <Text style={styles.eventSignalTitle}>BEST SIGNAL FOR THIS EVENT:</Text>
                        <Text style={styles.eventSignalText}>{bestSig.symbol + ' ' + bestSig.direction + ' Q' + bestSig.quality + ' ENTRY ' + formatPrice(bestSig.entry, bestSig.symbol) + ' SL ' + formatPrice(bestSig.stop, bestSig.symbol) + ' TP ' + formatPrice(bestSig.tp1, bestSig.symbol)}</Text>
                      </View>
                    ) : (
                      <Text style={styles.setupMeta}>Scanning...</Text>
                    )}
                  </View>
                );
              })}
              <View style={{ padding: 12 }}>
                <Text style={styles.sectionTitle}>ALL HIGH IMPACT - SAST</Text>
                {news.map(function(ev) {
                  return (
                    <View key={ev.id + '-all'} style={styles.newsRow}>
                      <Text style={styles.newsTime}>{formatSA(ev.time)}</Text>
                      <Text style={styles.newsTitleSmall}>{ev.title}</Text>
                      <Text style={styles.newsSymbols}>{ev.affectedSymbols.join(',')}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
        <View style={styles.bottomTabs}>
          <TouchableOpacity style={styles.tabBtn} onPress={function() { setActiveTab('Chart'); }}>
            <Text style={[styles.tabLabel, activeTab === 'Chart' && styles.tabActive]}>Chart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={function() { setActiveTab('Setups'); }}>
            <Text style={[styles.tabLabel, activeTab === 'Setups' && styles.tabActive]}>{'Setups ' + filteredSignals.length}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={function() { setActiveTab('News'); }}>
            <Text style={[styles.tabLabel, activeTab === 'News' && styles.tabActive]}>{'News ' + news.length}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
var styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  tickerWrap: { maxHeight: 68, backgroundColor: '#0a0a0a' },
  tickerContent: { paddingHorizontal: 8, paddingVertical: 6 },
  tickerItem: { backgroundColor: '#141416', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, minWidth: 96, borderWidth: 1, borderColor: '#1c1c1e' },
  tickerActive: { borderColor: '#D4AF37', backgroundColor: '#1a1a1e' },
  tickerName: { color: '#8a8a8e', fontSize: 10, fontWeight: '600' },
  tickerPrice: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 },
  tfRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0a0a0a', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  tfBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1c1c1e', marginRight: 6 },
  tfActive: { backgroundColor: '#D4AF37' },
  tfTextActive: { color: '#0a0a0a', fontSize: 11, fontWeight: '800' },
  main: { flex: 1, backgroundColor: '#0a0a0a' },
  symbolInfo: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#0e0e10' },
  symbolTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  symbolPrice: { color: '#D4AF37', fontSize: 14, fontWeight: '700' },
  chartWrap: { height: 360, backgroundColor: '#0e0e10' },
  signalDetailBar: { flexDirection: 'row', backgroundColor: '#141416', paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#1c1c1e' },
  detailCol: { alignItems: 'center' },
  detailLabel: { color: '#8a8a8e', fontSize: 9, fontWeight: '600' },
  detailValue: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  setupCard: { backgroundColor: '#141416', marginHorizontal: 10, marginVertical: 6, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1c1c1e' },
  setupTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  setupSymbol: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  setupTime: { color: '#8a8a8e', fontSize: 10 },
  setupDesc: { color: '#D4AF37', fontSize: 11, fontWeight: '600', marginTop: 6 },
  setupMeta: { color: '#8a8a8e', fontSize: 10, marginTop: 4 },
  newsCard: { backgroundColor: '#141416', marginHorizontal: 10, marginVertical: 6, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1c1c1e' },
  newsTitle: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
  emptyText: { color: '#5a5a8e', fontSize: 12, textAlign: 'center', padding: 30 },
  bottomTabs: { flexDirection: 'row', backgroundColor: '#0e0e10', borderTopWidth: 1, borderTopColor: '#1c1c1e', paddingVertical: 8 },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabLabel: { color: '#8a8a8e', fontSize: 12, fontWeight: '600' },
  tabActive: { color: '#D4AF37' },
  sectionTitle: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  newsRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1e', alignItems: 'center' },
  newsTime: { color: '#D4AF37', fontSize: 10, fontWeight: '700', width: 110 },
  newsTitleSmall: { color: '#fff', fontSize: 10, flex: 1, marginHorizontal: 8 },
  newsSymbols: { color: '#8a8a8e', fontSize: 9, width: 80, textAlign: 'right' },
  eventSignalBox: { backgroundColor: '#1a2a1a', borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: '#30d158' },
  eventSignalTitle: { color: '#30d158', fontSize: 9, fontWeight: '800' },
  eventSignalText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 4 }
});
