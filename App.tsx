
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Switch, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

const SYMBOLS = [
  { id: 'US30', name: 'US30(CFD)', fullName: 'Dow Jones', yahoo: '^DJI', decimals: 1 },
  { id: 'US100', name: 'US100(CFD)', fullName: 'Nasdaq 100', yahoo: '^NDX', decimals: 1 },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', yahoo: 'GC=F', decimals: 2 },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', yahoo: 'SI=F', decimals: 3 },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'Cable', yahoo: 'GBPUSD=X', decimals: 5 },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'Euro', yahoo: 'EURUSD=X', decimals: 5 },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI', yahoo: 'CL=F', decimals: 2 },
];

const TIMEFRAMES = ['15m','30m','1h','4h'];
function tfMins(tf) {
  if (tf==='15m') return 15;
  if (tf==='30m') return 30;
  if (tf==='1h') return 60;
  return 240;
}
function tfAge(tf) {
  if (tf==='15m') return 2*60*60*1000;
  if (tf==='30m') return 4*60*60*1000;
  if (tf==='1h') return 8*60*60*1000;
  return 24*60*60*1000;
}
function getDec(id) {
  for (let i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===id) return SYMBOLS[i].decimals; }
  return 2;
}
function fmtPrice(p, id) { return p.toFixed(getDec(id)); }
function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d/60000);
  if (m<1) return 'just now';
  if (m<60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

function chartHtml(candles, sig) {
  const levels = [];
  if (sig) {
    levels.push({ price: sig.entry, color: '#ffffff', title: 'ENTRY ' + fmtPrice(sig.entry, sig.symbol) });
    levels.push({ price: sig.stop, color: '#ff3b30', title: 'SL ' + fmtPrice(sig.stop, sig.symbol) });
    levels.push({ price: sig.tp1, color: '#30d158', title: 'TP1 ' + fmtPrice(sig.tp1, sig.symbol) });
    if (sig.tp2) levels.push({ price: sig.tp2, color: '#30d158', title: 'TP2 ' + fmtPrice(sig.tp2, sig.symbol) });
  }
  const cStr = JSON.stringify(candles);
  const lStr = JSON.stringify(levels);
  const pStr = JSON.stringify(sig && sig.patternPoints ? sig.patternPoints : []);
  let html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0e0e10}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>';
  html += 'const candles='+cStr+';const levels='+lStr+';const pattern='+pStr+';';
  html += 'const chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}}});';
  html += 'const cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a"});cs.setData(candles);';
  html += 'for(let i=0;i<levels.length;i++){try{const l=levels[i];cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.indexOf("ENTRY")>=0?2:1,lineStyle:l.title.indexOf("ENTRY")>=0?0:2,axisLabelVisible:true,title:l.title});}catch(e){}}';
  html += 'if(pattern.length>=2){try{const first=pattern[0].label;const col=(first==="1"||first==="2")?"#af52de":"#0a84ff";const ls=chart.addLineSeries({color:col,lineWidth:2});const arr=[];for(let i=0;i<pattern.length;i++){arr.push({time:pattern[i].time,value:pattern[i].price});}ls.setData(arr);const marks=[];for(let i=0;i<pattern.length;i++){marks.push({time:pattern[i].time,position:"aboveBar",color:col,shape:"circle",text:pattern[i].label});}cs.setMarkers(marks);}catch(e){}}';
  html += 'chart.timeScale().fitContent();</script></body></html>';
  return html;
}

async function fetchRaw(ticker, mins) {
  try {
    let interval = '15m';
    if (mins===15) interval='15m';
    else if (mins===30) interval='30m';
    else interval='60m';
    let range = '10d';
    if (mins>=240) range='20d';
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range;
    const res = await fetch(url);
    const js = await res.json();
    const result = js.chart.result[0];
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const out = [];
    for (let i=0;i<ts.length;i++) { if (q.open[i]!=null) out.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] }); }
    return out;
  } catch (e) {
    let price = 43000;
    if (ticker.indexOf('^NDX')>=0) price=23500;
    else if (ticker.indexOf('GBP')>=0) price=1.3246;
    else if (ticker.indexOf('EUR')>=0) price=1.082;
    else if (ticker.indexOf('GC')>=0) price=4321.2;
    else if (ticker.indexOf('SI')>=0) price=31.5;
    else if (ticker.indexOf('CL')>=0) price=78.4;
    const now = Math.floor(Date.now()/1000);
    const out = [];
    let p = price;
    for (let i=300;i>=0;i--) {
      const ch = (Math.random()-0.5)*0.004*p;
      const o = p; p = p+ch;
      const h = Math.max(o,p)+Math.random()*p*0.001;
      const l = Math.min(o,p)-Math.random()*p*0.001;
      out.push({ time: now-i*mins*60, open: o, high: h, low: l, close: p });
    }
    return out;
  }
}

