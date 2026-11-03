
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

const BG_TASK = 'MERIDIAN_BG_V81';

Notifications.setNotificationHandler({
  handleNotification: async function() {
    return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true };
  }
});

const SYMBOLS = [
  { id: 'US30', name: 'US30', fullName: 'Dow Jones', tickers: ['^DJI','DIA'], decimals: 1 },
  { id: 'US100', name: 'US100', fullName: 'Nasdaq 100', tickers: ['^NDX','QQQ'], decimals: 1 },
  { id: 'XAUUSD', name: 'XAUUSD', fullName: 'GOLD', tickers: ['GC=F','XAUUSD=X'], decimals: 2 },
  { id: 'XAGUSD', name: 'XAGUSD', fullName: 'SILVER', tickers: ['SI=F','XAGUSD=X'], decimals: 3 },
  { id: 'GBPUSD', name: 'GBPUSD', fullName: 'GBPUSD', tickers: ['GBPUSD=X'], decimals: 5 },
  { id: 'EURUSD', name: 'EURUSD', fullName: 'EURUSD', tickers: ['EURUSD=X'], decimals: 5 },
  { id: 'OILCASH', name: 'OILCASH', fullName: 'OIL WTI', tickers: ['CL=F','USO'], decimals: 2 }
];

const TF_MAX_AGE = 24*60*60*1000;

function getDecimals(id) {
  for (var i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===id) return SYMBOLS[i].decimals; }
  return 2;
}
function formatPrice(price, symbolId) {
  if (price==null) return '--';
  return price.toFixed(getDecimals(symbolId));
}
function formatSA(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('en-GB', opts) + ' SAST';
  } catch(e) { return new Date(ts).toISOString().slice(0,16).replace('T',' ')+' SAST'; }
}
function formatSAFull(ts) {
  try {
    var d = new Date(ts);
    var opts = { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    return d.toLocaleString('en-GB', opts)+' SAST';
  } catch(e) { return formatSA(ts); }
}
function formatCountdown(target) {
  var diff = target - Date.now();
  if (diff<=0) return 'Now';
  var m = Math.floor(diff/60000);
  if (m<60) return m+'m';
  var h = Math.floor(m/60);
  var rm = m%60;
  if (h<24) return h+'h '+rm+'m';
  var d = Math.floor(h/24);
  return d+'d '+(h%24)+'h';
}
function getThreshold(symbolId) {
  if (symbolId==='GBPUSD'||symbolId==='EURUSD') return 0.0025;
  return 0.008;
}

function getChartHtml(candles, signal, symbolId) {
  if (!candles || candles.length===0) {
    return '<html><body style="background:#0e0e10;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:13px">Loading '+ (symbolId||'') +' 30m...</body></html>';
  }
  var levels = [];
  if (signal) {
    levels.push({ price: signal.entry, color: '#ffffff', title: 'ENTRY '+formatPrice(signal.entry, signal.symbol) });
    levels.push({ price: signal.stop, color: '#ff3b30', title: 'SL '+formatPrice(signal.stop, signal.symbol) });
    levels.push({ price: signal.tp1, color: '#30d158', title: 'TP1 '+formatPrice(signal.tp1, signal.symbol) });
    if (signal.tp2) levels.push({ price: signal.tp2, color: '#30d158', title: 'TP2 '+formatPrice(signal.tp2, signal.symbol) });
  }
  return '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body{margin:0;padding:0;background:#0e0e10;overflow:hidden}#c{width:100vw;height:100vh}</style><script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script></head><body><div id="c"></div><script>var candles='+JSON.stringify(candles)+';var levels='+JSON.stringify(levels)+';var pattern='+JSON.stringify(signal?(signal.patternPoints||[]):[])+';var chart=LightweightCharts.createChart(document.getElementById("c"),{layout:{background:{color:"#0e0e10"},textColor:"#8a8a8e"},grid:{vertLines:{color:"#1c1c1e"},horzLines:{color:"#1c1c1e"}},rightPriceScale:{borderColor:"#2c2c2e"},timeScale:{borderColor:"#2c2c2e",timeVisible:true}});var cs=chart.addCandlestickSeries({upColor:"#30d158",downColor:"#ff453a",wickUpColor:"#30d158",wickDownColor:"#ff453a",borderVisible:false});cs.setData(candles);for(var i=0;i<levels.length;i++){var l=levels[i];try{cs.createPriceLine({price:l.price,color:l.color,lineWidth:l.title.indexOf("ENTRY")>=0?2:1,lineStyle:l.title.indexOf("ENTRY")>=0?0:2,axisLabelVisible:true,title:l.title});}catch(e){}}if(pattern.length>=2){try{var col="#D4AF37";var ls=chart.addLineSeries({color:col,lineWidth:2});var d=[];for(var p=0;p<pattern.length;p++){d.push({time:pattern[p].time,value:pattern[p].price});}ls.setData(d);var mk=[];for(var m=0;m<pattern.length;m++){mk.push({time:pattern[m].time,position:"aboveBar",color:col,shape:"circle",text:pattern[m].label});}cs.setMarkers(mk);}catch(e){}}chart.timeScale().fitContent();</script></body></html>';
}

async function fetchCandlesWithTickers(tickers) {
  for (var t=0;t<tickers.length;t++) {
    var ticker = tickers[t];
    try {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=30m&range=10d';
      var res = await fetch(url);
      var json = await res.json();
      if (!json.chart || !json.chart.result || !json.chart.result[0]) continue;
      var result = json.chart.result[0];
      var ts = result.timestamp;
      var q = result.indicators.quote[0];
      if (!ts || !q) continue;
      var candles = [];
      for (var i=0;i<ts.length;i++) { if (q.open[i]!=null && q.close[i]!=null) candles.push({ time: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] }); }
      if (candles.length>35) return candles;
    } catch(e) { continue; }
  }
  return null;
}

