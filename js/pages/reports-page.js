/* 中文備註：js/pages/reports-page.js，報表頁面邏輯，含列印報表功能。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, money, todayStr, downloadFile } from '../core/utils.js';
import { startSession, endSession, saveCurrentSnapshot, getSessionListHtml } from '../modules/report-session.js';

/* ===== 取得報表用訂單 ===== */
function getReportOrders(){
  if(state.viewReportOrders) return state.viewReportOrders;
  const from = document.getElementById('reportDateFrom')?.value || '';
  const to   = document.getElementById('reportDateTo')?.value || '';
  return state.orders.filter(o=>{
    const d = (o.createdAt || '').slice(0,10);
    return (!from || d >= from) && (!to || d <= to);
  });
}

/* ===== 計算報表資料（共用） ===== */
function calcReportData(){
  const orders = getReportOrders();
  const today  = todayStr();

  /* 營業額摘要 */
  const ordersToday = orders.filter(o=>(o.createdAt||'').slice(0,10)===today);
  const todaySales  = ordersToday.reduce((s,o)=>s+Number(o.total||0),0);
  const seven  = orders.filter(o=> Date.now()-new Date(o.createdAt).getTime()<=7*86400000).reduce((s,o)=>s+Number(o.total||0),0);
  const thirty = orders.filter(o=> Date.now()-new Date(o.createdAt).getTime()<=30*86400000).reduce((s,o)=>s+Number(o.total||0),0);
  const summary = [
    ['今日營業額', money(todaySales)],
    ['今日訂單數', ordersToday.length],
    ['近7日營業額', money(seven)],
    ['近30日營業額', money(thirty)],
  ];

  /* 熱銷商品 */
  const productMap = {};
  orders.forEach(o=>(o.items||[]).forEach(i=>{
    productMap[i.name] = (productMap[i.name]||0)+Number(i.qty||0);
  }));
  const topProducts = Object.entries(productMap).sort((a,b)=>b[1]-a[1]).slice(0,10);

  /* 付款方式統計 */
  const payMap = {};
  orders.forEach(o=>{
    const key = o.paymentMethod||'未設定';
    payMap[key] = (payMap[key]||0)+Number(o.total||0);
  });
  const paymentStats = Object.entries(payMap);

  /* 商品販賣分析 */
  const productAnalysis = {};
  orders.forEach(o=>(o.items||[]).forEach(i=>{
    const key = i.name;
    productAnalysis[key] = productAnalysis[key]||{qty:0,sales:0};
    productAnalysis[key].qty   += Number(i.qty||0);
    productAnalysis[key].sales += (Number(i.basePrice||0)+Number(i.extraPrice||0))*Number(i.qty||0);
  }));
  const pa = Object.entries(productAnalysis).sort((a,b)=>b[1].sales-a[1].sales);

  /* 時段分析 */
  const hourMap = {};
  orders.forEach(o=>{
    const h = new Date(o.createdAt).getHours();
    const key = String(h).padStart(2,'0')+':00';
    hourMap[key] = hourMap[key]||{count:0,sales:0};
    hourMap[key].count += 1;
    hourMap[key].sales += Number(o.total||0);
  });
  const ha = Object.entries(hourMap).sort((a,b)=>a[0].localeCompare(b[0]));

  return { summary, topProducts, paymentStats, pa, ha };
}