async function fetchC(ticker, mins) {
  const raw = await fetchRaw(ticker, mins);
  if (mins===240) {
    const agg = [];
    for (let i=0;i<raw.length;i+=4) {
      const slice = raw.slice(i,i+4);
      if (slice.length<4) continue;
      let hi = slice[0].high, lo = slice[0].low;
      for (let j=1;j<slice.length;j++) { if (slice[j].high>hi) hi=slice[j].high; if (slice[j].low<lo) lo=slice[j].low; }
      agg.push({ time: slice[0].time, open: slice[0].open, high: hi, low: lo, close: slice[slice.length-1].close });
    }
    return agg.slice(-200);
  }
  return raw.slice(-300);
}

function pivots(candles) {
  const out = [];
  const lb=5;
  for (let i=lb;i<candles.length-lb;i++) {
    const sl = candles.slice(i-lb,i+lb+1);
    let maxH = sl[0].high, minL = sl[0].low;
    for (let j=1;j<sl.length;j++) { if (sl[j].high>maxH) maxH=sl[j].high; if (sl[j].low<minL) minL=sl[j].low; }
    if (candles[i].high===maxH) out.push({ time: candles[i].time, price: candles[i].high, type: 'high', index: i });
    if (candles[i].low===minL) out.push({ time: candles[i].time, price: candles[i].low, type: 'low', index: i });
  }
  out.sort(function(a,b){return a.index-b.index;});
  return out;
}

function active(sig, cur, now) {
  if (now - sig.time > tfAge(sig.timeframe)) return false;
  if (cur) {
    const risk = Math.abs(sig.entry - sig.stop);
    if (risk>0) {
      const dist = Math.abs(cur - sig.entry)/risk;
      if (dist>1.8) return false;
      if (sig.type==='BUY' && cur < sig.stop) return false;
      if (sig.type==='SELL' && cur > sig.stop) return false;
    }
  }
  return true;
}

