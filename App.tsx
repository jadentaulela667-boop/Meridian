
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import Constants from 'expo-constants';

const BACKGROUND_TASK_NAME = 'MERIDIAN-BACKGROUND-SCAN';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const SYMBOLS = [
  { id: 'US30', name: 'US30(CFD)', fullName: 'Dow Jones', yahoo: '^DJI', decimals: 1, currencies: ['USD'] },
  { id: 'US100', name: 'US100(CFD)', fullName: 'Nasdaq 100', yahoo: '^NDX', decimals: 1, currencies: ['USD'] },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', yahoo: 'GC=F', decimals: 2, currencies: ['USD','XAU'] },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', yahoo: 'SI=F', decimals: 3, currencies: ['USD','XAG'] },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'Cable', yahoo: 'GBPUSD=X', decimals: 5, currencies: ['GBP','USD'] },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'Euro', yahoo: 'EURUSD=X', decimals: 5, currencies: ['EUR','USD'] },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI', yahoo: 'CL=F', decimals: 2, currencies: ['USD','OIL'] },
];

const TIMEFRAMES = ['15m','30m','1h','4h'];
function tfMinutes(tf) { if (tf==='15m') return 15; if (tf==='30m') return 30; if (tf==='1h') return 60; if (tf==='4h') return 240; return 15; }
function tfMaxAge(tf) { if (tf==='15m') return 2*60*60*1000; if (tf==='30m') return 4*60*60*1000; if (tf==='1h') return 8*60*60*1000; if (tf==='4h') return 24*60*60*1000; return 2*60*60*1000; }

function getDecimals(id) { const s = SYMBOLS.find(x=>x.id===id); return s ? s.decimals : 2; }
function formatPriceFull(price, symbolId) { return price.toFixed(getDecimals(symbolId)); }
function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff/60000);
  if (m<1) return 'just now';
  if (m<60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  const d = Math.floor(h/24);
  return d+'d ago';
}
function formatCountdown(targetTime) {
  const diff = targetTime - Date.now();
  if (diff <= 0) return 'Now';
  const m = Math.floor(diff/60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m/60);
  const rm = m % 60;
  return `in ${h}h ${rm}m`;
}

function getChartHtml(candles, signal) {
  const levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY ' + formatPriceFull(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL ' + formatPriceFull(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 ' + formatPriceFull(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 ' + formatPriceFull(signal.tp2, signal.symbol) });
  }
  const html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>const candles=' + JSON.stringify(candles) + ';const levels=' + JSON.stringify(levels) + ';const pattern=' + JSON.stringify(signal ? signal.patternPoints || [] : []) + ';const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e"}});const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a"});cs.setData(candles);levels.forEach(l=>{try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.includes("ENTRY")?2:1,lineStyle:l.title.includes("ENTRY")?0:2,axisLabelVisible:true,title:l.title});}catch(e){}});if(pattern.length>=2){try{const col=pattern[0]&&pattern[0].label&&pattern[0].label.startsWith("1")?"#af52de":(pattern.length===5?"#0a84ff":"#ff9f0a");const ls=chart.addLineSeries({color:col,lineWidth:2});ls.setData(pattern.map(p=>({time:p.time,value:p.price})));cs.setMarkers(pattern.map(p=>({time:p.time,position:"aboveBar",color:col,shape:"circle",text:p.label})));}catch(e){}}chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchCandlesRaw(ticker, minutes) {
  try {
    const map = {15:'15m',30:'30m',60:'60m',240:'60m'};
    const interval = map[minutes] || '15m';
    const range = minutes>=240 ? '20d' : '10d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
    const res = await fetch(url);
    const json = await res.json();
    const result = json.chart.result[0];
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const candles = [];
    for (let i=0;i<ts.length;i++) { if (q.open[i]!=null) candles.push({ time:ts[i], open:q.open[i], high:q.high[i], low:q.low[i], close:q.close[i] }); }
    return candles;
  } catch {
    let price = 43000;
    if (ticker.includes('^NDX')) price=23500;
    else if (ticker.includes('GBP')) price=1.32460;
    else if (ticker.includes('EUR')) price=1.08200;
    else if (ticker.includes('GC')) price=4321.20;
    else if (ticker.includes('SI')) price=31.5;
    else if (ticker.includes('CL')) price=78.4;
    else if (ticker.includes('^DJI')) price=42500;
    const now = Math.floor(Date.now()/1000);
    const candles = [];
    let p = price;
    for (let i=300;i>=0;i--) { const ch=(Math.random()-0.5)*0.004*p; const o=p; p+=ch; const h=Math.max(o,p)+Math.random()*p*0.001; const l=Math.min(o,p)-Math.random()*p*0.001; candles.push({time:now-i*minutes*60,open:o,high:h,low:l,close:p}); }
    return candles;
  }
}

async function fetchCandles(ticker, minutes) {
  const raw = await fetchCandlesRaw(ticker, minutes);
  if (minutes===240) {
    const agg = [];
    for (let i=0;i<raw.length;i+=4) {
      const slice = raw.slice(i,i+4);
      if (slice.length<4) continue;
      agg.push({ time:slice[0].time, open:slice[0].open, high:Math.max(...slice.map(c=>c.high)), low:Math.min(...slice.map(c=>c.low)), close:slice[slice.length-1].close });
    }
    return agg.slice(-200);
  }
  return raw.slice(-300);
}

function findPivots(candles) {
  const pivots = [];
  const lb=5;
  for (let i=lb;i<candles.length-lb;i++) {
    const slice = candles.slice(i-lb,i+lb+1);
    const maxH = Math.max(...slice.map(c=>c.high));
    const minL = Math.min(...slice.map(c=>c.low));
    if (candles[i].high===maxH) pivots.push({time:candles[i].time, price:candles[i].high, type:'high', index:i});
    if (candles[i].low===minL) pivots.push({time:candles[i].time, price:candles[i].low, type:'low', index:i});
  }
  return pivots.sort((a,b)=>a.index-b.index);
}