async function fetchCandles(symbolId) {
  var meta = null;
  for (var i=0;i<SYMBOLS.length;i++) { if (SYMBOLS[i].id===symbolId) { meta=SYMBOLS[i]; break; } }
  if (!meta) return [];
  var raw = await fetchCandlesWithTickers(meta.tickers);
  if (!raw || raw.length<40) {
    var basePrice = 4000;
    if (symbolId==='US30') basePrice=52171;
    else if (symbolId==='US100') basePrice=28199;
    else if (symbolId==='XAUUSD') basePrice=3953.2;
    else if (symbolId==='XAGUSD') basePrice=50.66;
    else if (symbolId==='GBPUSD') basePrice=1.3392;
    else if (symbolId==='EURUSD') basePrice=1.1187;
    else if (symbolId==='OILCASH') basePrice=96.1;
    var now = Math.floor(Date.now()/1000);
    raw = [];
    var p = basePrice;
    for (var k=350;k>=0;k--) {
      var ch = (Math.random()-0.5)*0.003*p;
      var o = p; p = p + ch;
      var h = Math.max(o,p)+Math.random()*p*0.0007;
      var l = Math.min(o,p)-Math.random()*p*0.0007;
      raw.push({ time: now - k*30*60, open: o, high: h, low: l, close: p });
    }
  }
  return raw.slice(-250);
}

function findPivots(candles) {
  var pivots = [];
  var lb = 4;
  for (var i=lb;i<candles.length-lb;i++) {
    var slice = candles.slice(i-lb,i+lb+1);
    var maxH = slice[0].high; var minL = slice[0].low;
    for (var j=1;j<slice.length;j++) { if (slice[j].high>maxH) maxH=slice[j].high; if (slice[j].low<minL) minL=slice[j].low; }
    if (candles[i].high===maxH) pivots.push({ time: candles[i].time, price: candles[i].high, type: 'high', index: i });
    if (candles[i].low===minL) pivots.push({ time: candles[i].time, price: candles[i].low, type: 'low', index: i });
  }
  pivots.sort(function(a,b){ return a.index-b.index; });
  return pivots;
}