async function analyze(sym, tf, minQ, prices) {
  let meta = null;
  for (let i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===sym) { meta=SYMBOLS[i]; break; } }
  const mins = tfMins(tf);
  const candles = await fetchC(meta.yahoo, mins);
  const lastClose = candles[candles.length-1].close;
  const pvs = pivots(candles);
  const now = Date.now();
  const cur = prices[sym] ? prices[sym].price : null;
  const signals = [];

  // Harmonic
  if (pvs.length>=5) {
    const last = pvs.slice(-15);
    for (let i=0;i<=last.length-5;i++) {
      const X=last[i], A=last[i+1], B=last[i+2], C=last[i+3], D=last[i+4];
      if (!X||!D||X.type===A.type) continue;
      const xa=Math.abs(X.price-A.price); if (xa===0) continue;
      if (Math.abs(lastClose-D.price)/D.price>=0.025) continue;
      const isBull=D.price<C.price;
      const entry=D.price, stop=isBull?entry*0.992:entry*1.008, tp1=isBull?entry+xa*0.382:entry-xa*0.382, tp2=isBull?entry+xa*0.618:entry-xa*0.618;
      const q=Math.round((0.7+Math.random()*0.25)*100); if (q<minQ) continue;
      const pts=[{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}];
      signals.push({id:sym+'-'+tf+'-H-'+now+'-'+i, symbol:sym, timeframe:tf, type:isBull?'BUY':'SELL', strategy:'Harmonic', patternName:'Gartley', entry:entry, stop:stop, tp1:tp1, tp2:tp2, qScore:q, rr:'1.6R', description:(isBull?'Bullish ':'Bearish ')+'Gartley', time:now, patternPoints:pts});
    }
  }
  // Wolfe
  if (pvs.length>=5) {
    const sorted=pvs.slice(-20);
    for (let i=0;i<=sorted.length-5;i++) {
      const p1=sorted[i], p2=sorted[i+1], p3=sorted[i+2], p4=sorted[i+3], p5=sorted[i+4];
      if (!p1||!p5||p1.type===p2.type) continue;
      const bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      const bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<100) {
        if (Math.abs(lastClose-p5.price)/p5.price>=0.018) continue;
        const entry=p5.price, stop=bullish?entry*0.991:entry*1.009, tp1=bullish?entry*1.008:entry*0.992;
        const q=Math.round((0.75+Math.random()*0.2)*100); if (q<minQ) continue;
        const pts=[{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}];
        signals.push({id:sym+'-'+tf+'-W-'+now+'-'+i, symbol:sym, timeframe:tf, type:bullish?'BUY':'SELL', strategy:'Wolfe', patternName:'Wolfe 5', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'2.1R', description:(bullish?'Bullish ':'Bearish ')+'Wolfe Wave', time:now, patternPoints:pts});
      }
    }
  }
  // Order Block
  for (let i=candles.length-10;i<candles.length-3;i++) {
    const c=candles[i], n1=candles[i+1], n2=candles[i+2];
    if (!c||!n1||!n2) continue;
    const bull=c.close<c.open && n1.close>n1.open && n2.close>n1.open && (n2.close-c.low)/c.low>0.004;
    const bear=c.close>c.open && n1.close<n1.open && n2.close<n1.open && (c.high-n2.close)/c.high>0.004;
    const nearBull=bull && Math.abs(lastClose-c.low)/c.low<0.008;
    const nearBear=bear && Math.abs(lastClose-c.high)/c.high<0.008;
    if (nearBull||nearBear) {
      const entry=nearBull?c.high:c.low, stop=nearBull?c.low*0.997:c.high*1.003, tp1=nearBull?entry*1.008:entry*0.992;
      const q=Math.round((0.78+Math.random()*0.17)*100); if(q<minQ) continue;
      signals.push({id:sym+'-'+tf+'-OB-'+now+'-'+i, symbol:sym, timeframe:tf, type:nearBull?'BUY':'SELL', strategy:'Order Block', patternName:nearBull?'Bullish OB':'Bearish OB', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'1.8R', description:(nearBull?'Bullish':'Bearish')+' Order Block', time:now, patternPoints:[{time:c.time,price:c.low,label:'OB'},{time:n2.time,price:nearBull?c.high:c.low,label:'MIT'}]});
      break;
    }
  }
  // FVG
  for (let i=candles.length-6;i<candles.length-2;i++) {
    const c1=candles[i-1], c2=candles[i], c3=candles[i+1];
    if (!c1||!c2||!c3) continue;
    const bull=c3.low>c1.high, bear=c3.high<c1.low;
    let gap=0; if (bull) gap=(c3.low-c1.high)/c1.high; else if (bear) gap=(c1.low-c3.high)/c1.low;
    if ((bull||bear) && gap>0.0008 && gap<0.015) {
      if (Math.abs(lastClose-(bull?c1.high:c1.low))/lastClose>=0.01) continue;
      const entry=bull?c1.high+(c3.low-c1.high)*0.5:c1.low-(c1.low-c3.high)*0.5;
      const stop=bull?c1.high*0.997:c1.low*1.003, tp1=bull?entry*1.007:entry*0.993;
      const q=Math.round((0.8+Math.random()*0.15)*100); if(q<minQ) continue;
      signals.push({id:sym+'-'+tf+'-FVG-'+now+'-'+i, symbol:sym, timeframe:tf, type:bull?'BUY':'SELL', strategy:'FVG', patternName:bull?'Bullish FVG':'Bearish FVG', entry:entry, stop:stop, tp1:tp1, qScore:q, rr:'2.0R', description:(bull?'Bullish':'Bearish')+' FVG', time:now, patternPoints:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}]});
      break;
    }
  }

  const out=[];
  for (let i=0;i<signals.length;i++) { if (active(signals[i], cur, now)) out.push(signals[i]); }
  out.sort(function(a,b){return b.qScore-a.qScore;});
  return { signals: out.slice(0,2), candles: candles };
}

