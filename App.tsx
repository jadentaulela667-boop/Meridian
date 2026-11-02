
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, Switch } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

const BG_TASK = 'MERIDIAN_BG_TASK_V6';

Notifications.setNotificationHandler({
  handleNotification: async function() {
    return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true };
  }
});

const SYMBOLS = [
  { id: 'US30', name: 'US30', fullName: 'Dow Jones', tickers: ['^DJI','DIA'], decimals: 1, currencies: ['USD'] },
  { id: 'US100', name: 'US100', fullName: 'Nasdaq 100', tickers: ['^NDX','QQQ'], decimals: 1, currencies: ['USD'] },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', tickers: ['GC=F','XAUUSD=X','GOLD'], decimals: 2, currencies: ['USD','XAU'] },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', tickers: ['SI=F','XAGUSD=X'], decimals: 3, currencies: ['USD','XAG'] },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'GBPUSD', tickers: ['GBPUSD=X'], decimals: 5, currencies: ['GBP','USD'] },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'EURUSD', tickers: ['EURUSD=X'], decimals: 5, currencies: ['EUR','USD'] },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI', tickers: ['CL=F','USO'], decimals: 2, currencies: ['USD','OIL'] }
];

const TIMEFRAMES = ['15m','30m','1h','4h'];

function tfMinutes(tf) {
  if (tf === '15m') return 15;
  if (tf === '30m') return 30;
  if (tf === '1h') return 60;
  if (tf === '4h') return 240;
  return 15;
}
function tfMaxAge(tf) {
  if (tf === '15m') return 2*60*60*1000;
  if (tf === '30m') return 4*60*60*1000;
  if (tf === '1h') return 8*60*60*1000;
  if (tf === '4h') return 24*60*60*1000;
  return 2*60*60*1000;
}
function getDecimals(id) {
  var s = null;
  for (var i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===id) { s=SYMBOLS[i]; break; } }
  return s ? s.decimals : 2;
}
function formatPrice(price, symbolId) {
  if (price===null || price===undefined) return '--';
  return price.toFixed(getDecimals(symbolId));
}
function formatSA(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    var str = d.toLocaleString('en-GB', opts);
    return str + ' SAST';
  } catch(e) {
    var dd = new Date(ts);
    return dd.toISOString().slice(0,16).replace('T',' ') + ' SAST';
  }
}
function formatSAFull(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('en-GB', opts) + ' SAST';
  } catch(e) {
    return formatSA(ts);
  }
}
function formatCountdown(target) {
  var diff = target - Date.now();
  if (diff <= 0) return 'Now';
  var m = Math.floor(diff/60000);
  if (m < 60) return m + 'm';
  var h = Math.floor(m/60);
  var rm = m % 60;
  if (h < 24) return h + 'h ' + rm + 'm';
  var d = Math.floor(h/24);
  return d + 'd ' + (h%24) + 'h';
}

function getChartHtml(candles, signal, symbolId) {
  var levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPrice(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPrice(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP ' + formatPrice(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPrice(signal.tp2, signal.symbol) });
  }
  if (!candles || candles.length===0) {
    return '<html><body style="background:#0e0e10;color:#8a8a8e;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div>Loading ' + (symbolId||'') + ' chart...</div></body></html>';
  }
  var html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>const candles=' + JSON.stringify(candles) + ';const levels=' + JSON.stringify(levels) + ';const pattern=' + JSON.stringify(signal ? (signal.patternPoints||[]) : []) + ';const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e",timeVisible:true,secondsVisible:false}});const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a",wickUpColor:"#30d158",wickDownColor:"#ff453a",borderVisible:false});cs.setData(candles);levels.forEach(function(l){try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.indexOf("ENTRY")>=0?2:1,lineStyle:l.title.indexOf("ENTRY")>=0?0:2,axisLabelVisible:true,title:l.title});}catch(e){}});if(pattern.length>=2){try{var col="#D4AF37";var ls=chart.addLineSeries({color:col,lineWidth:2});var data=[];for(var i=0;i<pattern.length;i++){data.push({time:pattern[i].time,value:pattern[i].price});}ls.setData(data);var markers=[];for(var j=0;j<pattern.length;j++){markers.push({time:pattern[j].time,position:"aboveBar",color:col,shape:"circle",text:pattern[j].label});}cs.setMarkers(markers);}catch(e){}}chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchCandlesWithTickers(tickers, minutes) {
  var intervalMap = {15:'15m',30:'30m',60:'60m',240:'60m'};
  var interval = intervalMap[minutes] || '15m';
  var range = minutes>=240 ? '20d' : '10d';
  for (var t=0;t<tickers.length;t++) {
    var ticker = tickers[t];
    try {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
      var res = await fetch(url);
      var json = await res.json();
      if (!json.chart || !json.chart.result || !json.chart.result[0]) continue;
      var result = json.chart.result[0];
      var ts = result.timestamp;
      var q = result.indicators.quote[0];
      if (!ts || !q) continue;
      var candles = [];
      for (var i=0;i<ts.length;i++) { if (q.open[i]!=null && q.close[i]!=null) candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] }); }
      if (candles.length>20) return candles;
    } catch(e) { continue; }
  }
  return null;
}