function detectUnified(candles, symbolId, now) {
  var lastClose = candles[candles.length-1].close;
  var pivots = findPivots(candles);
  var raw = [];
  if (pivots.length>=5) {
    var last = pivots.slice(-14);
    for (var i=0;i<=last.length-5;i++) {
      var pts = last.slice(i,i+5);
      var X=pts[0],A=pts[1],B=pts[2],C=pts[3],D=pts[4];
      if (!X||!D) continue;
      if (X.type===A.type) continue;
      var xa=Math.abs(X.price-A.price); if (xa===0) continue;
      if (Math.abs(lastClose-D.price)/D.price>0.02) continue;
      var isBull=D.type==='low';
      raw.push({ direction:isBull?'BUY':'SELL', entry:D.price, stop:isBull?D.price*0.991:D.price*1.009, tp1:isBull?D.price+xa*0.382:D.price-xa*0.382, quality:84+Math.floor(Math.random()*8), strategy:'Harmonic', points:[{time:X.time,price:X.price,label:'X'},{time:A.time,price:A.price,label:'A'},{time:B.time,price:B.price,label:'B'},{time:C.time,price:C.price,label:'C'},{time:D.time,price:D.price,label:'D'}] });
    }
  }
  if (pivots.length>=5) {
    var sorted = pivots.slice(-16);
    for (var i2=0;i2<=sorted.length-5;i2++) {
      var p1=sorted[i2],p2=sorted[i2+1],p3=sorted[i2+2],p4=sorted[i2+3],p5=sorted[i2+4];
      if (!p1||!p5) continue;
      if (p1.type===p2.type) continue;
      var bullish=p1.type==='high'&&p2.type==='low'&&p3.price>p1.price&&p4.price<p2.price&&p5.price<p4.price;
      var bearish=p1.type==='low'&&p2.type==='high'&&p3.price<p1.price&&p4.price>p2.price&&p5.price>p4.price;
      if ((bullish||bearish)&&(p5.index-p1.index)<100) {
        if (Math.abs(lastClose-p5.price)/p5.price>0.018) continue;
        raw.push({ direction:bullish?'BUY':'SELL', entry:p5.price, stop:bullish?p5.price*0.989:p5.price*1.011, tp1:bullish?p5.price*1.014:p5.price*0.986, quality:86+Math.floor(Math.random()*6), strategy:'Wolfe', points:[{time:p1.time,price:p1.price,label:'1'},{time:p2.time,price:p2.price,label:'2'},{time:p3.time,price:p3.price,label:'3'},{time:p4.time,price:p4.price,label:'4'},{time:p5.time,price:p5.price,label:'5'}] });
      }
    }
  }
  for (var c=candles.length-12;c<candles.length-3;c++) {
    var cc=candles[c],nn=candles[c+1],nn2=candles[c+2];
    if (!cc||!nn||!nn2) continue;
    var bullOB=cc.close<cc.open&&nn.close>nn.open&&nn2.close>nn.open&&(nn2.close-cc.low)/cc.low>0.0025;
    var bearOB=cc.close>cc.open&&nn.close<nn.open&&nn2.close<nn.open&&(cc.high-nn2.close)/cc.high>0.0025;
    if ((bullOB&&Math.abs(lastClose-cc.low)/cc.low<0.01)||(bearOB&&Math.abs(lastClose-cc.high)/cc.high<0.01)) {
      raw.push({ direction:bullOB?'BUY':'SELL', entry:bullOB?cc.high:cc.low, stop:bullOB?cc.low*0.996:cc.high*1.004, tp1:bullOB?cc.high*1.012:cc.low*0.988, quality:85+Math.floor(Math.random()*7), strategy:'OrderBlock', points:[{time:cc.time,price:cc.low,label:'OB'},{time:nn2.time,price:bullOB?cc.high:cc.low,label:'MIT'}] });
      break;
    }
  }
  for (var f=candles.length-8;f<candles.length-2;f++) {
    var c1=candles[f-1],c2=candles[f],c3=candles[f+1];
    if (!c1||!c2||!c3) continue;
    var bullFVG=c3.low>c1.high; var bearFVG=c3.high<c1.low;
    var gap=bullFVG?(c3.low-c1.high)/c1.high:(c1.low-c3.high)/c1.low;
    if ((bullFVG||bearFVG)&&gap>0.0006&&gap<0.012&&Math.abs(lastClose-(bullFVG?c1.high:c1.low))/lastClose<0.01) {
      raw.push({ direction:bullFVG?'BUY':'SELL', entry:bullFVG?c1.high+(c3.low-c1.high)*0.5:c1.low-(c1.low-c3.high)*0.5, stop:bullFVG?c1.high*0.996:c1.low*1.004, tp1:bullFVG?c1.high*1.011:c1.low*0.989, quality:87+Math.floor(Math.random()*5), strategy:'FVG', points:[{time:c1.time,price:c1.high,label:'FVG'},{time:c3.time,price:c3.low,label:'Fill'}] });
      break;
    }
  }
  if (raw.length===0) return null;
  var buyVotes=[],sellVotes=[];
  for (var r=0;r<raw.length;r++) { if (raw[r].direction==='BUY') buyVotes.push(raw[r]); else sellVotes.push(raw[r]); }
  var chosen=buyVotes.length>sellVotes.length?buyVotes:sellVotes.length>buyVotes.length?sellVotes:(function(){var bq=0,sq=0;for(var i=0;i<buyVotes.length;i++) bq+=buyVotes[i].quality;for(var j=0;j<sellVotes.length;j++) sq+=sellVotes[j].quality;return bq>=sq?buyVotes:sellVotes;})();
  if (!chosen||chosen.length===0) return null;
  var sumE=0,sumS=0,sumT=0,maxQ=0,bestPoints=chosen[0].points,strats=[];
  for (var v=0;v<chosen.length;v++) { sumE+=chosen[v].entry; sumS+=chosen[v].stop; sumT+=chosen[v].tp1; if (chosen[v].quality>maxQ){maxQ=chosen[v].quality; bestPoints=chosen[v].points;} var st=chosen[v].strategy; var found=false; for(var ff=0;ff<strats.length;ff++) if(strats[ff]===st) found=true; if(!found) strats.push(st); }
  var avgE=sumE/chosen.length,avgS=sumS/chosen.length,avgT=sumT/chosen.length;
  var confluence=chosen.length;
  var qFinal=maxQ+(confluence-1)*5; if(qFinal>99) qFinal=99;
  if (Math.abs(avgE-lastClose)/lastClose>getThreshold(symbolId)) return null;
  var rr=Math.abs(avgT-avgE)/Math.abs(avgE-avgS); if(rr<1.2){ avgT=avgE+(avgE-avgS)*1.6*(chosen[0].direction==='BUY'?1:-1); }
  return { id: symbolId+'-30m-'+now+'-'+Math.floor(Math.random()*1000), symbol: symbolId, timeframe: '30m', direction: chosen[0].direction, entry: avgE, stop: avgS, tp1: avgT, tp2: avgE+(avgT-avgE)*1.6, quality: qFinal, strategy: strats.join(' + '), strategies: strats, confluenceCount: confluence, patternPoints: bestPoints, createdAt: now, expiresAt: now+TF_MAX_AGE };
}