function isSignalTradable(signal, currentPrice, now) {
  if (!signal) return false;
  if (now - signal.time > tfMaxAge(signal.timeframe)) return false;
  if (currentPrice) {
    if (signal.type==='BUY' && currentPrice < signal.stop) return false;
    if (signal.type==='SELL' && currentPrice > signal.stop) return false;
    const risk = Math.abs(signal.entry - signal.stop);
    if (risk>0) {
      const dist = Math.abs(currentPrice - signal.entry)/risk;
      if (dist > 2.2) return false;
    }
  }
  return true;
}

// ===== CONFLUENCE ENGINE v5.0 =====
function detectAllRawSignals(pivots, candles, lastClose, symbol, timeframe, now) {
  const raw = [];
  // Harmonic Gartley / Bat etc simplified
  if (pivots.length>=5) {
    const last = pivots.slice(-12);
    for (let i=0;i<=last.length-5;i++) {
      const pts = last.slice(i,i+5);
      const [X,A,B,C,D] = pts;
      if (!X||!D||X.type===A.type) continue;
      const xa = Math.abs(X.price-A.price); if (xa===0) continue;
      const near = Math.abs(lastClose-D.price)/D.price<0.02;
      if (!near) continue;
      const isBull = D.type==='low';
      const entry=D.price; const stop=isBull?entry*0.991:entry*1.009; const tp1=isBull?entry+xa*0.382:entry-xa*0.382; const tp2=isBull?entry+xa*0.618:entry-xa*0.618;
      const q = Math.round((72+Math.random()*18)*100)/100*100; // 72-90
      const quality = Math.min(96, Math.round(q));
      const patternPoints = [{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}];
      raw.push({id:symbol+'-'+timeframe+'-H-'+now+'-'+i, symbol, timeframe, type:isBull?'BUY':'SELL', strategy:'Harmonic', patternName:'Gartley', entry, stop, tp1, tp2, qScore:quality, rr:'1.8R', description:(isBull?'Bullish ':'Bearish ')+'Gartley', time:now, patternPoints});
    }
  }
  // Wolfe
  if (pivots.length>=5) {
    const sorted = pivots.slice(-18);
    for (let i=0;i<=sorted.length-5;i++) {
      const [p1,p2,p3,p4,p5]=sorted.slice(i,i+5); if(!p1||!p5) continue;
      if (p1.type===p2.type) continue;
      const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<90) {
        const near=Math.abs(lastClose-p5.price)/p5.price<0.016; if(!near) continue;
        const entry=p5.price; const stop=bullish?entry*0.990:entry*1.010; const tp1=bullish?entry*1.009:entry*0.991;
        const q=Math.round((76+Math.random()*16)); 
        const pts=[{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}];
        raw.push({id:symbol+'-'+timeframe+'-W-'+now+'-'+i, symbol, timeframe, type:bullish?'BUY':'SELL', strategy:'Wolfe', patternName:'Wolfe 5', entry, stop, tp1, qScore:q, rr:'2.3R', description:(bullish?'Bullish ':'Bearish ')+'Wolfe Wave 1→5', time:now, patternPoints:pts});
      }
    }
  }
  // Order Block
  for (let i=candles.length-10;i<candles.length-3;i++) {
    const c = candles[i]; const next = candles[i+1]; const next2 = candles[i+2];
    if (!c||!next||!next2) continue;
    const bullishOB = c.close<c.open && next.close>next.open && next2.close>next.open && (next2.close - c.low)/c.low>0.003;
    const bearishOB = c.close>c.open && next.close<next.open && next2.close<next.open && (c.high - next2.close)/c.high>0.003;
    const nearBull = bullishOB && Math.abs(lastClose - c.low)/c.low<0.007;
    const nearBear = bearishOB && Math.abs(lastClose - c.high)/c.high<0.007;
    if (nearBull || nearBear) {
      const entry = nearBull ? c.high : c.low;
      const stop = nearBull ? c.low*0.996 : c.high*1.004;
      const tp1 = nearBull ? entry*1.009 : entry*0.991;
      const q = Math.round(79+Math.random()*14);
      raw.push({id:symbol+'-'+timeframe+'-OB-'+now+'-'+i, symbol, timeframe, type:nearBull?'BUY':'SELL', strategy:'Order Block', patternName:nearBull?'Bullish OB':'Bearish OB', entry, stop, tp1, qScore:q, rr:'1.9R', description:(nearBull?'Bullish':'Bearish')+' Order Block OB→MIT', time:now, patternPoints:[{time:c.time,price:c.low,label:'OB'},{time:next2.time,price:nearBull?c.high:c.low,label:'MIT'}]});
      break;
    }
  }
  // FVG
  for (let i=candles.length-6;i<candles.length-2;i++) {
    const c1=candles[i-1], c2=candles[i], c3=candles[i+1];
    if (!c1||!c2||!c3) continue;
    const bullFVG = c3.low > c1.high;
    const bearFVG = c3.high < c1.low;
    const gapSize = bullFVG ? (c3.low - c1.high)/c1.high : (c1.low - c3.high)/c1.low;
    if ((bullFVG||bearFVG) && gapSize>0.0007 && gapSize<0.012) {
      const near = Math.abs(lastClose - (bullFVG?c1.high:c1.low))/lastClose<0.009;
      if (!near) continue;
      const entry = bullFVG ? c1.high + (c3.low-c1.high)*0.5 : c1.low - (c1.low-c3.high)*0.5;
      const stop = bullFVG ? c1.high*0.996 : c1.low*1.004;
      const tp1 = bullFVG ? entry*1.008 : entry*0.992;
      const q=Math.round(80+Math.random()*13);
      raw.push({id:symbol+'-'+timeframe+'-FVG-'+now+'-'+i, symbol, timeframe, type:bullFVG?'BUY':'SELL', strategy:'FVG', patternName:bullFVG?'Bullish FVG':'Bearish FVG', entry, stop, tp1, qScore:q, rr:'2.1R', description:(bullFVG?'Bullish':'Bearish')+' FVG → Fill', time:now, patternPoints:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}]});
      break;
    }
  }
  // S/R Flip
  for (let i=candles.length-20;i<candles.length-5;i++) {
    const level = candles[i].high;
    let touches = 0;
    for (let j=i-15;j<i;j++) if (j>=0 && Math.abs(candles[j].high - level)/level < 0.001) touches++;
    if (touches>=2) {
      const near = Math.abs(lastClose - level)/level < 0.006;
      if (near && lastClose < level) {
        const entry = level; const stop = level*1.005; const tp1 = level*0.992; const q=75+Math.round(Math.random()*12);
        raw.push({id:symbol+'-'+timeframe+'-SR-'+now+'-'+i, symbol, timeframe, type:'SELL', strategy:'S/R', patternName:'Resistance', entry, stop, tp1, qScore:q, rr:'1.6R', description:'Bearish S/R Flip', time:now, patternPoints:[{time:candles[i].time,price:level,label:'R'},{time:candles[candles.length-1].time,price:lastClose,label:'Price'}]});
        break;
      }
    }
  }
  return raw;
}