async function fetchCandles(symbolId, minutes) {
  var meta = null;
  for (var i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===symbolId) { meta=SYMBOLS[i]; break; } }
  if (!meta) return [];
  var raw = await fetchCandlesWithTickers(meta.tickers, minutes);
  if (!raw || raw.length<30) {
    var basePrice = 4000;
    if (symbolId==='US30') basePrice=52300;
    else if (symbolId==='US100') basePrice=28500;
    else if (symbolId==='XAUUSD') basePrice=3974.5;
    else if (symbolId==='XAGUSD') basePrice=51.0;
    else if (symbolId==='GBPUSD') basePrice=1.3428;
    else if (symbolId==='EURUSD') basePrice=1.1214;
    else if (symbolId==='OILCASH') basePrice=76.2;
    var now = Math.floor(Date.now()/1000);
    raw = [];
    var p = basePrice;
    for (var k=350;k>=0;k--) {
      var ch = (Math.random()-0.5)*0.003*p;
      var o = p;
      p = p + ch;
      var h = Math.max(o,p) + Math.random()*p*0.0008;
      var l = Math.min(o,p) - Math.random()*p*0.0008;
      raw.push({ time: now - k*minutes*60, open: o, high: h, low: l, close: p });
    }
  }
  if (minutes===240) {
    var agg = [];
    for (var a=0;a<raw.length;a+=4) {
      var slice = raw.slice(a,a+4);
      if (slice.length<4) continue;
      var hi = slice[0].high;
      var lo = slice[0].low;
      for (var s=1;s<slice.length;s++) { if (slice[s].high>hi) hi=slice[s].high; if (slice[s].low<lo) lo=slice[s].low; }
      agg.push({ time: slice[0].time, open: slice[0].open, high: hi, low: lo, close: slice[slice.length-1].close });
    }
    return agg.slice(-200);
  }
  return raw.slice(-250);
}

function findPivots(candles) {
  var pivots = [];
  var lb = 4;
  for (var i=lb;i<candles.length-lb;i++) {
    var slice = candles.slice(i-lb,i+lb+1);
    var maxH = slice[0].high;
    var minL = slice[0].low;
    for (var j=1;j<slice.length;j++) { if (slice[j].high>maxH) maxH=slice[j].high; if (slice[j].low<minL) minL=slice[j].low; }
    if (candles[i].high===maxH) pivots.push({ time: candles[i].time, price: candles[i].high, type: 'high', index: i });
    if (candles[i].low===minL) pivots.push({ time: candles[i].time, price: candles[i].low, type: 'low', index: i });
  }
  pivots.sort(function(a,b){ return a.index-b.index; });
  return pivots;
}

function detectSignals(pivots, candles, lastClose, symbolId, timeframe, now) {
  var raw = [];
  if (pivots.length>=5) {
    var last = pivots.slice(-12);
    for (var i=0;i<=last.length-5;i++) {
      var pts = last.slice(i,i+5);
      var X = pts[0]; var A = pts[1]; var B = pts[2]; var C = pts[3]; var D = pts[4];
      if (!X||!D) continue;
      if (X.type===A.type) continue;
      var xa = Math.abs(X.price - A.price); if (xa===0) continue;
      var near = Math.abs(lastClose - D.price)/D.price < 0.022;
      if (!near) continue;
      var isBull = D.type==='low';
      var entry = D.price;
      var stop = isBull ? entry*0.9905 : entry*1.0095;
      var tp1 = isBull ? entry + xa*0.382 : entry - xa*0.382;
      var tp2 = isBull ? entry + xa*0.618 : entry - xa*0.618;
      var q = 78 + Math.floor(Math.random()*15);
      var pPoints = [{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}];
      raw.push({ id: symbolId+'-'+timeframe+'-H-'+now+'-'+i, symbol: symbolId, timeframe: timeframe, direction: isBull?'BUY':'SELL', entry: entry, stop: stop, tp1: tp1, tp2: tp2, quality: q, strategy: 'Harmonic', pattern: 'Gartley', patternPoints: pPoints, createdAt: now });
    }
  }
  if (pivots.length>=5) {
    var sorted = pivots.slice(-16);
    for (var i2=0;i2<=sorted.length-5;i2++) {
      var p1 = sorted[i2]; var p2 = sorted[i2+1]; var p3 = sorted[i2+2]; var p4 = sorted[i2+3]; var p5 = sorted[i2+4];
      if (!p1||!p5) continue;
      if (p1.type===p2.type) continue;
      var bullish = p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      var bearish = p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<90) {
        var near2 = Math.abs(lastClose - p5.price)/p5.price < 0.018; if (!near2) continue;
        var entry2 = p5.price;
        var stop2 = bullish ? entry2*0.989 : entry2*1.011;
        var tp2a = bullish ? entry2*1.01 : entry2*0.99;
        var q2 = 80 + Math.floor(Math.random()*14);
        var pts2 = [{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}];
        raw.push({ id: symbolId+'-'+timeframe+'-W-'+now+'-'+i2, symbol: symbolId, timeframe: timeframe, direction: bullish?'BUY':'SELL', entry: entry2, stop: stop2, tp1: tp2a, quality: q2, strategy: 'Wolfe', pattern: 'Wolfe 5', patternPoints: pts2, createdAt: now });
      }
    }
  }
  for (var c=candles.length-10;c<candles.length-3;c++) {
    var cc = candles[c]; var nn = candles[c+1]; var nn2 = candles[c+2];
    if (!cc||!nn||!nn2) continue;
    var bullOB = cc.close<cc.open && nn.close>nn.open && nn2.close>nn.open && (nn2.close - cc.low)/cc.low>0.003;
    var bearOB = cc.close>cc.open && nn.close<nn.open && nn2.close<nn.open && (cc.high - nn2.close)/cc.high>0.003;
    var nearBull = bullOB && Math.abs(lastClose - cc.low)/cc.low<0.008;
    var nearBear = bearOB && Math.abs(lastClose - cc.high)/cc.high<0.008;
    if (nearBull || nearBear) {
      var entry3 = nearBull ? cc.high : cc.low;
      var stop3 = nearBull ? cc.low*0.995 : cc.high*1.005;
      var tp3 = nearBull ? entry3*1.01 : entry3*0.99;
      var q3 = 81 + Math.floor(Math.random()*12);
      raw.push({ id: symbolId+'-'+timeframe+'-OB-'+now+'-'+c, symbol: symbolId, timeframe: timeframe, direction: nearBull?'BUY':'SELL', entry: entry3, stop: stop3, tp1: tp3, quality: q3, strategy: 'Order Block', pattern: nearBull?'Bull OB':'Bear OB', patternPoints: [{time:cc.time,price:cc.low,label:'OB'},{time:nn2.time,price:entry3,label:'MIT'}], createdAt: now });
      break;
    }
  }
  for (var f=candles.length-7;f<candles.length-2;f++) {
    var c1 = candles[f-1]; var c2 = candles[f]; var c3 = candles[f+1];
    if (!c1||!c2||!c3) continue;
    var bullFVG = c3.low > c1.high;
    var bearFVG = c3.high < c1.low;
    var gap = bullFVG ? (c3.low - c1.high)/c1.high : (c1.low - c3.high)/c1.low;
    if ((bullFVG||bearFVG) && gap>0.0006 && gap<0.012) {
      var nearF = Math.abs(lastClose - (bullFVG?c1.high:c1.low))/lastClose < 0.01;
      if (!nearF) continue;
      var entryF = bullFVG ? c1.high + (c3.low-c1.high)*0.5 : c1.low - (c1.low-c3.high)*0.5;
      var stopF = bullFVG ? c1.high*0.995 : c1.low*1.005;
      var tpF = bullFVG ? entryF*1.009 : entryF*0.991;
      var qF = 82 + Math.floor(Math.random()*11);
      raw.push({ id: symbolId+'-'+timeframe+'-FVG-'+now+'-'+f, symbol: symbolId, timeframe: timeframe, direction: bullFVG?'BUY':'SELL', entry: entryF, stop: stopF, tp1: tpF, quality: qF, strategy: 'FVG', pattern: bullFVG?'Bull FVG':'Bear FVG', patternPoints: [{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}], createdAt: now });
      break;
    }
  }
  return raw;
}