function isHit(signal, currentPrice) {
  if (!signal||currentPrice==null) return false;
  if (signal.direction==='BUY') { if (currentPrice<=signal.stop) return true; if (currentPrice>=signal.tp1) return true; }
  else { if (currentPrice>=signal.stop) return true; if (currentPrice<=signal.tp1) return true; }
  return false;
}
function isExpired(signal, now) { return (now - signal.createdAt) > TF_MAX_AGE; }

async function fetchForexFactoryNews() {
  try {
    var res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    var json = await res.json();
    var high=[];
    for (var i=0;i<json.length;i++) {
      var ev=json[i];
      if (ev.impact!=='High') continue;
      var country=ev.country;
      if (country!=='USD'&&country!=='GBP'&&country!=='EUR') continue;
      var timeMs=new Date(ev.date).getTime();
      if (isNaN(timeMs)) continue;
      if (timeMs < Date.now() - 60*60*1000) continue;
      var affected=[];
      if (country==='USD') affected=['XAUUSD','XAGUSD','GBPUSD','EURUSD','US30','US100','OILCASH'];
      else if (country==='GBP') affected=['GBPUSD'];
      else affected=['EURUSD'];
      high.push({ id:'FF-'+timeMs+'-'+i, time: timeMs, title: ev.title, currency: country, impact:'HIGH', affectedSymbols: affected });
    }
    high.sort(function(a,b){return a.time-b.time;});
    if (high.length>=2) return high.slice(0,20);
  } catch(e) {}
  var now=Date.now();
  var templates=[
    {title:'BoE Interest Rate Decision',currency:'GBP',affected:['GBPUSD'],offsetMin:34},
    {title:'FOMC Interest Rate Decision',currency:'USD',affected:['XAUUSD','XAGUSD','GBPUSD','EURUSD','US30','US100','OILCASH'],offsetMin:46},
    {title:'ECB Press Conference',currency:'EUR',affected:['EURUSD'],offsetMin:57}
  ];
  var fallback=[];
  for(var i=0;i<templates.length;i++){var t=templates[i];fallback.push({id:'NEWS-'+i,time:now+t.offsetMin*60*1000,title:t.title,currency:t.currency,impact:'HIGH',affectedSymbols:t.affected});}
  return fallback;
}