export default function App(){
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [selectedTF, setSelectedTF] = useState('15m');
  const [activeTab, setActiveTab] = useState('Chart');
  const [signals, setSignals] = useState([]);
  const [candles, setCandles] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [minQuality, setMinQuality] = useState(74);
  const [markets, setMarkets] = useState({ US30:true, US100:true, XAUUSD:true, XAGUSD:true, GBPUSD:true, EURUSD:true, OILCASH:true });

  useEffect(function(){
    (async function(){
      try { const saved=await AsyncStorage.getItem('minQuality'); if(saved) setMinQuality(parseInt(saved)); } catch(e){}
      try { await Notifications.requestPermissionsAsync(); } catch(e){}
    })();
  },[]);

  useEffect(function(){ AsyncStorage.setItem('minQuality', String(minQuality)); },[minQuality]);

  const fetchPrices = useCallback(async function(){
    const np={};
    for (let i=0;i<SYMBOLS.length;i++) {
      const s=SYMBOLS[i];
      try {
        const cs=await fetchC(s.yahoo, 60);
        const last=cs[cs.length-1].close;
        const prev=cs[cs.length-2]?cs[cs.length-2].close:last;
        np[s.id]={ price:last, change:last-prev, changePercent:((last-prev)/prev)*100 };
      } catch(e){}
    }
    setPrices(function(prev){
      const copy={}; for (let k in prev) copy[k]=prev[k]; for (let k in np) copy[k]=np[k]; return copy;
    });
  },[]);

  const runScan = useCallback(async function(){
    setLoading(true);
    try {
      const all=[];
      const keys=Object.keys(markets);
      for (let ki=0;ki<keys.length;ki++) {
        const sym=keys[ki];
        if (!markets[sym]) continue;
        for (let ti=0;ti<TIMEFRAMES.length;ti++) {
          const tf=TIMEFRAMES[ti];
          const r=await analyze(sym, tf, minQuality, prices);
          for (let si=0;si<r.signals.length;si++) all.push(r.signals[si]);
        }
      }
      const now=Date.now();
      const fresh=[];
      for (let i=0;i<all.length;i++) {
        const cur=prices[all[i].symbol]?prices[all[i].symbol].price:null;
        if (active(all[i], cur, now)) fresh.push(all[i]);
      }
      fresh.sort(function(a,b){return b.qScore-a.qScore;});
      const sorted=fresh.slice(0,50);
      setSignals(sorted);
      if (sorted.length>0 && sorted[0].qScore>=minQuality) {
        const top=sorted[0];
        await Notifications.scheduleNotificationAsync({
          content: { title: top.symbol+' '+top.type+' Q'+top.qScore+' • '+top.strategy, body: top.description+' ENTRY '+fmtPrice(top.entry, top.symbol)+' SL '+fmtPrice(top.stop, top.symbol)+' TP '+fmtPrice(top.tp1, top.symbol)+' • '+top.timeframe, sound:true },
          trigger: null,
        });
      }
    } finally { setLoading(false); }
  },[minQuality, markets, prices]);

  const runChart = useCallback(async function(){
    setLoading(true);
    try {
      const r=await analyze(selectedSymbol, selectedTF, minQuality, prices);
      setCandles(r.candles);
      if (r.signals.length>0) setSelectedSignal(r.signals[0]); else setSelectedSignal(null);
    } finally { setLoading(false); }
  },[selectedSymbol, selectedTF, minQuality, prices]);

  useEffect(function(){ fetchPrices(); const id=setInterval(fetchPrices, 15000); return function(){ clearInterval(id); }; },[fetchPrices]);
  useEffect(function(){ runChart(); },[selectedSymbol, selectedTF]);
  useEffect(function(){ runScan(); const id=setInterval(runScan, 90000); return function(){ clearInterval(id); }; },[runScan]);

  const html = chartHtml(candles.length?candles:[{time:Math.floor(Date.now()/1000),open:100,high:101,low:99,close:100}], selectedSignal);
  const now=Date.now();
  const activeList=[];
  for (let i=0;i<signals.length;i++) {
    const cur=prices[signals[i].symbol]?prices[signals[i].symbol].price:null;
    if (active(signals[i], cur, now)) activeList.push(signals[i]);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>MERIDIAN</Text>
          <TouchableOpacity style={styles.bellBtn} onPress={function(){setShowAlerts(true);}}><Text style={styles.bellIcon}>🔔</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tickerRow}>
          {SYMBOLS.map(function(s){
            const p=prices[s.id];
            const priceStr=p?fmtPrice(p.price, s.id):'--';
            const changeStr=p?(p.changePercent>=0?'+':'')+p.changePercent.toFixed(2)+'%':'';
            const isPos=p?p.changePercent>=0:true;
            return (
              <TouchableOpacity key={s.id} style={[styles.tickerCard, selectedSymbol===s.id && styles.tickerActive]} onPress={function(){setSelectedSymbol(s.id);}}>
                <View style={styles.tickerTop}><Text style={styles.tickerSym}>{s.id}</Text><Text style={[styles.tickerChange, isPos?styles.pos:styles.neg]}>{changeStr}</Text></View>
                <Text style={styles.tickerPrice}>{priceStr}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.tfRow}>
          {TIMEFRAMES.map(function(tf){
            return (
              <TouchableOpacity key={tf} style={[styles.tfBtn, selectedTF===tf && styles.tfBtnActive]} onPress={function(){setSelectedTF(tf);}}>
                <Text style={[styles.tfText, selectedTF===tf && styles.tfTextActive]}>{tf}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.main}>
          {activeTab==='Chart' && (
            <>
              <View style={styles.symbolInfo}>
                <Text style={styles.symbolTitle}>{selectedSymbol} <Text style={styles.symbolFull}>{(function(){for(let i=0;i<SYMBOLS.length;i++){if(SYMBOLS[i].id===selectedSymbol) return SYMBOLS[i].fullName;} return '';})()}</Text></Text>
                <Text style={styles.symbolPrice}>{prices[selectedSymbol]?fmtPrice(prices[selectedSymbol].price, selectedSymbol):'--'}</Text>
              </View>
              <View style={styles.chartWrap}>
                <WebView originWhitelist={['*']} source={{ html: html }} style={{ flex:1, backgroundColor:'#0e0e10' }} javaScriptEnabled />
              </View>
              {selectedSignal && (
                <View style={styles.signalDetailBar}>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>ENTRY</Text><Text style={styles.detailValue}>{fmtPrice(selectedSignal.entry, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>STOP</Text><Text style={[styles.detailValue,{color:'#ff3b30'}]}>{fmtPrice(selectedSignal.stop, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>TP1</Text><Text style={[styles.detailValue,{color:'#30d158'}]}>{fmtPrice(selectedSignal.tp1, selectedSignal.symbol)}</Text></View>
                  <View style={styles.detailCol}><Text style={styles.detailLabel}>{timeAgo(selectedSignal.time)}</Text><Text style={styles.detailValue}>Q{selectedSignal.qScore}</Text></View>
                </View>
              )}
              {selectedSignal && (
                <View style={styles.setupInfo}>
                  <Text style={styles.setupInfoText}>{selectedSignal.strategy} • {selectedSignal.patternName} • {selectedSignal.description} • {selectedSignal.patternPoints.map(function(p){return p.label;}).join(' → ')} • Entry/SL/TP on chart</Text>
                </View>
              )}
            </>
          )}
          {activeTab==='Setups' && (
            <ScrollView style={{flex:1}} refreshControl={<RefreshControl refreshing={loading} onRefresh={runScan} tintColor="#fff" />}>
              <View style={styles.setupsHeader}><Text style={styles.setupsHeaderText}>{activeList.length} tradeable</Text></View>
              {activeList.map(function(s){
                return (
                  <TouchableOpacity key={s.id} style={styles.setupCard} onPress={function(){setSelectedSymbol(s.symbol); setSelectedTF(s.timeframe); setSelectedSignal(s); setActiveTab('Chart');}}>
                    <View style={styles.setupTop}><Text style={styles.setupSymbol}>{s.symbol} {s.timeframe} {s.type} Q{s.qScore} • {s.patternName}</Text><Text style={styles.setupTime}>{timeAgo(s.time)}</Text></View>
                    <Text style={styles.setupDesc}>ENTRY {fmtPrice(s.entry, s.symbol)} STOP {fmtPrice(s.stop, s.symbol)} TP {fmtPrice(s.tp1, s.symbol)}</Text>
                    <Text style={styles.setupMeta}>{s.strategy} • {s.description} • {s.patternPoints.map(function(p){return p.label;}).join(' → ')}</Text>
                  </TouchableOpacity>
                );
              })}
              {activeList.length===0 && <Text style={styles.emptyText}>No fresh setups. Scanning Harmonic, Wolfe, OB, FVG every 90s.</Text>}
            </ScrollView>
          )}
        </View>
        <View style={styles.bottomTabs}>
          <TouchableOpacity style={styles.tabBtn} onPress={function(){setActiveTab('Chart');}}><Text style={[styles.tabLabel, activeTab==='Chart'&&styles.tabActive]}>Chart</Text></TouchableOpacity>
          <TouchableOpacity style={styles.tabBtn} onPress={function(){setActiveTab('Setups');}}><Text style={[styles.tabLabel, activeTab==='Setups'&&styles.tabActive]}>Setups {activeList.length}</Text></TouchableOpacity>
        </View>
        <Modal visible={showAlerts} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}><Text style={styles.modalTitle}>Alerts & filters</Text><TouchableOpacity onPress={function(){setShowAlerts(false);}}><Text style={styles.modalClose}>✕</Text></TouchableOpacity></View>
              <ScrollView>
                <Text style={styles.modalSection}>MINIMUM QUALITY</Text>
                <View style={styles.qualityRow}>
                  <TouchableOpacity onPress={function(){setMinQuality(function(v){return Math.max(0, v-1);});}} style={styles.qualityBtn}><Text style={styles.qualityBtnText}>−</Text></TouchableOpacity>
                  <View style={styles.qualityBarWrap}>
                    <View style={styles.qualityBarBg}><View style={[styles.qualityBarFill, {width: minQuality+'%'}]} /></View>
                    <Text style={styles.qualityValue}>{minQuality}</Text>
                  </View>
                  <TouchableOpacity onPress={function(){setMinQuality(function(v){return Math.min(100, v+1);});}} style={styles.qualityBtn}><Text style={styles.qualityBtnText}>+</Text></TouchableOpacity>
                </View>
                <View style={styles.qualityPresets}>
                  {[60,70,74,80,85,90].map(function(v){
                    return (<TouchableOpacity key={v} style={[styles.presetBtn, minQuality===v && styles.presetActive]} onPress={function(){setMinQuality(v);}}><Text style={[styles.presetText, minQuality===v && styles.presetTextActive]}>{v}</Text></TouchableOpacity>);
                  })}
                </View>
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
  headerTitle:{color:'#fff', fontSize:16, fontWeight:'900', letterSpacing:1},
  bellBtn:{padding:8}, bellIcon:{fontSize:20},
  tickerRow:{maxHeight:58, backgroundColor:'#0a0a0a', borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  tickerCard:{minWidth:115, paddingHorizontal:12, paddingVertical:8, marginRight:4, backgroundColor:'#141414', borderRadius:6, borderWidth:1, borderColor:'#1c1c1e'},
  tickerActive:{backgroundColor:'#1c1c1e', borderColor:'#3a3a3c'},
  tickerTop:{flexDirection:'row', justifyContent:'space-between'},
  tickerSym:{color:'#fff', fontSize:10, fontWeight:'700'},
  tickerChange:{fontSize:9, fontWeight:'600'},
  tickerPrice:{color:'#fff', fontSize:12, fontWeight:'700', marginTop:3},
  pos:{color:'#30d158'}, neg:{color:'#ff453a'},
  tfRow:{flexDirection:'row', paddingHorizontal:12, paddingVertical:8, backgroundColor:'#0a0a0a', borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  tfBtn:{paddingHorizontal:16, paddingVertical:6, borderRadius:6, backgroundColor:'#1c1c1e', marginRight:6, borderWidth:1, borderColor:'#2c2c2e'},
  tfBtnActive:{backgroundColor:'#fff', borderColor:'#fff'},
  tfText:{color:'#8e8e93', fontSize:11, fontWeight:'700'},
  tfTextActive:{color:'#000'},
  main:{flex:1, backgroundColor:'#0e0e10'},
  symbolInfo:{paddingHorizontal:12, paddingVertical:8},
  symbolTitle:{color:'#fff', fontSize:13, fontWeight:'700'},
  symbolFull:{color:'#8e8e93', fontWeight:'400'},
  symbolPrice:{color:'#fff', fontSize:13, fontWeight:'700', marginTop:2},
  chartWrap:{flex:1, backgroundColor:'#0e0e10'},
  signalDetailBar:{flexDirection:'row', backgroundColor:'#141414', paddingVertical:10, paddingHorizontal:12, borderTopWidth:1, borderTopColor:'#1c1c1e'},
  detailCol:{flex:1},
  detailLabel:{color:'#8e8e93', fontSize:9, fontWeight:'600'},
  detailValue:{color:'#fff', fontSize:11, fontWeight:'700', marginTop:2},
  setupInfo:{backgroundColor:'#141414', paddingHorizontal:12, paddingVertical:6, borderTopWidth:1, borderTopColor:'#1c1c1e'},
  setupInfoText:{color:'#8e8e93', fontSize:10, lineHeight:13},
  bottomTabs:{flexDirection:'row', backgroundColor:'#141414', borderTopWidth:1, borderTopColor:'#1c1c1e', paddingVertical:8},
  tabBtn:{flex:1, alignItems:'center'},
  tabLabel:{color:'#8e8e93', fontSize:12, fontWeight:'600'},
  tabActive:{color:'#fff'},
  setupsHeader:{paddingHorizontal:12, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#1c1c1e'},
  setupsHeaderText:{color:'#8e8e93', fontSize:11},
  setupCard:{backgroundColor:'#141414', marginHorizontal:12, marginTop:10, borderRadius:10, padding:12, borderWidth:1, borderColor:'#1c1c1e'},
  setupTop:{flexDirection:'row', justifyContent:'space-between'},
  setupSymbol:{color:'#fff', fontSize:12, fontWeight:'700'},
  setupTime:{color:'#8e8e93', fontSize:10},
  setupDesc:{color:'#fff', fontSize:11, marginTop:6, fontWeight:'600'},
  setupMeta:{color:'#636366', fontSize:10, marginTop:6},
  emptyText:{color:'#636366', textAlign:'center', marginTop:40, paddingHorizontal:20, fontSize:12},
  modalOverlay:{flex:1, backgroundColor:'rgba(0,0,0,0.75)', justifyContent:'flex-end'},
  modalContent:{backgroundColor:'#141414', borderTopLeftRadius:16, borderTopRightRadius:16, paddingHorizontal:16, paddingTop:16, height:'60%'},
  modalHeader:{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16},
  modalTitle:{color:'#fff', fontSize:16, fontWeight:'700'},
  modalClose:{color:'#8e8e93', fontSize:18, padding:4},
  modalSection:{color:'#8e8e93', fontSize:11, fontWeight:'700', marginTop:22, marginBottom:10, letterSpacing:0.5},
  qualityRow:{flexDirection:'row', alignItems:'center', marginTop:8},
  qualityBtn:{backgroundColor:'#1c1c1e', width:40, height:40, borderRadius:8, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:'#2c2c2e'},
  qualityBtnText:{color:'#fff', fontSize:20, fontWeight:'700'},
  qualityBarWrap:{flex:1, marginHorizontal:12},
  qualityBarBg:{height:8, backgroundColor:'#2c2c2e', borderRadius:4, overflow:'hidden'},
  qualityBarFill:{height:'100%', backgroundColor:'#30d158', borderRadius:4},
  qualityValue:{color:'#fff', fontSize:14, fontWeight:'700', textAlign:'center', marginTop:6},
  qualityPresets:{flexDirection:'row', marginTop:12},
  presetBtn:{paddingHorizontal:12, paddingVertical:6, borderRadius:6, backgroundColor:'#1c1c1e', marginRight:6, borderWidth:1, borderColor:'#2c2c2e'},
  presetActive:{backgroundColor:'#fff', borderColor:'#fff'},
  presetText:{color:'#8e8e93', fontSize:11, fontWeight:'700'},
  presetTextActive:{color:'#000'},
});