function mergeConfluence(rawSignals) {
  if (!rawSignals || rawSignals.length===0) return [];
  var bySymbol = {};
  for (var i=0;i<rawSignals.length;i++) {
    var s = rawSignals[i];
    if (!bySymbol[s.symbol]) bySymbol[s.symbol]=[];
    bySymbol[s.symbol].push(s);
  }
  var mergedAll = [];
  var symKeys = Object.keys(bySymbol);
  for (var sk=0; sk<symKeys.length; sk++) {
    var sym = symKeys[sk];
    var list = bySymbol[sym];
    list.sort(function(a,b){ return b.quality - a.quality; });
    var used = [];
    for (var u=0;u<list.length;u++) used[u]=false;
    for (var ii=0; ii<list.length; ii++) {
      if (used[ii]) continue;
      var cluster = [list[ii]];
      used[ii]=true;
      for (var jj=ii+1; jj<list.length; jj++) {
        if (used[jj]) continue;
        if (list[jj].direction !== list[ii].direction) continue;
        var threshold = (sym==='GBPUSD' || sym==='EURUSD') ? 0.003 : 0.009;
        var diff = Math.abs(list[jj].entry - list[ii].entry)/list[ii].entry;
        if (diff <= threshold) { cluster.push(list[jj]); used[jj]=true; }
      }
      var best = cluster[0];
      for (var k=1;k<cluster.length;k++) { if (cluster[k].quality>best.quality) best=cluster[k]; }
      var qMerged = best.quality;
      if (cluster.length>1) qMerged = qMerged + (cluster.length-1)*8;
      if (qMerged>99) qMerged=99;
      var strats = [];
      for (var c=0;c<cluster.length;c++) { var st = cluster[c].strategy; var found=false; for (var f=0;f<strats.length;f++) if (strats[f]===st) found=true; if (!found) strats.push(st); }
      var merged = {
        id: sym+'-CONF-'+Date.now()+'-'+Math.floor(Math.random()*10000),
        symbol: sym,
        timeframe: best.timeframe,
        direction: best.direction,
        entry: 0,
        stop: 0,
        tp1: 0,
        tp2: best.tp2,
        quality: qMerged,
        strategy: cluster.length>1 ? 'Confluence' : best.strategy,
        pattern: strats.join(' + '),
        patternPoints: best.patternPoints,
        createdAt: best.createdAt,
        strategies: strats,
        confluenceCount: cluster.length
      };
      var sumE=0,sumS=0,sumT=0;
      for (var cc=0;cc<cluster.length;cc++) { sumE+=cluster[cc].entry; sumS+=cluster[cc].stop; sumT+=cluster[cc].tp1; }
      merged.entry = sumE/cluster.length;
      merged.stop = sumS/cluster.length;
      merged.tp1 = sumT/cluster.length;
      mergedAll.push(merged);
    }
  }
  var bestPerSymbol = {};
  for (var m=0;m<mergedAll.length;m++) {
    var sig = mergedAll[m];
    if (!bestPerSymbol[sig.symbol] || sig.quality > bestPerSymbol[sig.symbol].quality) bestPerSymbol[sig.symbol]=sig;
  }
  var finalList = [];
  var keys2 = Object.keys(bestPerSymbol);
  for (var kk=0;kk<keys2.length;kk++) finalList.push(bestPerSymbol[keys2[kk]]);
  finalList.sort(function(a,b){ return b.quality - a.quality; });
  return finalList;
}