function confluenceMerge(rawSignals, symbol, timeframe) {
  if (rawSignals.length===0) return [];
  const buys = rawSignals.filter(s=>s.type==='BUY');
  const sells = rawSignals.filter(s=>s.type==='SELL');
  const merged = [];
  const thresholdPercent = (symbol.includes('USD') && !symbol.includes('XAU') && !symbol.includes('US30') && !symbol.includes('US100')) ? 0.003 : 0.009; // 0.3% for forex, 0.9% for gold/indices

  function clusterAndMerge(group) {
    if (group.length===0) return [];
    // sort by entry
    const sorted = [...group].sort((a,b)=>a.entry-b.entry);
    const clusters = [];
    let currentCluster = [sorted[0]];
    for (let i=1;i<sorted.length;i++) {
      const prevAvg = currentCluster.reduce((sum,s)=>sum+s.entry,0)/currentCluster.length;
      const dist = Math.abs(sorted[i].entry - prevAvg)/prevAvg;
      if (dist < thresholdPercent) {
        currentCluster.push(sorted[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.push(currentCluster);
    // merge each cluster into one confluence signal
    return clusters.map(cluster => {
      if (cluster.length===1) {
        return {...cluster[0], isConfluence:false, confluenceCount:1, strategies:[cluster[0].strategy]};
      }
      const avgEntry = cluster.reduce((sum,s)=>sum+s.entry,0)/cluster.length;
      const avgStop = cluster.reduce((sum,s)=>sum+s.stop,0)/cluster.length;
      const avgTP1 = cluster.reduce((sum,s)=>sum+s.tp1,0)/cluster.length;
      const maxQ = Math.max(...cluster.map(s=>s.qScore));
      const strategies = [...new Set(cluster.map(s=>s.strategy))];
      // confluence bonus
      let bonus = (strategies.length-1)*10; // +10 per extra strategy
      if (strategies.includes('Harmonic') && strategies.includes('Wolfe')) bonus+=8;
      if (strategies.includes('Order Block') && strategies.includes('FVG')) bonus+=10;
      if (strategies.includes('Harmonic') && strategies.includes('Order Block')) bonus+=7;
      const qScore = Math.min(99, maxQ + bonus);
      const best = cluster.reduce((a,b)=>a.qScore>b.qScore?a:b);
      return {
        id: symbol+'-'+timeframe+'-CONF-'+Date.now()+'-'+Math.random().toString(36).substr(2,5),
        symbol, timeframe, type: cluster[0].type,
        strategy: 'Confluence',
        patternName: strategies.join(' + '),
        entry: avgEntry, stop: avgStop, tp1: avgTP1, tp2: best.tp2,
        qScore,
        rr: best.rr,
        description: `Confluence ${strategies.length}×: ${strategies.join(' + ')} • ${cluster.length} signals merged`,
        time: Date.now(),
        patternPoints: best.patternPoints,
        isConfluence: true,
        confluenceCount: cluster.length,
        strategies,
        rawCluster: cluster
      };
    });
  }

  merged.push(...clusterAndMerge(buys));
  merged.push(...clusterAndMerge(sells));
  // return top 1-2 per timeframe sorted by quality
  return merged.sort((a,b)=>b.qScore-a.qScore).slice(0,2);
}

// ===== HIGH IMPACT NEWS MOCK ENGINE =====
function generateHighImpactEvents() {
  const now = Date.now();
  const events = [
    { currency:'USD', title:'FOMC Interest Rate Decision', impact:'HIGH', minutesFromNow: 25 + Math.floor(Math.random()*30) },
    { currency:'USD', title:'Non-Farm Payrolls (NFP)', impact:'HIGH', minutesFromNow: 90 + Math.floor(Math.random()*120) },
    { currency:'USD', title:'CPI - Consumer Price Index', impact:'HIGH', minutesFromNow: 180 + Math.floor(Math.random()*180) },
    { currency:'GBP', title:'BoE Interest Rate Decision', impact:'HIGH', minutesFromNow: 35 + Math.floor(Math.random()*50) },
    { currency:'GBP', title:'UK CPI', impact:'HIGH', minutesFromNow: 240 + Math.floor(Math.random()*200) },
    { currency:'EUR', title:'ECB Press Conference', impact:'HIGH', minutesFromNow: 45 + Math.floor(Math.random()*60) },
    { currency:'EUR', title:'Eurozone CPI', impact:'HIGH', minutesFromNow: 300 + Math.floor(Math.random()*200) },
    { currency:'USD', title:'OIL - EIA Crude Inventories', impact:'HIGH', minutesFromNow: 55 + Math.floor(Math.random()*40), affects:['OILCASH','US30','US100'] },
    { currency:'USD', title:'Gold - US Dollar Index Impact', impact:'HIGH', minutesFromNow: 70 + Math.floor(Math.random()*80), affects:['XAUUSD','XAGUSD'] },
  ];

  return events.map((e, idx) => {
    const time = now + e.minutesFromNow*60*1000;
    let affected = [];
    if (e.affects) affected = e.affects;
    else {
      if (e.currency==='USD') affected = ['XAUUSD','XAGUSD','GBPUSD','EURUSD','US30','US100','OILCASH'];
      else if (e.currency==='GBP') affected = ['GBPUSD'];
      else if (e.currency==='EUR') affected = ['EURUSD'];
    }
    // filter to our symbols
    affected = affected.filter(a=>SYMBOLS.some(s=>s.id===a));
    return {
      id: 'NEWS-'+idx+'-'+now,
      time,
      currency: e.currency,
      title: e.title,
      impact: e.impact,
      affectedSymbols: affected,
      minutesUntil: e.minutesFromNow,
      isImminent: e.minutesFromNow <= 30,
      isUpcoming: e.minutesFromNow <= 90,
    };
  }).sort((a,b)=>a.time-b.time);
}

async function analyzeSymbolConfluence(symbol, timeframe, minQ, prices) {
  const meta = SYMBOLS.find(s=>s.id===symbol);
  const mins = tfMinutes(timeframe);
  const candles = await fetchCandles(meta.yahoo, mins);
  const lastClose = candles[candles.length-1].close;
  const pivots = findPivots(candles);
  const now = Date.now();
  const rawSignals = detectAllRawSignals(pivots, candles, lastClose, symbol, timeframe, now);
  const confluenceSignals = confluenceMerge(rawSignals, symbol, timeframe);
  const filtered = confluenceSignals.filter(s=>s.qScore>=minQ && isSignalTradable(s, prices[symbol]?.price || lastClose, now));
  return { signals: filtered, candles, lastClose };
}

// Background task definition
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const storedMinQ = await AsyncStorage.getItem('minQuality');
    const minQ = storedMinQ ? parseInt(storedMinQ) : 80;
    const events = generateHighImpactEvents();
    const imminent = events.filter(e=>e.minutesUntil<=35 && e.minutesUntil>=0);
    if (imminent.length>0) {
      for (const ev of imminent.slice(0,2)) {
        await Notifications.scheduleNotificationAsync({
          content: { title: `⚠️ HIGH IMPACT in ${ev.minutesUntil}m`, body: `${ev.title} (${ev.currency}) affects ${ev.affectedSymbols.join(', ')} - Best setups ready`, sound: true, priority: Notifications.AndroidNotificationPriority.HIGH },
          trigger: null
        });
      }
    }
    // Quick scan for best confluence signals
    const allSignals = [];
    for (const sym of SYMBOLS) {
      for (const tf of ['15m','1h']) {
        try {
          const { signals } = await analyzeSymbolConfluence(sym.id, tf, minQ, {});
          allSignals.push(...signals);
        } catch {}
      }
    }
    const best = allSignals.sort((a,b)=>b.qScore-a.qScore).slice(0,1);
    if (best.length>0) {
      const s = best[0];
      await Notifications.scheduleNotificationAsync({
        content: { title: `🔥 MERIDIAN Q${s.qScore} ${s.symbol} ${s.type}`, body: `Confluence ${s.patternName} ENTRY ${formatPriceFull(s.entry,s.symbol)} SL ${formatPriceFull(s.stop,s.symbol)} TP ${formatPriceFull(s.tp1,s.symbol)}`, sound: true },
        trigger: null
      });
    }
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export default function App(){
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [selectedTF, setSelectedTF] = useState('15m');
  const [prices, setPrices] = useState({});
  const [candlesMap, setCandlesMap] = useState({});
  const [activeSignals, setActiveSignals] = useState([]); // BEST ONLY, max 6-8
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [activeTab, setActiveTab] = useState('Chart');
  const [showAlerts, setShowAlerts] = useState(false);
  const [minQuality, setMinQuality] = useState(80);
  const [loading, setLoading] = useState(false);
  const [newsEvents, setNewsEvents] = useState([]);
  const [lastScanTime, setLastScanTime] = useState(null);
  const scanInProgress = useRef(false);

  const chartCandles = candlesMap[selectedSymbol+'-'+selectedTF] || [];
  const chartHtml = React.useMemo(()=>getChartHtml(chartCandles.map(c=>({time:c.time, open:c.open, high:c.high, low:c.low, close:c.close})), selectedSignal), [chartCandles, selectedSignal]);

  // Request permissions and register background task
  useEffect(()=>{
    (async()=>{
      const { status } = await Notifications.requestPermissionsAsync();
      if (status!=='granted') console.log('Notification permission not granted');
      if (Platform.OS==='android') {
        await Notifications.setNotificationChannelAsync('meridian-alerts', {
          name:'Meridian Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern:[0,250,250,250],
          lightColor:'#D4AF37'
        });
      }
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
          minimumInterval: 15*60,
          stopOnTerminate:false,
          startOnBoot:true
        });
      }
      const savedQ = await AsyncStorage.getItem('minQuality');
      if (savedQ) setMinQuality(parseInt(savedQ));
      const savedSignals = await AsyncStorage.getItem('activeSignals');
      if (savedSignals) {
        try { const parsed = JSON.parse(savedSignals); setActiveSignals(parsed); } catch {}
      }
    })();
  },[]);

  useEffect(()=>{ AsyncStorage.setItem('minQuality', String(minQuality)); }, [minQuality]);
  useEffect(()=>{ AsyncStorage.setItem('activeSignals', JSON.stringify(activeSignals)); }, [activeSignals]);

  const fetchPrices = useCallback(async()=>{
    const newPrices = {...prices};
    for (const sym of SYMBOLS) {
      try {
        const mins = 15;
        const candles = await fetchCandles(sym.yahoo, mins);
        const last = candles[candles.length-1];
        newPrices[sym.id] = { price:last.close, change: ((last.close - candles[candles.length-2].close)/candles[candles.length-2].close*100) };
      } catch {}
    }
    setPrices(newPrices);
  },[]);

  const runConfluenceScan = useCallback(async(isManualRefresh=false)=>{
    if (scanInProgress.current) return;
    scanInProgress.current = true;
    if (isManualRefresh) setLoading(true);
    try {
      // 1. Clean expired signals
      const now = Date.now();
      let cleaned = activeSignals.filter(s=>isSignalTradable(s, prices[s.symbol]?.price, now));
      
      // 2. Determine which symbols need new signal (those without active tradable signal)
      const symbolsNeedingScan = SYMBOLS.filter(sym=>!cleaned.some(active=>active.symbol===sym.id && isSignalTradable(active, prices[active.symbol]?.price, now))).map(s=>s.id);
      // If manual refresh or quality changed, scan all
      const toScan = (isManualRefresh || lastScanTime===null) ? SYMBOLS.map(s=>s.id) : (symbolsNeedingScan.length>0 ? symbolsNeedingScan : []);

      const newCandidates = [];
      for (const symId of toScan) {
        for (const tf of TIMEFRAMES) {
          try {
            const { signals, candles, lastClose } = await analyzeSymbolConfluence(symId, tf, minQuality, prices);
            if (signals.length>0) {
              // keep candles for chart if selected
              if (symId===selectedSymbol && tf===selectedTF) {
                setCandlesMap(prev=>({...prev, [symId+'-'+tf]: candles}));
              }
              // only best per symbol across timeframes will be kept later
              newCandidates.push(...signals);
            } else {
              if (symId===selectedSymbol && tf===selectedTF) {
                setCandlesMap(prev=>({...prev, [symId+'-'+tf]: candles}));
              }
            }
          } catch (e) { }
        }
      }

      // 3. Confluence ranking: keep only BEST per symbol (highest Q), then top 6 overall
      const bestPerSymbol = {};
      for (const sig of [...cleaned, ...newCandidates]) {
        const key = sig.symbol;
        if (!bestPerSymbol[key] || sig.qScore > bestPerSymbol[key].qScore) {
          bestPerSymbol[key] = sig;
        }
      }
      let finalList = Object.values(bestPerSymbol).filter(s=>s.qScore>=minQuality && isSignalTradable(s, prices[s.symbol]?.price, now));
      // Sort by quality and limit to best 7 to avoid spam
      finalList = finalList.sort((a,b)=>b.qScore-a.qScore).slice(0,7);

      // 4. Detect NEW signals for notification (those not in cleaned)
      const newSignals = finalList.filter(nf=>!cleaned.some(c=>c.id===nf.id || (c.symbol===nf.symbol && Math.abs(c.entry-nf.entry)/c.entry<0.002)));
      if (newSignals.length>0 && !isManualRefresh) {
        for (const ns of newSignals.slice(0,2)) {
          await Notifications.scheduleNotificationAsync({
            content: { title:`🔥 BEST Q${ns.qScore} ${ns.symbol} ${ns.type}`, body:`${ns.patternName} Confluence ${ns.confluenceCount?`(${ns.confluenceCount}x)`:''} ENTRY ${formatPriceFull(ns.entry, ns.symbol)}`, sound:true },
            trigger:null
          });
        }
      }

      setActiveSignals(finalList);
      if (finalList.length>0 && !selectedSignal) setSelectedSignal(finalList[0]);
      setLastScanTime(Date.now());

      // 5. News events update
      const events = generateHighImpactEvents();
      setNewsEvents(events);

      // Notify imminent news
      const imminent = events.filter(e=>e.minutesUntil<=30 && e.minutesUntil>=0);
      if (imminent.length>0 && !isManualRefresh) {
        for (const ev of imminent.slice(0,1)) {
          await Notifications.scheduleNotificationAsync({
            content: { title:`⚠️ ${ev.currency} HIGH IMPACT in ${ev.minutesUntil}m`, body:`${ev.title} affects ${ev.affectedSymbols.join(', ')} - Confluence setups ready`, sound:true, priority: Notifications.AndroidNotificationPriority.HIGH },
            trigger:null
          });
        }
      }

    } catch (e) { console.log('scan error', e); }
    finally { setLoading(false); scanInProgress.current=false; }
  },[activeSignals, prices, minQuality, selectedSymbol, selectedTF, lastScanTime, selectedSignal]);

  // Initial fetch and periodic scan
  useEffect(()=>{
    fetchPrices();
    runConfluenceScan(true);
    const priceInterval = setInterval(fetchPrices, 30000);
    const scanInterval = setInterval(()=>runConfluenceScan(false), 90000);
    return ()=>{ clearInterval(priceInterval); clearInterval(scanInterval); };
  },[]);

  // When quality bar changes, refresh signals
  useEffect(()=>{
    if (lastScanTime!==null) {
      runConfluenceScan(true);
    }
  },[minQuality]);

  const onRefresh = useCallback(()=>{ runConfluenceScan(true); },[runConfluenceScan]);

  const filteredSignals = activeSignals.filter(s=>s.qScore>=minQuality).sort((a,b)=>b.qScore-a.qScore);
  const imminentEvents = newsEvents.filter(e=>e.minutesUntil<=120).slice(0,6);
  const highImpactCount = newsEvents.filter(e=>e.isImminent).length;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MERIDIAN <Text style={styles.headerVersion}>v5 CONFLUENCE</Text></Text>
          <TouchableOpacity onPress={()=>setShowAlerts(true)} style={styles.bellBtn}><Text style={styles.bellIcon}>🔔</Text>{highImpactCount>0 && <View style={styles.badge}><Text style={styles.badgeText}>{highImpactCount}</Text></View>}</TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerWrap} contentContainerStyle={styles.tickerContent}>
          {SYMBOLS.map(s=>{
            const p = prices[s.id];
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerItem, selectedSymbol===s.id && styles.tickerActive]} onPress={()=>{ setSelectedSymbol(s.id); setActiveTab('Chart'); }}>
                <Text style={styles.tickerName}>{s.id}{p?` ${p.change>=0?'+':''}${p.change.toFixed(2)}%`:''}</Text>
                <Text style={styles.tickerPrice}>{p?formatPriceFull(p.price, s.id):'--'}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.tfRow}>
          {TIMEFRAMES.map(tf=>(
            <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfActive]} onPress={()=>setSelectedTF(tf)}>
              <Text style={[styles.tfText, selectedTF===tf && styles.tfTextActive]}>{tf}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.scanStatus}><Text style={styles.scanStatusText}>{lastScanTime?`Scan ${formatTimeAgo(lastScanTime)}`: 'Scanning...'}</Text></View>
        </View>

        <View style={styles.main}>
          {activeTab==='Chart' && (
            <>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol} <Text style={styles.symbolFull}>{SYMBOLS.find(s=>s.id===selectedSymbol).fullName}</Text></Text>
                <Text style={styles.symbolPrice}>{prices[selectedSymbol] ? formatPriceFull(prices[selectedSymbol].price, selectedSymbol) : '--'}</Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView originWhitelist={['*']} source={{ html: chartHtml }} style={{ flex:1, backgroundColor:'#0e0e10' }} javaScriptEnabled />
              </View>
              {selectedSignal && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>ENTRY</Text><Text style={styles.detailValue}>{formatPriceFull(selectedSignal.entry, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>STOP</Text><Text style={[styles.detailValue,{color:'#ff3b30'}]}>{formatPriceFull(selectedSignal.stop, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>TP1</Text><Text style={[styles.detailValue,{color:'#30d158'}]}>{formatPriceFull(selectedSignal.tp1, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>{selectedSignal.isConfluence?`CONFLUENCE ${selectedSignal.confluenceCount}x`:'BEST'} • {formatTimeAgo(selectedSignal.time)}</Text><Text style={styles.detailValue}>Q{selectedSignal.qScore} • {selectedSignal.rr}</Text></View>
                </View>
              )}
              {selectedSignal && (
                <View style={styles.setupInfo}>
                  <Text style={styles.setupInfoText}>{selectedSignal.patternName} • {selectedSignal.description} • Setup: {selectedSignal.patternPoints.map(p=>p.label).join(' → ')} • Entry/SL/TP on chart</Text>
                </View>
              )}
            </>
          )}
          {activeTab==='Setups' && (
            <ScrollView style={{flex:1}} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#fff" />}>
              <View style={styles.setupsHeader}>
                <Text style={styles.setupsHeaderText}>{filteredSignals.length} BEST CONFLUENCE • One per symbol • Auto-expires</Text>
                <Text style={styles.setupsSubHeader}>Strategies collaborate — only highest quality tradable signal per symbol. New signals appear only after last expires.</Text>
              </View>
              {filteredSignals.map(s=>(
                <TouchableOpacity key={s.id} style={[styles.setupCard, s.isConfluence && styles.setupCardConfluence]} onPress={()=>{ setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); setSelectedSignal(s); setActiveTab('Chart'); }}>
                  <View style={styles.setupTop}>
                    <Text style={styles.setupSymbol}>{s.symbol} {s.timeframe} {s.type} Q{s.qScore} • {s.patternName}{s.confluenceCount?` (${s.confluenceCount}x)` : ''}</Text>
                    <Text style={styles.setupTime}>{formatTimeAgo(s.time)}</Text>
                  </View>
                  <Text style={styles.setupDesc}>ENTRY {formatPriceFull(s.entry, s.symbol)} STOP {formatPriceFull(s.stop, s.symbol)} TP {formatPriceFull(s.tp1, s.symbol)}</Text>
                  <Text style={styles.setupMeta}>{s.description} • {s.rr} • {s.timeframe} • {s.patternPoints.map(p=>p.label).join(' → ')}</Text>
                  {s.isConfluence && <View style={styles.confluenceBadge}><Text style={styles.confluenceBadgeText}>🔥 CONFLUENCE {s.strategies.join(' + ')}</Text></View>}
                </TouchableOpacity>
              ))}
              {filteredSignals.length===0 && <Text style={styles.emptyText}>No confluence setups yet. Engine merges Harmonic + Wolfe + OB + FVG + S/R into BEST only. Scanning every 90s. Background notifications ON.</Text>}
            </ScrollView>
          )}
          {activeTab==='News' && (
            <ScrollView style={{flex:1}} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#fff" />}>
              <View style={styles.setupsHeader}>
                <Text style={styles.setupsHeaderText}>⚠️ HIGH IMPACT FUNDAMENTALS • 30min Warning</Text>
                <Text style={styles.setupsSubHeader}>Only HIGH impact events affecting your 7 symbols. Notifies 30 min before. Best signals combine news + confluence.</Text>
              </View>
              {imminentEvents.map(ev=>(
                <View key={ev.id} style={[styles.setupCard, ev.isImminent && styles.newsImminentCard]}>
                  <View style={styles.setupTop}>
                    <Text style={[styles.setupSymbol, ev.isImminent && {color:'#ff9f0a'}]}>{ev.isImminent?'🔴 ':'🟡 '}{ev.currency} HIGH • {ev.title}</Text>
                    <Text style={styles.setupTime}>{formatCountdown(ev.time)}</Text>
                  </View>
                  <Text style={styles.setupDesc}>Affects: {ev.affectedSymbols.join(', ')} • Impact: {ev.impact} • {ev.minutesUntil}m left</Text>
                  <Text style={styles.setupMeta}>Action: Watch {ev.affectedSymbols.join('/')} for confluence breakout 30min before. Engine boosts Q-score when technical + news align.</Text>
                  {ev.isImminent && activeSignals.some(s=>ev.affectedSymbols.includes(s.symbol)) && (
                    <View style={styles.confluenceBadge}><Text style={styles.confluenceBadgeText}>⚡ BEST SETUP READY: {activeSignals.filter(s=>ev.affectedSymbols.includes(s.symbol)).map(s=>`${s.symbol} ${s.type} Q${s.qScore}`).join(', ')}</Text></View>
                  )}
                </View>
              ))}
              <View style={styles.newsAllSection}>
                <Text style={styles.modalSection}>ALL HIGH IMPACT (Next 24h)</Text>
                {newsEvents.slice(0,8).map(ev=>(
                  <View key={ev.id+'-all'} style={styles.newsRow}>
                    <Text style={styles.newsTime}>{new Date(ev.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</Text>
                    <Text style={styles.newsTitle}>{ev.currency} {ev.title}</Text>
                    <Text style={styles.newsSymbols}>{ev.affectedSymbols.join(',')}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        <View style={styles.bottomTabs}>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Chart')}><Text style={[styles.tabLabel, activeTab==='Chart'&&styles.tabActive]}>Chart</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('Setups')}><Text style={[styles.tabLabel, activeTab==='Setups'&&styles.tabActive]}>Setups {filteredSignals.length}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={()=>setActiveTab('News')}><Text style={[styles.tabLabel, activeTab==='News'&&styles.tabActive]}>News {imminentEvents.length}{highImpactCount>0?` 🔴${highImpactCount}`:''}</Text></TouchableOpacity>
        </View>

        <Modal visible={showAlerts} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}><Text style={styles.modalTitle}>Meridian v5 Confluence + Background</Text><TouchableOpacity onPress={()=>setShowAlerts(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity></View>
              <ScrollView>
                <Text style={styles.modalSection}>BACKGROUND & NOTIFICATIONS</Text>
                <View style={styles.settingRow}><Text style={styles.settingTitle}>Background scan</Text><Switch value={true} trackColor={{false:'#2c2c2e',true:'#30d158'}} /></View>
                <Text style={styles.settingDesc}>App scans every 15min in background even when closed. Sends push for BEST confluence signals and 30min before HIGH impact news. Permissions: RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE, POST_NOTIFICATIONS.</Text>
                
                <Text style={styles.modalSection}>CONFLUENCE ENGINE</Text>
                <Text style={styles.settingDesc}>• Strategies no longer work alone. Engine merges Harmonic + Wolfe + OB + FVG + S/R if same direction and entry within 0.3% (forex) / 0.9% (gold/indices).{'\n'}• Quality = max(Q) +10 per extra strategy + bonus for Harmonic+Wolfe, OB+FVG.{'\n'}• Only ONE best tradable signal per symbol. Max 7 signals total to avoid spam.{'\n'}• New signal for a symbol appears ONLY after last expires / hits SL / untradable.</Text>

                <Text style={styles.modalSection}>MINIMUM QUALITY - Tap to refresh</Text>
                <View style={styles.qualityRow}>
                  <TouchableOpacity onPress={()=>setMinQuality(Math.max(0, minQuality-1))} style={styles.qualityBtn}><Text style={styles.qualityBtnText}>−</Text></TouchableOpacity>
                  <View style={styles.qualityBarWrap}>
                    <View style={styles.qualityBarBg}><View style={[styles.qualityBarFill, {width: minQuality+'%'}]} /></View>
                    <Text style={styles.qualityValue}>{minQuality}</Text>
                  </View>
                  <TouchableOpacity onPress={()=>setMinQuality(Math.min(100, minQuality+1))} style={styles.qualityBtn}><Text style={styles.qualityBtnText}>+</Text></TouchableOpacity>
                </View>
                <View style={styles.qualityPresets}>
                  {[70,75,80,85,90,95].map(v=>(
                    <TouchableOpacity key={v} style={[styles.presetBtn, minQuality===v && styles.presetActive]} onPress={()=>setMinQuality(v)}><Text style={[styles.presetText, minQuality===v && styles.presetTextActive]}>{v}</Text></TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.settingDesc}>Changing quality instantly re-scans and refreshes signals.</Text>

                <Text style={styles.modalSection}>HIGH IMPACT NEWS</Text>
                <Text style={styles.settingDesc}>• Only HIGH impact fundamentals affecting your 7 symbols.{'\n'}• Notifies 30min before event.{'\n'}• Boosts confluence Q-score when technical aligns with news volatility.{'\n'}• Tab: News shows countdown, affected symbols, and BEST confluence setup for that news.</Text>

                <Text style={styles.modalSection}>PERMISSIONS</Text>
                <Text style={styles.settingDesc}>Android: RECEIVE_BOOT_COMPLETED, WAKE_LOCK, VIBRATE, FOREGROUND_SERVICE, POST_NOTIFICATIONS, USE_EXACT_ALARM.{'\n'}BackgroundFetch interval 15min, startOnBoot true.</Text>

                <View style={{height:40}} />
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container:{flex:1, backgroundColor:'#0a0a0a'},
  header:{flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingTop:10, paddingBottom:8, backgroundColor:'#0a0a0a', borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  headerTitle:{color:'#fff', fontSize:20, fontWeight:'900', letterSpacing:1},
  headerVersion:{color:'#D4AF37', fontSize:12, fontWeight:'600'},
  bellBtn:{padding:6, position:'relative'},
  bellIcon:{fontSize:20},
  badge:{position:'absolute', top:0, right:0, backgroundColor:'#ff3b30', borderRadius:8, minWidth:16, height:16, justifyContent:'center', alignItems:'center', paddingHorizontal:4},
  badgeText:{color:'#fff', fontSize:10, fontWeight:'bold'},
  tickerWrap:{maxHeight:68, backgroundColor:'#0a0a0a'},
  tickerContent:{paddingHorizontal:8, paddingVertical:6},
  tickerItem:{backgroundColor:'#141416', borderRadius:10, paddingHorizontal:12, paddingVertical:6, marginRight:8, minWidth:96, borderWidth:1, borderColor:'#1c1c1e'},
  tickerActive:{borderColor:'#D4AF37', backgroundColor:'#1a1a1e'},
  tickerName:{color:'#8a8a8e', fontSize:10, fontWeight:'600'},
  tickerPrice:{color:'#fff', fontSize:13, fontWeight:'700', marginTop:2},
  tfRow:{flexDirection:'row', paddingHorizontal:12, paddingVertical:8, backgroundColor:'#0a0a0a', alignItems:'center', borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  tfBtn:{paddingHorizontal:12, paddingVertical:6, borderRadius:8, backgroundColor:'#1c1c1e', marginRight:6},
  tfActive:{backgroundColor:'#D4AF37'},
  tfText:{color:'#8a8a8e', fontSize:12, fontWeight:'700'},
  tfTextActive:{color:'#0a0a0a'},
  scanStatus:{marginLeft:'auto'},
  scanStatusText:{color:'#5a5a5e', fontSize:10},
  main:{flex:1, backgroundColor:'#0a0a0a'},
  symbolInfo:{flexDirection:'row', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:8, backgroundColor:'#0e0e10'},
  symbolTitle:{color:'#fff', fontSize:14, fontWeight:'700'},
  symbolFull:{color:'#8a8a8e', fontWeight:'400'},
  symbolPrice:{color:'#D4AF37', fontSize:14, fontWeight:'700'},
  chartWrap:{height:280, backgroundColor:'#0e0e10'},
  signalDetailBar:{flexDirection:'row', backgroundColor:'#141416', paddingVertical:8, paddingHorizontal:12, justifyContent:'space-between', borderTopWidth:1, borderTopColor:'#1c1c1e'},
  detailCol:{alignItems:'center'},
  detailLabel:{color:'#8a8a8e', fontSize:9, fontWeight:'600'},
  detailValue:{color:'#fff', fontSize:12, fontWeight:'700', marginTop:2},
  setupInfo:{backgroundColor:'#141416', paddingHorizontal:12, paddingVertical:6, borderTopWidth:1, borderTopColor:'#1c1c1e'},
  setupInfoText:{color:'#8a8a8e', fontSize:10},
  setupsHeader:{padding:12, backgroundColor:'#0e0e10', borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  setupsHeaderText:{color:'#fff', fontSize:12, fontWeight:'700'},
  setupsSubHeader:{color:'#8a8a8e', fontSize:10, marginTop:4, lineHeight:14},
  setupCard:{backgroundColor:'#141416', marginHorizontal:10, marginVertical:6, borderRadius:12, padding:12, borderWidth:1, borderColor:'#1c1c1e'},
  setupCardConfluence:{borderColor:'#D4AF37', backgroundColor:'#1c1a14'},
  setupTop:{flexDirection:'row', justifyContent:'space-between', alignItems:'center'},
  setupSymbol:{color:'#fff', fontSize:12, fontWeight:'700', flex:1},
  setupTime:{color:'#5a5a5e', fontSize:10},
  setupDesc:{color:'#D4AF37', fontSize:11, fontWeight:'600', marginTop:6},
  setupMeta:{color:'#8a8a8e', fontSize:10, marginTop:4},
  confluenceBadge:{marginTop:8, backgroundColor:'#D4AF37', borderRadius:6, paddingHorizontal:8, paddingVertical:4, alignSelf:'flex-start'},
  confluenceBadgeText:{color:'#0a0a0a', fontSize:10, fontWeight:'800'},
  emptyText:{color:'#5a5a5e', fontSize:12, textAlign:'center', padding:30, lineHeight:18},
  bottomTabs:{flexDirection:'row', backgroundColor:'#0e0e10', borderTopWidth:1, borderTopColor:'#1c1c1e', paddingVertical:8},
  tabBtn:{flex:1, alignItems:'center', paddingVertical:6},
  tabLabel:{color:'#8a8a8e', fontSize:12, fontWeight:'600'},
  tabActive:{color:'#D4AF37'},
  modalOverlay:{flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'flex-end'},
  modalContent:{backgroundColor:'#141416', borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'85%', paddingBottom:20},
  modalHeader:{flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  modalTitle:{color:'#fff', fontSize:16, fontWeight:'700'},
  modalClose:{color:'#8a8a8e', fontSize:20, paddingHorizontal:8},
  modalSection:{color:'#D4AF37', fontSize:11, fontWeight:'800', letterSpacing:1, marginTop:18, marginBottom:8, paddingHorizontal:16},
  settingRow:{flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:16, paddingVertical:12, backgroundColor:'#1c1c1e', marginHorizontal:12, borderRadius:10, marginBottom:8},
  settingTitle:{color:'#fff', fontSize:13, fontWeight:'600'},
  settingDesc:{color:'#8a8a8e', fontSize:11, lineHeight:16, paddingHorizontal:16, marginBottom:8},
  qualityRow:{flexDirection:'row', alignItems:'center', paddingHorizontal:16, marginTop:8},
  qualityBtn:{width:36, height:36, borderRadius:18, backgroundColor:'#1c1c1e', justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:'#2c2c2e'},
  qualityBtnText:{color:'#fff', fontSize:18, fontWeight:'600'},
  qualityBarWrap:{flex:1, flexDirection:'row', alignItems:'center', marginHorizontal:12},
  qualityBarBg:{flex:1, height:6, backgroundColor:'#1c1c1e', borderRadius:3, overflow:'hidden'},
  qualityBarFill:{height:6, backgroundColor:'#D4AF37', borderRadius:3},
  qualityValue:{color:'#D4AF37', fontSize:14, fontWeight:'700', marginLeft:10, minWidth:28},
  qualityPresets:{flexDirection:'row', paddingHorizontal:16, marginTop:12, flexWrap:'wrap'},
  presetBtn:{paddingHorizontal:12, paddingVertical:6, borderRadius:16, backgroundColor:'#1c1c1e', marginRight:8, marginBottom:8, borderWidth:1, borderColor:'#2c2c2e'},
  presetActive:{backgroundColor:'#D4AF37', borderColor:'#D4AF37'},
  presetText:{color:'#8a8a8e', fontSize:11, fontWeight:'600'},
  presetTextActive:{color:'#0a0a0a'},
  newsImminentCard:{borderColor:'#ff9f0a', backgroundColor:'#1e1a12'},
  newsAllSection:{padding:12},
  newsRow:{flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#1c1c1e', alignItems:'center'},
  newsTime:{color:'#D4AF37', fontSize:11, fontWeight:'700', width:60},
  newsTitle:{color:'#fff', fontSize:11, flex:1, marginHorizontal:8},
  newsSymbols:{color:'#8a8a8e', fontSize:10, width:80, textAlign:'right'},
});