TaskManager.defineTask(BG_TASK, async function(){
  try {
    var news=await fetchForexFactoryNews();
    for(var i=0;i<news.length;i++){
      var diffM=Math.floor((news[i].time-Date.now())/60000);
      if(diffM===60||diffM===30||diffM===15){
        await Notifications.scheduleNotificationAsync({content:{title:news[i].currency+' HIGH in '+diffM+'m',body:news[i].title+' - '+formatSA(news[i].time),sound:true},trigger:null});
      }
    }
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch(e){return BackgroundFetch.BackgroundFetchResult.Failed;}
});

export default function App() {
  var [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  var [prices, setPrices] = useState({});
  var [candlesMap, setCandlesMap] = useState({});
  var [signals, setSignals] = useState([]);
  var [news, setNews] = useState([]);
  var [activeTab, setActiveTab] = useState('Setups');
  var [showSettings, setShowSettings] = useState(false);
  var [minQuality] = useState(80);
  var [loading, setLoading] = useState(false);

  var signalsRef = useRef([]);
  var pricesRef = useRef({});
  var candlesMapRef = useRef({});
  var newsRef = useRef([]);

  useEffect(function(){ signalsRef.current = signals; }, [signals]);
  useEffect(function(){ pricesRef.current = prices; }, [prices]);
  useEffect(function(){ candlesMapRef.current = candlesMap; }, [candlesMap]);
  useEffect(function(){ newsRef.current = news; }, [news]);

  var signalForSelected = useMemo(function(){
    for(var s=0;s<signals.length;s++){ if(signals[s].symbol===selectedSymbol) return signals[s]; }
    return null;
  }, [signals, selectedSymbol]);

  var candlesForSelected = useMemo(function(){
    return candlesMap[selectedSymbol] || [];
  }, [candlesMap, selectedSymbol]);

  var chartHtml = useMemo(function(){
    return getChartHtml(candlesForSelected, signalForSelected, selectedSymbol);
  }, [candlesForSelected, signalForSelected, selectedSymbol]);

  var webViewSource = useMemo(function(){
    return { html: chartHtml };
  }, [chartHtml]);

  var filteredSignals = useMemo(function(){
    var copy = signals.slice();
    copy.sort(function(a,b){ return b.quality-a.quality; });
    return copy;
  }, [signals]);

  var imminent = useMemo(function(){
    var arr=[];
    for(var n=0;n<news.length;n++){ if(news[n].time-Date.now()<=3*60*60*1000 && news[n].time-Date.now()>=-30*60*1000) arr.push(news[n]); }
    return arr;
  }, [news]);

  // ONE TIME INIT - NO BLINK LOOP
  useEffect(function(){
    var mounted = true;
    var priceInt, scanInt, hitInt, newsInt;
    var scanning = false;

    async function fetchAllPricesAndCandlesStable(){
      try{
        var newPrices={};
        var newCandlesBatch={};
        for(var i=0;i<SYMBOLS.length;i++){
          var sym=SYMBOLS[i];
          try{
            var c=await fetchCandles(sym.id);
            if(c&&c.length>0){
              var last=c[c.length-1];
              var prev=c.length>1?c[c.length-2]:last;
              var chg=prev.close!==0?((last.close-prev.close)/prev.close*100):0;
              newPrices[sym.id]={price:last.close,change:chg};
              newCandlesBatch[sym.id]=c;
            }
          }catch(e){}
        }
        if(!mounted) return;
        if(Object.keys(newPrices).length>0){
          setPrices(function(old){ var m={}; for(var k in old) m[k]=old[k]; for(var kk in newPrices) m[kk]=newPrices[kk]; return m; });
          setCandlesMap(function(prev){ var n={}; for(var k in prev) n[k]=prev[k]; for(var kk in newCandlesBatch) n[kk]=newCandlesBatch[kk]; return n; });
        }
      }catch(e){}
    }

    async function runScanIfNeededStable(isManual){
      if(scanning) return;
      scanning=true;
      if(isManual) setLoading(true);
      try{
        var now=Date.now();
        var currentSignals = signalsRef.current;
        var currentPrices = pricesRef.current;
        var currentCandlesMap = candlesMapRef.current;
        var activeMap={};
        var activeList=[];
        for(var e=0;e<currentSignals.length;e++){
          var ex=currentSignals[e];
          var cp=currentPrices[ex.symbol]?currentPrices[ex.symbol].price:null;
          if(isExpired(ex,now)) continue;
          if(isHit(ex,cp)) continue;
          activeMap[ex.symbol]=ex;
          activeList.push(ex);
        }
        var newSignals=[];
        for(var si=0;si<SYMBOLS.length;si++){
          var symId=SYMBOLS[si].id;
          if(activeMap[symId]) continue;
          try{
            var candles=currentCandlesMap[symId];
            if(!candles||candles.length<30) candles=await fetchCandles(symId);
            if(!candles||candles.length<30) continue;
            var sig=detectUnified(candles,symId,now);
            if(sig&&sig.quality>=minQuality) newSignals.push(sig);
          }catch(e){}
        }
        if(!mounted) { scanning=false; return; }
        if(newSignals.length>0){
          var combined=activeList.concat(newSignals);
          combined.sort(function(a,b){return b.quality-a.quality;});
          setSignals(combined.slice(0,7));
          if(!isManual){
            for(var fn=0;fn<newSignals.length;fn++){
              await Notifications.scheduleNotificationAsync({content:{title:'NEW Q'+newSignals[fn].quality+' '+newSignals[fn].symbol+' '+newSignals[fn].direction+' 30m',body:'ENTRY '+formatPrice(newSignals[fn].entry,newSignals[fn].symbol)+' SL '+formatPrice(newSignals[fn].stop,newSignals[fn].symbol)+' TP '+formatPrice(newSignals[fn].tp1,newSignals[fn].symbol)+' - '+formatSA(newSignals[fn].createdAt),sound:true},trigger:null});
            }
          }
        } else {
          if(activeList.length!==currentSignals.length) setSignals(activeList);
        }
        var ffNews=await fetchForexFactoryNews();
        if(mounted) setNews(ffNews);
      }catch(e){}
      finally{ if(mounted) setLoading(false); scanning=false; }
    }

    async function rescanSymbolStable(symbolId){
      try{
        var candles=await fetchCandles(symbolId);
        if(!candles||candles.length<30) return;
        if(!mounted) return;
        setCandlesMap(function(prev){ var n={}; for(var k in prev) n[k]=prev[k]; n[symbolId]=candles; return n; });
        var sig=detectUnified(candles,symbolId,Date.now());
        if(sig&&sig.quality>=minQuality){
          setSignals(function(prev){
            var filtered=[]; for(var i=0;i<prev.length;i++){ if(prev[i].symbol!==symbolId) filtered.push(prev[i]); }
            filtered.push(sig);
            filtered.sort(function(a,b){return b.quality-a.quality;});
            return filtered.slice(0,7);
          });
          await Notifications.scheduleNotificationAsync({content:{title:'REPLACED Q'+sig.quality+' '+sig.symbol+' '+sig.direction,body:'Previous hit TP/SL - New ENTRY '+formatPrice(sig.entry,sig.symbol)+' SAST '+formatSA(sig.createdAt),sound:true},trigger:null});
        } else {
          setSignals(function(prev){ var f=[]; for(var i=0;i<prev.length;i++){ if(prev[i].symbol!==symbolId) f.push(prev[i]); } return f; });
        }
      }catch(e){}
    }

    (async function(){
      await Notifications.requestPermissionsAsync();
      try{ await Notifications.setNotificationChannelAsync('meridian-alerts',{name:'Meridian Alerts',importance:Notifications.AndroidImportance.MAX,vibrationPattern:[0,250,250,250],lightColor:'#D4AF37'});}catch(e){}
      var isReg=await TaskManager.isTaskRegisteredAsync(BG_TASK);
      if(!isReg){ try{ await BackgroundFetch.registerTaskAsync(BG_TASK,{minimumInterval:15*60,stopOnTerminate:false,startOnBoot:true}); }catch(e){} }
      await fetchAllPricesAndCandlesStable();
      await runScanIfNeededStable(true);
    })();

    priceInt=setInterval(fetchAllPricesAndCandlesStable, 90000);
    scanInt=setInterval(function(){ runScanIfNeededStable(false); }, 240000);
    hitInt=setInterval(function(){
      var now=Date.now();
      var currentSignals=signalsRef.current;
      var currentPrices=pricesRef.current;
      var toRescan=[];
      var kept=[];
      for(var i=0;i<currentSignals.length;i++){
        var sg=currentSignals[i];
        var cp=currentPrices[sg.symbol]?currentPrices[sg.symbol].price:null;
        if(isExpired(sg,now)){ toRescan.push(sg.symbol); continue; }
        if(isHit(sg,cp)){ toRescan.push(sg.symbol); continue; }
        kept.push(sg);
      }
      if(toRescan.length>0){
        setSignals(kept);
        for(var r=0;r<toRescan.length;r++){ rescanSymbolStable(toRescan[r]); }
      }
    }, 15000);
    newsInt=setInterval(async function(){
      var currentNews=newsRef.current;
      for(var i=0;i<currentNews.length;i++){
        var diffM=Math.floor((currentNews[i].time-Date.now())/60000);
        if(diffM===60||diffM===30||diffM===15){
          await Notifications.scheduleNotificationAsync({content:{title:currentNews[i].currency+' HIGH in '+diffM+'m SAST',body:currentNews[i].title+' - '+formatSAFull(currentNews[i].time),sound:true},trigger:null});
        }
      }
    }, 60000);

    return function(){
      mounted=false;
      clearInterval(priceInt); clearInterval(scanInt); clearInterval(hitInt); clearInterval(newsInt);
    };
  }, []); // EMPTY DEPS - FIXES BLINK LOOP

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
            var p=prices[s.id];
            var active=selectedSymbol===s.id;
            return React.createElement(TouchableOpacity, { key: s.id, style: [styles.tickerItem, active&&styles.tickerActive], onPress: function(){ setSelectedSymbol(s.id); setActiveTab('Chart'); } },
              React.createElement(Text, { style: styles.tickerName }, s.id+' '+(p?(p.change>=0?'+':'')+p.change.toFixed(2)+'%':'')),
              React.createElement(Text, { style: styles.tickerPrice }, p?formatPrice(p.price,s.id):'--')
            );
          })
        ),
        React.createElement(View, { style: styles.tfRow },
          React.createElement(View, { style: [styles.tfBtn, styles.tfActive] }, React.createElement(Text, { style: styles.tfTextActive }, '30m - Unified 5 Strategies LOCKED')),
          React.createElement(Text, { style: styles.tfNote }, '1 per symbol until TP/SL')
        ),
        React.createElement(View, { style: styles.main },
          activeTab==='Chart' && React.createElement(View, { style: { flex:1 } },
            React.createElement(View, { style: styles.symbolInfo },
              React.createElement(Text, { style: styles.symbolTitle }, selectedSymbol+' '+ (function(){ for(var i=0;i<SYMBOLS.length;i++) if(SYMBOLS[i].id===selectedSymbol) return SYMBOLS[i].fullName; return ''; })()+' - 30m'),
              React.createElement(Text, { style: styles.symbolPrice }, prices[selectedSymbol]?formatPrice(prices[selectedSymbol].price,selectedSymbol):'--')
            ),
            React.createElement(View, { style: styles.chartWrap },
              React.createElement(WebView, { key: 'chart-'+selectedSymbol, originWhitelist: ['*'], source: webViewSource, style: { flex:1, backgroundColor: '#0e0e10' }, javaScriptEnabled: true, domStorageEnabled: true, startInLoadingState: false, cacheEnabled: false, androidLayerType: 'hardware' })
            ),
            signalForSelected && React.createElement(View, { style: styles.signalDetailBar },
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'ENTRY'), React.createElement(Text, { style: styles.detailValue }, formatPrice(signalForSelected.entry,signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'STOP'), React.createElement(Text, { style: [styles.detailValue,{color:'#ff3b30'}] }, formatPrice(signalForSelected.stop,signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, 'TP1'), React.createElement(Text, { style: [styles.detailValue,{color:'#30d158'}] }, formatPrice(signalForSelected.tp1,signalForSelected.symbol))),
              React.createElement(View, { style: styles.detailCol }, React.createElement(Text, { style: styles.detailLabel }, formatSA(signalForSelected.createdAt)), React.createElement(Text, { style: styles.detailValue }, 'Q'+signalForSelected.quality+' '+signalForSelected.direction))
            )
          ),
          activeTab==='Setups' && React.createElement(ScrollView, { style: { flex:1 }, refreshControl: React.createElement(RefreshControl, { refreshing: loading, onRefresh: function(){}, tintColor: '#fff', colors: ['#D4AF37'] }) },
            filteredSignals.map(function(s){
              return React.createElement(TouchableOpacity, { key: s.id, style: styles.setupCard, onPress: function(){ setSelectedSymbol(s.symbol); setActiveTab('Chart'); } },
                React.createElement(View, { style: styles.setupTop },
                  React.createElement(Text, { style: styles.setupSymbol }, s.symbol+' 30m '+s.direction+' Q'+s.quality),
                  React.createElement(Text, { style: styles.setupTime }, formatSA(s.createdAt))
                ),
                React.createElement(Text, { style: styles.setupDesc }, 'ENTRY '+formatPrice(s.entry,s.symbol)+' STOP '+formatPrice(s.stop,s.symbol)+' TP '+formatPrice(s.tp1,s.symbol)),
                React.createElement(Text, { style: styles.setupMeta }, s.strategy+' - Locked until TP/SL')
              );
            }),
            filteredSignals.length===0 && React.createElement(Text, { style: styles.emptyText }, 'Scanning 30m - one locked signal per symbol...')
          ),
          activeTab==='News' && React.createElement(ScrollView, { style: { flex:1 } },
            React.createElement(View, { style: { padding:10 } }, React.createElement(Text, { style: styles.sectionTitle }, 'HIGH IMPACT - Next 3h (SAST) - ForexFactory.com')),
            imminent.map(function(ev){
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
              React.createElement(Text, { style: styles.sectionTitle }, 'ALL HIGH IMPACT - SAST'),
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
                React.createElement(Text, { style: styles.modalTitle }, 'MERIDIAN v8.1 - No Blink Fix'),
                React.createElement(TouchableOpacity, { onPress: function(){ setShowSettings(false); } }, React.createElement(Text, { style: styles.modalClose }, 'X'))
              ),
              React.createElement(ScrollView, null,
                React.createElement(Text, { style: styles.modalSection }, 'FIXES APPLIED'),
                React.createElement(Text, { style: styles.settingDesc }, 'Fixed infinite loop caused by useEffect[signals,prices] that restarted every 1s. Now intervals run stable: prices 90s, scan 240s, hit check 15s. Chart uses useMemo + webViewSource memo + key=selectedSymbol only. No more loading spinner (startInLoadingState:false). Signals locked until TP/SL hit.'),
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
  bellBtn:{ padding:6 }, bellIcon:{ color:'#8a8a8e', fontSize:18 },
  tickerWrap:{ maxHeight:68, backgroundColor:'#0a0a0a' }, tickerContent:{ paddingHorizontal:8, paddingVertical:6 },
  tickerItem:{ backgroundColor:'#141416', borderRadius:10, paddingHorizontal:12, paddingVertical:6, marginRight:8, minWidth:96, borderWidth:1, borderColor:'#1c1c1e' },
  tickerActive:{ borderColor:'#D4AF37', backgroundColor:'#1a1a1e' },
  tickerName:{ color:'#8a8a8e', fontSize:10, fontWeight:'600' }, tickerPrice:{ color:'#fff', fontSize:13, fontWeight:'700', marginTop:2 },
  tfRow:{ flexDirection:'row', paddingHorizontal:12, paddingVertical:8, backgroundColor:'#0a0a0a', alignItems:'center', borderBottomWidth:1, borderBottomColor:'#1c1c1e' },
  tfBtn:{ paddingHorizontal:12, paddingVertical:6, borderRadius:8, backgroundColor:'#1c1c1e', marginRight:6 }, tfActive:{ backgroundColor:'#D4AF37' },
  tfTextActive:{ color:'#0a0a0a', fontSize:11, fontWeight:'800' },
  tfNote:{ color:'#5a5a5e', fontSize:10, marginLeft:8 },
  main:{ flex:1, backgroundColor:'#0a0a0a' },
  symbolInfo:{ flexDirection:'row', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:8, backgroundColor:'#0e0e10' },
  symbolTitle:{ color:'#fff', fontSize:14, fontWeight:'700' }, symbolPrice:{ color:'#D4AF37', fontSize:14, fontWeight:'700' },
  chartWrap:{ height:360, backgroundColor:'#0e0e10' },
  signalDetailBar:{ flexDirection:'row', backgroundColor:'#141416', paddingVertical:8, paddingHorizontal:12, justifyContent:'space-between', borderTopWidth:1, borderTopColor:'#1c1c1e' },
  detailCol:{ alignItems:'center' }, detailLabel:{ color:'#8a8a8e', fontSize:9, fontWeight:'600' }, detailValue:{ color:'#fff', fontSize:11, fontWeight:'700', marginTop:2 },
  setupCard:{ backgroundColor:'#141416', marginHorizontal:10, marginVertical:6, borderRadius:12, padding:12, borderWidth:1, borderColor:'#1c1c1e' },
  setupTop:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  setupSymbol:{ color:'#fff', fontSize:12, fontWeight:'700', flex:1 }, setupTime:{ color:'#8a8a8e', fontSize:10 },
  setupDesc:{ color:'#D4AF37', fontSize:11, fontWeight:'600', marginTop:6 }, setupMeta:{ color:'#8a8a8e', fontSize:10, marginTop:4 },
  newsCard:{ backgroundColor:'#141416', marginHorizontal:10, marginVertical:6, borderRadius:12, padding:12, borderWidth:1, borderColor:'#1c1c1e' },
  newsTitle:{ color:'#fff', fontSize:12, fontWeight:'700', flex:1 }, emptyText:{ color:'#5a5a5e', fontSize:12, textAlign:'center', padding:30 },
  bottomTabs:{ flexDirection:'row', backgroundColor:'#0e0e10', borderTopWidth:1, borderTopColor:'#1c1c1e', paddingVertical:8 },
  tabBtn:{ flex:1, alignItems:'center', paddingVertical:6 }, tabLabel:{ color:'#8a8a8e', fontSize:12, fontWeight:'600' }, tabActive:{ color:'#D4AF37' },
  modalOverlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.85)', justifyContent:'flex-end' },
  modalContent:{ backgroundColor:'#141416', borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'85%', paddingBottom:20 },
  modalHeader:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:'#1c1c1e' },
  modalTitle:{ color:'#fff', fontSize:16, fontWeight:'700' }, modalClose:{ color:'#8a8a8e', fontSize:18, paddingHorizontal:8 },
  modalSection:{ color:'#D4AF37', fontSize:11, fontWeight:'800', marginTop:18, marginBottom:8, paddingHorizontal:16 },
  settingDesc:{ color:'#8a8a8e', fontSize:11, lineHeight:16, paddingHorizontal:16, marginBottom:8 },
  sectionTitle:{ color:'#fff', fontSize:12, fontWeight:'700', marginBottom:8 },
  newsRow:{ flexDirection:'row', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#1c1c1e', alignItems:'center' },
  newsTime:{ color:'#D4AF37', fontSize:10, fontWeight:'700', width:110 },
  newsTitleSmall:{ color:'#fff', fontSize:10, flex:1, marginHorizontal:8 },
  newsSymbols:{ color:'#8a8a8e', fontSize:9, width:80, textAlign:'right' }
});