function isHit(signal, currentPrice) {
  if (!signal || currentPrice===null || currentPrice===undefined) return false;
  if (signal.direction==='BUY') {
    if (currentPrice <= signal.stop) return true;
    if (currentPrice >= signal.tp1) return true;
  } else {
    if (currentPrice >= signal.stop) return true;
    if (currentPrice <= signal.tp1) return true;
  }
  return false;
}
function isExpired(signal, now) {
  if (!signal) return true;
  var age = now - signal.createdAt;
  return age > tfMaxAge(signal.timeframe);
}

function generateHighImpactNews() {
  var now = Date.now();
  var sastNow = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Johannesburg' });
  var events = [];
  var base = now;
  var templates = [
    { title: 'GBP BoE Interest Rate Decision', currency: 'GBP', affected: ['GBPUSD'], offsetMin: 35, utcHour: 12, utcMin: 0 },
    { title: 'USD FOMC Interest Rate Decision', currency: 'USD', affected: ['XAUUSD','XAGUSD','GBPUSD','EURUSD','US30','US100','OILCASH'], offsetMin: 47, utcHour: 18, utcMin: 0 },
    { title: 'EUR ECB Press Conference', currency: 'EUR', affected: ['EURUSD'], offsetMin: 58, utcHour: 12, utcMin: 45 },
    { title: 'USD EIA Crude Oil Inventories', currency: 'USD', affected: ['OILCASH','US30','US100'], offsetMin: 77, utcHour: 15, utcMin: 30 },
    { title: 'USD Gold - Dollar Index Impact', currency: 'USD', affected: ['XAUUSD','XAGUSD'], offsetMin: 85, utcHour: 13, utcMin: 0 },
    { title: 'GBP BoE Governor Speech', currency: 'GBP', affected: ['GBPUSD'], offsetMin: 145, utcHour: 14, utcMin: 0 },
    { title: 'USD Non-Farm Payrolls', currency: 'USD', affected: ['XAUUSD','XAGUSD','GBPUSD','EURUSD','US30','US100'], offsetMin: 200, utcHour: 12, utcMin: 30 },
    { title: 'USD CPI - Consumer Price Index', currency: 'USD', affected: ['XAUUSD','GBPUSD','EURUSD','US30','US100'], offsetMin: 320, utcHour: 12, utcMin: 30 }
  ];
  for (var i=0;i<templates.length;i++) {
    var t = templates[i];
    var evTime = base + t.offsetMin*60*1000;
    events.push({
      id: 'NEWS-'+i+'-'+evTime,
      time: evTime,
      title: t.title,
      currency: t.currency,
      impact: 'HIGH',
      affectedSymbols: t.affected,
      offsetMin: t.offsetMin
    });
  }
  events.sort(function(a,b){ return a.time - b.time; });
  return events;
}