/* ===== 畫面渲染 ===== */
export function renderReports(){
  const { summary, topProducts, paymentStats, pa, ha } = calcReportData();

  /* 營業額卡片 */
  const cards = document.getElementById('reportCards');
  if(cards){
    cards.innerHTML = summary.map(([l,v])=>`<div class="stat-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
  }

  /* 熱銷商品 */
  const topEl = document.getElementById('topProducts');
  if(topEl){
    topEl.innerHTML = topProducts.length
      ? topProducts.map(([k,v])=>`<div class="list-row"><div>${escapeHtml(k)}</div><strong>${v}</strong><span>份</span></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  /* 付款方式 */
  const payEl = document.getElementById('paymentStats');
  if(payEl){
    payEl.innerHTML = paymentStats.length
      ? paymentStats.map(([k,v])=>`<div class="list-row"><div>${escapeHtml(k)}</div><strong>${money(v)}</strong></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  /* 商品分析 */
  const paEl = document.getElementById('productAnalysis');
  if(paEl){
    paEl.innerHTML = pa.length
      ? pa.map(([k,v])=>`<div class="list-row"><div>${escapeHtml(k)}</div><strong>${v.qty}份 / ${money(v.sales)}</strong></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  /* 時段分析 */
  const hourEl = document.getElementById('hourAnalysis');
  if(hourEl){
    hourEl.innerHTML = ha.length
      ? ha.map(([k,v])=>`<div class="list-row"><div>${k}</div><strong>${v.count}單 / ${money(v.sales)}</strong></div>`).join('')
      : '<div class="muted">尚無資料</div>';
  }

  /* 營業紀錄 */
  const sessionEl = document.getElementById('reportSessionList');
  if(sessionEl){
    sessionEl.innerHTML = getSessionListHtml(escapeHtml);
  }
}

/* ===== 產生列印 HTML ===== */
function buildReportPrintHtml(flags){
  const { summary, topProducts, paymentStats, pa, ha } = calcReportData();
  const now = new Date().toLocaleString('zh-TW');
  const fromVal = document.getElementById('reportDateFrom')?.value || '';
  const toVal   = document.getElementById('reportDateTo')?.value || '';
  const rangeText = (fromVal || toVal) ? `查詢區間：${fromVal || '不限'} ～ ${toVal || '不限'}` : '全部訂單';

  let body = '';

  /* 營業額摘要 */
  if(flags.summary){
    body += `<h2>營業額摘要</h2><table><tbody>`;
    summary.forEach(([l,v])=>{ body += `<tr><td>${l}</td><td class="right"><strong>${v}</strong></td></tr>`; });
    body += `</tbody></table>`;
  }

  /* 熱銷商品 */
  if(flags.topProducts){
    body += `<h2>熱銷商品 TOP 10</h2>`;
    if(topProducts.length){
      body += `<table><thead><tr><th>商品</th><th class="right">數量</th></tr></thead><tbody>`;
      topProducts.forEach(([k,v])=>{ body += `<tr><td>${escapeHtml(k)}</td><td class="right">${v} 份</td></tr>`; });
      body += `</tbody></table>`;
    } else { body += `<p class="muted">尚無資料</p>`; }
  }

  /* 付款方式 */
  if(flags.paymentStats){
    body += `<h2>付款方式統計</h2>`;
    if(paymentStats.length){
      body += `<table><thead><tr><th>方式</th><th class="right">金額</th></tr></thead><tbody>`;
      paymentStats.forEach(([k,v])=>{ body += `<tr><td>${escapeHtml(k)}</td><td class="right">${money(v)}</td></tr>`; });
      body += `</tbody></table>`;
    } else { body += `<p class="muted">尚無資料</p>`; }
  }

  /* 商品販賣分析 */
  if(flags.productAnalysis){
    body += `<h2>商品販賣分析</h2>`;
    if(pa.length){
      body += `<table><thead><tr><th>商品</th><th class="right">數量</th><th class="right">金額</th></tr></thead><tbody>`;
      pa.forEach(([k,v])=>{ body += `<tr><td>${escapeHtml(k)}</td><td class="right">${v.qty} 份</td><td class="right">${money(v.sales)}</td></tr>`; });
      body += `</tbody></table>`;
    } else { body += `<p class="muted">尚無資料</p>`; }
  }

  /* 時段分析 */
  if(flags.hourAnalysis){
    body += `<h2>時段販售狀況</h2>`;
    if(ha.length){
      body += `<table><thead><tr><th>時段</th><th class="right">訂單數</th><th class="right">金額</th></tr></thead><tbody>`;
      ha.forEach(([k,v])=>{ body += `<tr><td>${k}</td><td class="right">${v.count} 單</td><td class="right">${money(v.sales)}</td></tr>`; });
      body += `</tbody></table>`;
    } else { body += `<p class="muted">尚無資料</p>`; }
  }

  /* 營業紀錄 */
  if(flags.sessionList){
    const sessionHtml = getSessionListHtml(escapeHtml);
    body += `<h2>開始 / 結束紀錄</h2>`;
    body += sessionHtml || `<p class="muted">尚無紀錄</p>`;
  }

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>報表列印</title>
<style>
  @page { size: A4; margin: 12mm; }
  body {
    margin: 0; padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif;
    color: #000; font-size: 13px; line-height: 1.5;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 2px solid #000; padding-bottom: 4px; }
  .meta { font-size: 12px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #ccc; font-size: 13px; }
  th { background: #f5f5f5; font-weight: 700; }
  .right { text-align: right; }
  .muted { color: #888; }
  @media print {
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>營業報表</h1>
  <div class="meta">列印時間：${escapeHtml(now)}　｜　${escapeHtml(rangeText)}</div>
  ${body}
</body>
</html>`;
}

/* ===== 開啟列印預覽（使用 printPreviewModal） ===== */
function openReportPrintPreview(html){
  const modal = document.getElementById('printPreviewModal');
  const frame = document.getElementById('printPreviewFrame');
  const titleEl = document.getElementById('printPreviewTitle');
  if(!modal || !frame) return;
  if(titleEl) titleEl.textContent = '報表列印預覽';
  frame.srcdoc = html;
  modal.classList.remove('hidden');
}

/* ===== 初始化報表頁 ===== */
export function initReportsPage(){

  /* 套用日期 */
  document.getElementById('applyReportRangeBtn')?.addEventListener('click', ()=>{
    state.viewReportOrders = null;
    renderReports();
  });

  /* 返回目前 */
  document.getElementById('reportBackLiveBtn')?.addEventListener('click', ()=>{
    const fromEl = document.getElementById('reportDateFrom');
    const toEl   = document.getElementById('reportDateTo');
    if(fromEl) fromEl.value = '';
    if(toEl) toEl.value = '';
    state.viewReportOrders = null;
    renderReports();
  });

  /* 開始 */
  document.getElementById('reportStartBtn')?.addEventListener('click', ()=>{
    startSession();
    persistAll();
    alert('已開始統計');
  });

  /* 結束 */
  document.getElementById('reportEndBtn')?.addEventListener('click', ()=>{
    const session = endSession();
    persistAll();
    renderReports();
    if(session) alert(`已結束統計：${session.summary.orderCount} 單 / ${session.summary.salesText}`);
    else alert('尚未開始統計');
  });

  /* 儲存報表 */
  document.getElementById('saveReportSnapshotBtn')?.addEventListener('click', ()=>{
    const orders = getReportOrders();
    saveCurrentSnapshot(orders);
    persistAll();
    alert('已儲存報表');
  });

  /* 匯出今日 CSV */
  document.getElementById('exportTodayBtn')?.addEventListener('click', ()=>{
    const rows = [['訂單號','時間','狀態','類型','桌號','付款','總計']];
    state.orders
      .filter(o=>(o.createdAt||'').slice(0,10)===todayStr())
      .forEach(o=>rows.push([
        o.orderNo||'', o.createdAt||'', o.status||'', o.orderType||'',
        o.tableNo||'', o.paymentMethod||'', o.total||0
      ]));
    downloadFile('today-report.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
  });

  /* ===== 列印報表 ===== */
  const printReportBtn      = document.getElementById('printReportBtn');
  const reportPrintModal    = document.getElementById('reportPrintModal');
  const closeReportPrintBtn = document.getElementById('closeReportPrintModal');
  const reportPrintConfirm  = document.getElementById('reportPrintConfirmBtn');
  const reportPrintCancel   = document.getElementById('reportPrintCancelBtn');

  /* 開啟選項 Modal */
  printReportBtn?.addEventListener('click', ()=>{
    reportPrintModal?.classList.remove('hidden');
  });

  /* 關閉 */
  function closeRPModal(){ reportPrintModal?.classList.add('hidden'); }
  closeReportPrintBtn?.addEventListener('click', closeRPModal);
  reportPrintCancel?.addEventListener('click', closeRPModal);
  reportPrintModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeRPModal);

  /* 確認列印 */
  reportPrintConfirm?.addEventListener('click', ()=>{
    const flags = {
      summary:         document.getElementById('rp_summary')?.checked,
      topProducts:     document.getElementById('rp_topProducts')?.checked,
      paymentStats:    document.getElementById('rp_paymentStats')?.checked,
      productAnalysis: document.getElementById('rp_productAnalysis')?.checked,
      hourAnalysis:    document.getElementById('rp_hourAnalysis')?.checked,
      sessionList:     document.getElementById('rp_sessionList')?.checked,
    };

    /* 至少勾選一項 */
    if(!Object.values(flags).some(Boolean)){
      alert('請至少勾選一項報表');
      return;
    }

    closeRPModal();

    const html = buildReportPrintHtml(flags);
    openReportPrintPreview(html);
  });
}