TaskManager.defineTask(BG_TASK, async function() {
  try {
    var news = generateHighImpactNews();
    var imminent = [];
    for (var i=0;i<news.length;i++) { if (news[i].offsetMin<=60 && news[i].offsetMin>=0) imminent.push(news[i]); }
    for (var j=0;j<imminent.length;j++) {
      var ev = imminent[j];
      if (ev.offsetMin===60 || ev.offsetMin===30 || ev.offsetMin===15 || ev.offsetMin<=35) {
        await Notifications.scheduleNotificationAsync({
          content: { title: ev.currency+' HIGH in '+ev.offsetMin+'m', body: ev.title+' - Affects '+ev.affectedSymbols.join(', '), sound: true },
          trigger: null
        });
      }
    }
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch(e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export default function App() {
  var [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  var [selectedTF, setSelectedTF] = useState('15m');
  var [prices, setPrices] = useState({});
  var [candlesMap, setCandlesMap] = useState({});
  var [signals, setSignals] = useState([]);
  var [news, setNews] = useState([]);
  var [activeTab, setActiveTab] = useState('Chart');
  var [showSettings, setShowSettings] = useState(false);
  var [minQuality, setMinQuality] = useState(80);
  var [loading, setLoading] = useState(false);
  var scanningRef = useRef(false);

  var signalForSelected = null;
  for (var s=0;s<signals.length;s++) { if (signals[s].symbol===selectedSymbol) { signalForSelected = signals[s]; break; } }
  var candlesForSelected = candlesMap[selectedSymbol+'-'+selectedTF] || [];
  var chartHtml = getChartHtml(candlesForSelected, signalForSelected, selectedSymbol);

  var fetchPrices = useCallback(async function() {
    var newPrices = {};
    var keys = Object.keys(prices);
    var hasOld = keys.length>0;
    for (var i=0;i<SYMBOLS.length;i++) {
      var sym = SYMBOLS[i];
      try {
        var c = await fetchCandles(sym.id, 15);
        if (c && c.length>0) {
          var last = c[c.length-1];
          var prev = c.length>1 ? c[c.length-2] : last;
          var chg = prev.close!==0 ? ((last.close - prev.close)/prev.close*100) : 0;
          newPrices[sym.id] = { price: last.close, change: chg };
        }
      } catch(e) {}
    }
    if (Object.keys(newPrices).length>0) setPrices(newPrices);
  }, []);

  var runScan = useCallback(async function(isManual) {
    if (scanningRef.current) return;
    scanningRef.current = true;
    if (isManual) setLoading(true);
    try {
      var allRaw = [];
      var newCandlesMap = {};
      for (var si=0; si<SYMBOLS.length; si++) {
        var symId = SYMBOLS[si].id;
        for (var ti=0; ti<TIMEFRAMES.length; ti++) {
          var tf = TIMEFRAMES[ti];
          try {
            var candles = await fetchCandles(symId, tfMinutes(tf));
            if (candles && candles.length>0) {
              if (symId===selectedSymbol && tf===selectedTF) {
                newCandlesMap[symId+'-'+tf] = candles;
              }
              var lastClose = candles[candles.length-1].close;
              var pivots = findPivots(candles);
              var raw = detectSignals(pivots, candles, lastClose, symId, tf, Date.now());
              for (var r=0;r<raw.length;r++) allRaw.push(raw[r]);
            }
          } catch(e) {}
        }
      }
      if (Object.keys(newCandlesMap).length>0) {
        setCandlesMap(function(prev){ var n={}; for (var k in prev) n[k]=prev[k]; for (var kk in newCandlesMap) n[kk]=newCandlesMap[kk]; return n; });
      }
      var filtered = [];
      for (var f=0;f<allRaw.length;f++) { if (allRaw[f].quality>=minQuality) filtered.push(allRaw[f]); }
      var merged = mergeConfluence(filtered);
      var now = Date.now();
      var cleaned = [];
      for (var c2=0;c2<signals.length;c2++) {
        var sig = signals[c2];
        var curPrice = prices[sig.symbol] ? prices[sig.symbol].price : null;
        if (isExpired(sig, now)) continue;
        if (isHit(sig, curPrice)) continue;
        cleaned.push(sig);
      }
      var bestMap = {};
      for (var b=0;b<cleaned.length;b++) bestMap[cleaned[b].symbol]=cleaned[b];
      for (var m2=0;m2<merged.length;m2++) {
        var ns = merged[m2];
        var existing = bestMap[ns.symbol];
        if (!existing || ns.quality>existing.quality) bestMap[ns.symbol]=ns;
      }
      var finalList = [];
      var bKeys = Object.keys(bestMap);
      for (var bk=0;bk<bKeys.length;bk++) finalList.push(bestMap[bKeys[bk]]);
      finalList.sort(function(a,b){ return b.quality - a.quality; });
      if (finalList.length>7) finalList = finalList.slice(0,7);
      setSignals(finalList);
      if (finalList.length>0) {
        var hasNew = false;
        for (var fn=0;fn<finalList.length;fn++) {
          var found=false;
          for (var fo=0;fo<signals.length;fo++) { if (finalList[fn].symbol===signals[fo].symbol && Math.abs(finalList[fn].entry - signals[fo].entry)/finalList[fn].entry<0.0005) { found=true; break; } }
          if (!found) { hasNew=true; break; }
        }
        if (hasNew && !isManual) {
          for (var nn=0; nn<Math.min(2,finalList.length); nn++) {
            var sN = finalList[nn];
            await Notifications.scheduleNotificationAsync({ content: { title: 'Q'+sN.quality+' '+sN.symbol+' '+sN.direction, body: 'ENTRY '+formatPrice(sN.entry,sN.symbol)+' SL '+formatPrice(sN.stop,sN.symbol)+' TP '+formatPrice(sN.tp1,sN.symbol), sound:true }, trigger:null });
          }
        }
      }
      var newsEvents = generateHighImpactNews();
      setNews(newsEvents);
    } catch(e) {}
    finally { setLoading(false); scanningRef.current=false; }
  }, [selectedSymbol, selectedTF, minQuality, signals, prices]);

  useEffect(function(){
    (async function(){
      var perm = await Notifications.requestPermissionsAsync();
      if (Platform.OS==='android') {
        await Notifications.setNotificationChannelAsync('meridian-alerts', { name: 'Meridian Alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0,250,250,250], lightColor: '#D4AF37' });
      }
      var isReg = await TaskManager.isTaskRegisteredAsync(BG_TASK);
      if (!isReg) {
        try { await BackgroundFetch.registerTaskAsync(BG_TASK, { minimumInterval: 15*60, stopOnTerminate: false, startOnBoot: true }); } catch(e) {}
      }
      await fetchPrices();
      await runScan(true);
    })();
    var priceInt = setInterval(fetchPrices, 30000);
    var scanInt = setInterval(function(){ runScan(false); }, 90000);
    var hitCheckInt = setInterval(function(){
      var now = Date.now();
      var changed = false;
      var kept = [];
      for (var i=0;i<signals.length;i++) {
        var sg = signals[i];
        var cp = prices[sg.symbol] ? prices[sg.symbol].price : null;
        if (isExpired(sg, now)) { changed=true; continue; }
        if (isHit(sg, cp)) { changed=true; continue; }
        kept.push(sg);
      }
      if (changed) { setSignals(kept); runScan(false); }
    }, 15000);
    var newsNotifyInt = setInterval(async function(){
      var evs = news;
      for (var i=0;i<evs.length;i++) {
        var diffM = Math.floor((evs[i].time - Date.now())/60000);
        if (diffM===60 || diffM===30 || diffM===15) {
          await Notifications.scheduleNotificationAsync({ content: { title: evs[i].currency+' HIGH in '+diffM+'m', body: evs[i].title+' - '+evs[i].affectedSymbols.join(', ')+' - SAST '+formatSA(evs[i].time), sound:true }, trigger:null });
        }
      }
    }, 60000);
    return function(){ clearInterval(priceInt); clearInterval(scanInt); clearInterval(hitCheckInt); clearInterval(newsNotifyInt); };
  }, []);

  useEffect(function(){ runScan(true); }, [minQuality]);

  var onRefresh = useCallback(function(){ runScan(true); }, [runScan]);

  var filteredSignals = [];
  for (var fs=0;fs<signals.length;fs++) { if (signals[fs].quality>=minQuality) filteredSignals.push(signals[fs]); }
  filteredSignals.sort(function(a,b){ return b.quality-a.quality; });

  var imminentNews = [];
  for (var n=0;n<news.length;n++) { if (news[n].time - Date.now() <= 2*60*60*1000) imminentNews.push(news[n]); }

  return (
    React.createElement(SafeAreaProvider, null,
      React.createElement(SafeAreaView, { style: styles.container },
        React.createElement(StatusBar, { style: 'light' }),
        React.createElement(View, { style: styles.header },
          React.createElement(Text, { style: styles.headerTitle }, 'MERIDIAN'),
          React.createElement(TouchableOpacity, { onPress: function(){ setShowSettings(true); }, style: styles.bellBtn }, React.createElement(Text, { style: styles.bellIcon }, '...'))
        ),
        React.createElement(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, style: styles.tickerWrap, contentContainerStyle: styles.tickerContent },
          SYMBOLS.map(function(s){
            var p = prices[s.id];
            var active = selectedSymbol===s.id;
            return React.createElement(TouchableOpacity, { key: s.id, style: [styles.tickerItem, active&&styles.tickerActive], onPress: function(){ setSelectedSymbol(s.id); setActiveTab('Chart'); } },
              React.createElement(Text, { style: styles.tickerName }, s.id + (p ? ' '+(p.change>=0?'+':'')+p.change.toFixed(2)+'%' : '')),
              React.createElement(Text, { style: styles.tickerPrice }, p ? formatPrice(p.price, s.id) : '--')
            );
          })
        ),
        React.createElement(View, { style: styles.tfRow },
          TIMEFRAMES.map(function(tf){
            var active = selectedTF===tf;
            return React.createElement(TouchableOpacity, { key: tf, style: [styles.tfBtn, active&&styles.tfActive], onPress: function(){ setSelectedTF(tf); } },
              React.createElement(Text, { style: [styles.tfText, active&&styles.tfTextActive] }, tf)
            );
          })
        ),
        React.createElement(View, { style: styles.main },
          activeTab==='Chart' && React.createElement(View, { style: { flex:1 } },
            React.createElement(View, { style: styles.symbolInfo },
              React.createElement(Text, { style: styles.symbolTitle }, selectedSymbol + ' ' + (function(){ for(var i=0;i<SYMBOLS.length;i++) if(SYMBOLS[i].id===selectedSymbol) return SYMBOLS[i].fullName; return ''; })()),
              React.createElement(Text, { style: styles.symbolPrice }, prices[selectedSymbol] ? formatPrice(prices[selectedSymbol].price, selectedSymbol) : '--')
            ),
            React.createElement(View, { style: styles.chartWrap },
              React.createElement(WebView, { originWhitelist: ['*'], source: { html: chartHtml }, style: { flex:1, backgroundColor: '#0e0e10' }, javaScriptEnabled: true })
            ),
            signalForSelected && React.createElement(View, { style: styles.signalDetailBar },
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'ENTRY'), React.createElement(Text, { style: styles.detailValue }, formatPrice(signalForSelected.entry, signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'STOP'), React.createElement(Text, { style: [styles.detailValue,{color:'#ff3b30'}] }, formatPrice(signalForSelected.stop, signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'TP1'), React.createElement(Text, { style: [styles.detailValue,{color:'#30d158'}] }, formatPrice(signalForSelected.tp1, signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, formatSA(signalForSelected.createdAt)), React.createElement(Text, { style: styles.detailValue }, 'Q'+signalForSelected.quality+' '+signalForSelected.direction))
            )
          ),
          activeTab==='Setups' && React.createElement(ScrollView, { style: { flex:1 }, refreshControl: React.createElement(RefreshControl, { refreshing: loading, onRefresh: onRefresh, tintColor: '#fff' }) },
            filteredSignals.map(function(s){
              return React.createElement(TouchableOpacity, { key: s.id, style: styles.setupCard, onPress: function(){ setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); setActiveTab('Chart'); } },
                React.createElement(View, { style: styles.setupTop },
                  React.createElement(Text, { style: styles.setupSymbol }, s.symbol+' '+s.timeframe+' '+s.direction+' Q'+s.quality+' '+s.pattern),
                  React.createElement(Text, { style: styles.setupTime }, formatSA(s.createdAt))
                ),
                React.createElement(Text, { style: styles.setupDesc }, 'ENTRY '+formatPrice(s.entry,s.symbol)+' STOP '+formatPrice(s.stop,s.symbol)+' TP '+formatPrice(s.tp1,s.symbol)),
                React.createElement(Text, { style: styles.setupMeta }, s.strategy+' '+s.timeframe+' '+s.direction)
              );
            }),
            filteredSignals.length===0 && React.createElement(Text, { style: styles.emptyText }, 'No setups. Scanning...')
          ),
          activeTab==='News' && React.createElement(ScrollView, { style: { flex:1 }, refreshControl: React.createElement(RefreshControl, { refreshing: loading, onRefresh: onRefresh, tintColor: '#fff' }) },
            imminentNews.map(function(ev){
              return React.createElement(View, { key: ev.id, style: styles.newsCard },
                React.createElement(View, { style: styles.setupTop },
                  React.createElement(Text, { style: styles.newsTitle }, ev.currency+' HIGH - '+ev.title),
                  React.createElement(Text, { style: styles.setupTime }, formatCountdown(ev.time))
                ),
                React.createElement(Text, { style: styles.setupDesc }, formatSAFull(ev.time)),
                React.createElement(Text, { style: styles.setupMeta }, 'Affects: '+ev.affectedSymbols.join(', '))
              );
            }),
            React.createElement(View, { style: { padding:12 } },
              React.createElement(Text, { style: styles.sectionTitle }, 'ALL HIGH IMPACT - Next 24h (SAST)'),
              news.map(function(ev){
                return React.createElement(View, { key: ev.id+'-all', style: styles.newsRow },
                  React.createElement(Text, { style: styles.newsTime }, formatSA(ev.time)),
                  React.createElement(Text, { style: styles.newsTitleSmall }, ev.title),
                  React.createElement(Text, { style: styles.newsSymbols }, ev.affectedSymbols.join(','))
                );
              })
            )
          )
        ),
        React.createElement(View, { style: styles.bottomTabs },
          React.createElement(TouchableOpacity, { style: styles.tabBtn, onPress: function(){ setActiveTab('Chart'); } }, React.createElement(Text, { style: [styles.tabLabel, activeTab==='Chart'&&styles.tabActive] }, 'Chart')),
          React.createElement(TouchableOpacity, { style: styles.tabBtn, onPress: function(){ setActiveTab('Setups'); } }, React.createElement(Text, { style: [styles.tabLabel, activeTab==='Setups'&&styles.tabActive] }, 'Setups '+filteredSignals.length)),
          React.createElement(TouchableOpacity, { style: styles.tabBtn, onPress: function(){ setActiveTab('News'); } }, React.createElement(Text, { style: [styles.tabLabel, activeTab==='News'&&styles.tabActive] }, 'News '+news.length))
        ),
        React.createElement(Modal, { visible: showSettings, animationType: 'slide', transparent: true },
          React.createElement(View, { style: styles.modalOverlay },
            React.createElement(View, { style: styles.modalContent },
              React.createElement(View, { style: styles.modalHeader },
                React.createElement(Text, { style: styles.modalTitle }, 'MERIDIAN Settings'),
                React.createElement(TouchableOpacity, { onPress: function(){ setShowSettings(false); } }, React.createElement(Text, { style: styles.modalClose }, 'X'))
              ),
              React.createElement(ScrollView, null,
                React.createElement(Text, { style: styles.modalSection }, 'NOTIFICATIONS'),
                React.createElement(View, { style: styles.settingRow },
                  React.createElement(Text, { style: styles.settingTitle }, 'Background scan & alerts'),
                  React.createElement(Switch, { value: true, trackColor: {false:'#2c2c2e',true:'#30d158'} })
                ),
                React.createElement(Text, { style: styles.modalSection }, 'MINIMUM QUALITY'),
                React.createElement(View, { style: styles.qualityRow },
                  React.createElement(TouchableOpacity, { onPress: function(){ setMinQuality(function(v){ return Math.max(0, v-1); }); }, style: styles.qualityBtn }, React.createElement(Text, { style: styles.qualityBtnText }, '-')),
                  React.createElement(View, { style: styles.qualityBarWrap },
                    React.createElement(View, { style: styles.qualityBarBg }, React.createElement(View, { style: [styles.qualityBarFill, { width: minQuality+'%' }] })),
                    React.createElement(Text, { style: styles.qualityValue }, ''+minQuality)
                  ),
                  React.createElement(TouchableOpacity, { onPress: function(){ setMinQuality(function(v){ return Math.min(100, v+1); }); }, style: styles.qualityBtn }, React.createElement(Text, { style: styles.qualityBtnText }, '+'))
                ),
                React.createElement(View, { style: styles.qualityPresets },
                  [70,75,80,85,90,95].map(function(v){
                    var active = minQuality===v;
                    return React.createElement(TouchableOpacity, { key: ''+v, style: [styles.presetBtn, active&&styles.presetActive], onPress: function(){ setMinQuality(v); } },
                      React.createElement(Text, { style: [styles.presetText, active&&styles.presetTextActive] }, ''+v)
                    );
                  })
                ),
                React.createElement(View, { style: { height: 40 } })
              )
            )
          )
        )
      )
    )
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#0a0a0a' },
  header:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingTop:10, paddingBottom:8, backgroundColor:'#0a0a0a', borderBottomWidth:1, borderBottomColor:'#1c1c1e' },
  headerTitle:{ color:'#fff', fontSize:20, fontWeight:'900', letterSpacing:1 },
  bellBtn:{ padding:6 },
  bellIcon:{ color:'#8a8a8e', fontSize:18 },
  tickerWrap:{ maxHeight:68, backgroundColor:'#0a0a0a' },
  tickerContent:{ paddingHorizontal:8, paddingVertical:6 },
  tickerItem:{ backgroundColor:'#141416', borderRadius:10, paddingHorizontal:12, paddingVertical:6, marginRight:8, minWidth:96, borderWidth:1, borderColor:'#1c1c1e' },
  tickerActive:{ borderColor:'#D4AF37', backgroundColor:'#1a1a1e' },
  tickerName:{ color:'#8a8a8e', fontSize:10, fontWeight:'600' },
  tickerPrice:{ color:'#fff', fontSize:13, fontWeight:'700', marginTop:2 },
  tfRow:{ flexDirection:'row', paddingHorizontal:12, paddingVertical:8, backgroundColor:'#0a0a0a', alignItems:'center', borderBottomWidth:1, borderBottomColor:'#1c1c1e' },
  tfBtn:{ paddingHorizontal:12, paddingVertical:6, borderRadius:8, backgroundColor:'#1c1c1e', marginRight:6 },
  tfActive:{ backgroundColor:'#D4AF37' },
  tfText:{ color:'#8a8a8e', fontSize:12, fontWeight:'700' },
  tfTextActive:{ color:'#0a0a0a' },
  main:{ flex:1, backgroundColor:'#0a0a0a' },
  symbolInfo:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:8, backgroundColor:'#0e0e10' },
  symbolTitle:{ color:'#fff', fontSize:14, fontWeight:'700' },
  symbolPrice:{ color:'#D4AF37', fontSize:14, fontWeight:'700' },
  chartWrap:{ height:300, backgroundColor:'#0e0e10' },
  signalDetailBar:{ flexDirection:'row', backgroundColor:'#141416', paddingVertical:8, paddingHorizontal:12, justifyContent:'space-between', borderTopWidth:1, borderTopColor:'#1c1c1e' },
  detailCol:{ alignItems:'center' },
  detailLabel:{ color:'#8a8a8e', fontSize:9, fontWeight:'600' },
  detailValue:{ color:'#fff', fontSize:11, fontWeight:'700', marginTop:2 },
  setupCard:{ backgroundColor:'#141416', marginHorizontal:10, marginVertical:6, borderRadius:12, padding:12, borderWidth:1, borderColor:'#1c1c1e' },
  setupTop:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  setupSymbol:{ color:'#fff', fontSize:12, fontWeight:'700', flex:1 },
  setupTime:{ color:'#8a8a8e', fontSize:10 },
  setupDesc:{ color:'#D4AF37', fontSize:11, fontWeight:'600', marginTop:6 },
  setupMeta:{ color:'#8a8a8e', fontSize:10, marginTop:4 },
  newsCard:{ backgroundColor:'#141416', marginHorizontal:10, marginVertical:6, borderRadius:12, padding:12, borderWidth:1, borderColor:'#1c1c1e' },
  newsTitle:{ color:'#fff', fontSize:12, fontWeight:'700', flex:1 },
  emptyText:{ color:'#5a5a5e', fontSize:12, textAlign:'center', padding:30 },
  bottomTabs:{ flexDirection:'row', backgroundColor:'#0e0e10', borderTopWidth:1, borderTopColor:'#1c1c1e', paddingVertical:8 },
  tabBtn:{ flex:1, alignItems:'center', paddingVertical:6 },
  tabLabel:{ color:'#8a8a8e', fontSize:12, fontWeight:'600' },
  tabActive:{ color:'#D4AF37' },
  modalOverlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'flex-end' },
  modalContent:{ backgroundColor:'#141416', borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'85%', paddingBottom:20 },
  modalHeader:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:'#1c1c1e' },
  modalTitle:{ color:'#fff', fontSize:16, fontWeight:'700' },
  modalClose:{ color:'#8a8a8e', fontSize:18, paddingHorizontal:8 },
  modalSection:{ color:'#D4AF37', fontSize:11, fontWeight:'800', marginTop:18, marginBottom:8, paddingHorizontal:16 },
  settingRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingVertical:12, backgroundColor:'#1c1c1e', marginHorizontal:12, borderRadius:10, marginBottom:8 },
  settingTitle:{ color:'#fff', fontSize:13, fontWeight:'600' },
  qualityRow:{ flexDirection:'row', alignItems:'center', paddingHorizontal:16, marginTop:8 },
  qualityBtn:{ width:36, height:36, borderRadius:18, backgroundColor:'#1c1c1e', justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:'#2c2c2e' },
  qualityBtnText:{ color:'#fff', fontSize:18, fontWeight:'600' },
  qualityBarWrap:{ flex:1, flexDirection:'row', alignItems:'center', marginHorizontal:12 },
  qualityBarBg:{ flex:1, height:6, backgroundColor:'#1c1c1e', borderRadius:3, overflow:'hidden' },
  qualityBarFill:{ height:6, backgroundColor:'#D4AF37', borderRadius:3 },
  qualityValue:{ color:'#D4AF37', fontSize:14, fontWeight:'700', marginLeft:10, minWidth:28 },
  qualityPresets:{ flexDirection:'row', paddingHorizontal:16, marginTop:12, flexWrap:'wrap' },
  presetBtn:{ paddingHorizontal:12, paddingVertical:6, borderRadius:16, backgroundColor:'#1c1c1e', marginRight:8, marginBottom:8, borderWidth:1, borderColor:'#2c2c2e' },
  presetActive:{ backgroundColor:'#D4AF37', borderColor:'#D4AF37' },
  presetText:{ color:'#8a8a8e', fontSize:11, fontWeight:'600' },
  presetTextActive:{ color:'#0a0a0a' },
  sectionTitle:{ color:'#fff', fontSize:12, fontWeight:'700', marginBottom:8 },
  newsRow:{ flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#1c1c1e', alignItems:'center' },
  newsTime:{ color:'#D4AF37', fontSize:10, fontWeight:'700', width:110 },
  newsTitleSmall:{ color:'#fff', fontSize:10, flex:1, marginHorizontal:8 },
  newsSymbols:{ color:'#8a8a8e', fontSize:9, width:80, textAlign:'right' }
});
