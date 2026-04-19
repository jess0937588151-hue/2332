/*
 * ====================================================================
 * 中文備註：POS 設定頁（settings-page.js）
 * ====================================================================
 * 目錄：
 *   1. 匯入模組
 *   2. initSettingsPage() 主函式
 *      2a. 列印設定欄位初始化
 *      2b. 即時接單設定欄位初始化
 *      2c. renderPOSGoogleAccountBox()
 *      2d. renderRealtimeOrderPanel()
 *      2e. 儲存即時接單設定
 *      2f. 同步菜單到雲端
 *      2g. 商品圖片切換
 *      2h. Google Drive 備份設定
 *      2i. POS Google 登入/登出
 *      2j. 匯出/匯入 JSON
 *      2k. 重建預設資料
 *      2l. 列印預覽（欄位選擇 → 浮動視窗預覽 → 列印）
 *      2m. 自訂進單提示音
 * ====================================================================
 */

/* ============================
 * 1. 匯入模組
 * ============================ */
import { state, persistAll, seedDefaults } from '../core/store.js';
import { downloadFile } from '../core/utils.js';
import { buildCartPreviewOrder, printOrderLabels, printOrderReceipt, getPrintSettings } from '../modules/print-service.js';
import { backupToGoogle, getGoogleBackupConfig, getGoogleDriveSession, initializeGoogleDriveApi, listGoogleBackups, restoreFromGoogle, signInGoogleDrive, signOutGoogleDrive, startGoogleAutoBackup } from '../modules/google-backup-service.js';
import { getRealtimeAuthUser, getRealtimeConfig, signInPOSWithGoogle, signOutPOSGoogle, startPOSRealtimeListener, verifyPOSAccess, waitForAuthReady, syncMenuToFirebase } from '../modules/realtime-order-service.js';

/* ============================
 * 2. initSettingsPage()
 * ============================ */
export function initSettingsPage(){

  /* 2a. 列印設定欄位初始化 */
  const printConfig = getPrintSettings();
  document.getElementById('printStoreName').value = printConfig.storeName || '';
  document.getElementById('printStorePhone').value = printConfig.storePhone || '';
  document.getElementById('printStoreAddress').value = printConfig.storeAddress || '';
  document.getElementById('printReceiptFooter').value = printConfig.receiptFooter || '';
  document.getElementById('printReceiptPaperWidth').value = printConfig.receiptPaperWidth || '58';
  document.getElementById('printLabelPaperWidth').value = Number(printConfig.labelPaperWidth || 60);
  document.getElementById('printLabelPaperHeight').value = Number(printConfig.labelPaperHeight || 40);
  document.getElementById('printReceiptFontSize').value = Number(printConfig.receiptFontSize || 12);
  document.getElementById('printLabelFontSize').value = Number(printConfig.labelFontSize || 12);
  document.getElementById('printReceiptOffsetX').value = Number(printConfig.receiptOffsetX || 0);
  document.getElementById('printReceiptOffsetY').value = Number(printConfig.receiptOffsetY || 0);
  document.getElementById('printLabelOffsetX').value = Number(printConfig.labelOffsetX || 0);
  document.getElementById('printLabelOffsetY').value = Number(printConfig.labelOffsetY || 0);
  document.getElementById('printKitchenCopies').value = Number(printConfig.kitchenCopies || 1);
  document.getElementById('printAutoCheckout').checked = !!printConfig.autoPrintCheckout;
  document.getElementById('printAutoKitchen').checked = !!printConfig.autoPrintKitchen;

  /* 2b. 即時接單設定欄位初始化 */
  const realtimeCfg = getRealtimeConfig();
  document.getElementById('realtimeOrderEnabled').checked = !!realtimeCfg.enabled;
  document.getElementById('firebaseApiKey').value = realtimeCfg.apiKey || '';
  document.getElementById('firebaseAuthDomain').value = realtimeCfg.authDomain || '';
  document.getElementById('firebaseDatabaseUrl').value = realtimeCfg.databaseURL || '';
  document.getElementById('firebaseProjectId').value = realtimeCfg.projectId || '';
  document.getElementById('firebaseStorageBucket').value = realtimeCfg.storageBucket || '';
  document.getElementById('firebaseMessagingSenderId').value = realtimeCfg.messagingSenderId || '';
  document.getElementById('firebaseAppId').value = realtimeCfg.appId || '';
  document.getElementById('firebaseMeasurementId').value = realtimeCfg.measurementId || '';
  document.getElementById('onlineStoreTitle').value = realtimeCfg.onlineStoreTitle || '';
  document.getElementById('onlineStoreSubtitle').value = realtimeCfg.onlineStoreSubtitle || '';
  document.getElementById('onlineConfirmAutoPrintKitchen').checked = !!realtimeCfg.autoPrintKitchenOnConfirm;
  document.getElementById('onlineConfirmAutoPrintReceipt').checked = !!realtimeCfg.autoPrintReceiptOnConfirm;
  document.getElementById('onlineIncomingSoundEnabled').checked = realtimeCfg.incomingSoundEnabled !== false;

  /* 2c. 顯示 POS Google 帳號 */
  async function renderPOSGoogleAccountBox(){
    await waitForAuthReady().catch(()=>null);
    const user = getRealtimeAuthUser();
    document.getElementById('posGoogleAccountBox').innerHTML = user
      ? `POS 登入帳號：${user.email || user.uid}`
      : 'POS 登入帳號：未登入';
  }

  /* 2d. 即時接單狀態面板 */
  function renderRealtimeOrderPanel(){
    const cfg = getRealtimeConfig();
    const cnt = Array.isArray(state.onlineIncomingOrders) ? state.onlineIncomingOrders.filter(x=>x.status==='pending_confirm').length : 0;
    document.getElementById('realtimeOrderStatusBox').innerHTML =
      `同步狀態：${cfg.lastSyncStatus||'無'}<br>`+
      `最近收到訂單：${cfg.lastOrderAt?cfg.lastOrderAt.replace('T',' ').slice(0,16):'無'}<br>`+
      `最近確認訂單：${cfg.lastConfirmedAt?cfg.lastConfirmedAt.replace('T',' ').slice(0,16):'無'}<br>`+
      `線上待確認：${cnt} 筆`;
  }
  window.refreshRealtimeOrderPanel = renderRealtimeOrderPanel;
  renderRealtimeOrderPanel();
  renderPOSGoogleAccountBox();

  /* 2e. 儲存即時接單設定 */
  document.getElementById('saveRealtimeOrderSettingsBtn').onclick = ()=>{
    const cfg = getRealtimeConfig();
    cfg.enabled = document.getElementById('realtimeOrderEnabled').checked;
    cfg.apiKey = document.getElementById('firebaseApiKey').value.trim();
    cfg.authDomain = document.getElementById('firebaseAuthDomain').value.trim();
    cfg.databaseURL = document.getElementById('firebaseDatabaseUrl').value.trim();
    cfg.projectId = document.getElementById('firebaseProjectId').value.trim();
    cfg.storageBucket = document.getElementById('firebaseStorageBucket').value.trim();
    cfg.messagingSenderId = document.getElementById('firebaseMessagingSenderId').value.trim();
    cfg.appId = document.getElementById('firebaseAppId').value.trim();
    cfg.measurementId = document.getElementById('firebaseMeasurementId').value.trim();
    cfg.onlineStoreTitle = document.getElementById('onlineStoreTitle').value.trim();
    cfg.onlineStoreSubtitle = document.getElementById('onlineStoreSubtitle').value.trim();
    cfg.autoPrintKitchenOnConfirm = document.getElementById('onlineConfirmAutoPrintKitchen').checked;
    cfg.autoPrintReceiptOnConfirm = document.getElementById('onlineConfirmAutoPrintReceipt').checked;
    cfg.incomingSoundEnabled = document.getElementById('onlineIncomingSoundEnabled').checked;
    persistAll();
    renderRealtimeOrderPanel();
    startPOSRealtimeListener(()=>window.refreshAllViews()).catch(err=>console.error(err));
    alert('即時接單設定已儲存');
  };

  /* 2f. 同步菜單到雲端 */
  document.getElementById('syncMenuBtn')?.addEventListener('click', async ()=>{
    try{ await syncMenuToFirebase(); alert('菜單已同步到雲端'); }catch(err){ alert(err.message||'同步失敗'); }
  });

  /* 2g. 商品圖片切換 */
  document.getElementById('showProductImagesToggle').checked = !!state.settings.showProductImages;

  /* 2h. Google Drive 備份設定 */
  const googleCfg = getGoogleBackupConfig();
  document.getElementById('googleClientId').value = googleCfg.clientId || '';
  document.getElementById('googleFolderId').value = googleCfg.folderId || '';
  document.getElementById('googleAutoBackupEnabled').checked = !!googleCfg.autoBackupEnabled;
  document.getElementById('googleAutoBackupMinutes').value = Number(googleCfg.autoBackupMinutes || 60);

  async function renderGoogleBackupPanel(){
    const cfg = getGoogleBackupConfig();
    const session = getGoogleDriveSession();
    document.getElementById('googleDriveAccountBox').innerHTML =
      `登入狀態：${session.isSignedIn?'已登入':'未登入'}${session.email?' / '+session.email:''}`;
       /* 只顯示最新備份時間 + 最近還原時間與狀態 */
    const backupTime = cfg.lastBackupAt ? cfg.lastBackupAt.replace('T',' ').slice(0,16) : '無';
    const restoreTime = cfg.lastRestoreAt ? cfg.lastRestoreAt.replace('T',' ').slice(0,16) : '無';
    const restoreStatus = cfg.lastRestoreStatus || '尚未還原';
    document.getElementById('googleBackupStatusBox').innerHTML =
      `最近備份：${backupTime}<br>`+
      `最近還原：${restoreTime}（${restoreStatus}）`;
    const listBox = document.getElementById('googleBackupFileList');
    if(!session.isSignedIn){ listBox.innerHTML=''; return; }
    try{
      const files = await listGoogleBackups();
      listBox.innerHTML = files.length
        ? `最新備份檔：${String(files[0].modifiedTime||'').replace('T',' ').slice(0,16)}`
        : '';
    }catch(err){ listBox.innerHTML=''; }
}
  }
  window.refreshGoogleBackupPanel = renderGoogleBackupPanel;
  initializeGoogleDriveApi().then(()=>renderGoogleBackupPanel()).catch(()=>renderGoogleBackupPanel());

  document.getElementById('saveGoogleBackupSettingsBtn').onclick = ()=>{
    const cfg = getGoogleBackupConfig();
    cfg.clientId = document.getElementById('googleClientId').value.trim();
    cfg.folderId = document.getElementById('googleFolderId').value.trim();
    cfg.autoBackupEnabled = document.getElementById('googleAutoBackupEnabled').checked;
    cfg.autoBackupMinutes = Math.max(5,Number(document.getElementById('googleAutoBackupMinutes').value||60));
    persistAll(); startGoogleAutoBackup(); renderGoogleBackupPanel(); alert('Google Drive 設定已儲存');
  };
  document.getElementById('googleLoginBtn').onclick = async ()=>{
    try{
      const cfg=getGoogleBackupConfig(); cfg.clientId=document.getElementById('googleClientId').value.trim();
      cfg.folderId=document.getElementById('googleFolderId').value.trim(); persistAll();
      await signInGoogleDrive(); await renderGoogleBackupPanel(); alert('已登入 Google');
    }catch(err){ alert(err.message||'Google 登入失敗'); }
  };
  document.getElementById('googleLogoutBtn').onclick = ()=>{ signOutGoogleDrive(); renderGoogleBackupPanel(); alert('已登出 Google'); };
  document.getElementById('manualGoogleBackupBtn').onclick = async ()=>{
    try{
      const cfg=getGoogleBackupConfig(); cfg.lastBackupStatus='備份中...'; persistAll();
      await renderGoogleBackupPanel(); await backupToGoogle(); await renderGoogleBackupPanel(); alert('已完成備份');
    }catch(err){
      const cfg=getGoogleBackupConfig(); cfg.lastBackupStatus=err.message||'備份失敗'; persistAll();
      await renderGoogleBackupPanel(); alert(cfg.lastBackupStatus);
    }
  };
  document.getElementById('manualGoogleRestoreBtn').onclick = async ()=>{
    if(!confirm('確定要從 Google Drive 還原？本機資料會被覆蓋。')) return;
    try{
      const cfg=getGoogleBackupConfig(); cfg.lastRestoreStatus='還原中...'; persistAll();
      await renderGoogleBackupPanel(); await restoreFromGoogle(); await renderGoogleBackupPanel();
      window.refreshAllViews(); alert('已完成還原');
    }catch(err){
      const cfg=getGoogleBackupConfig(); cfg.lastRestoreStatus=err.message||'還原失敗'; persistAll();
      await renderGoogleBackupPanel(); alert(cfg.lastRestoreStatus);
    }
  };

  /* 2i. POS Google 登入/登出 */
  document.getElementById('posGoogleLoginBtn').onclick = async ()=>{
    try{
      await signInPOSWithGoogle(); const access=await verifyPOSAccess();
      await renderPOSGoogleAccountBox();
      await startPOSRealtimeListener(()=>window.refreshAllViews());
      if(typeof window.refreshRealtimeOrderPanel==='function') window.refreshRealtimeOrderPanel();
      alert(`POS Google 登入成功（${access.role}）`);
    }catch(err){ alert(err.message||'POS Google 登入失敗'); }
  };
  document.getElementById('posGoogleLogoutBtn').onclick = async ()=>{
    try{ await signOutPOSGoogle(); await renderPOSGoogleAccountBox(); alert('POS Google 已登出'); }
    catch(err){ alert(err.message||'登出失敗'); }
  };

  /* 2j. 匯出/匯入 JSON */
  document.getElementById('exportJsonBtn').onclick = ()=>{
    downloadFile('pos-backup.json', JSON.stringify({
      categories:state.categories, modules:state.modules, products:state.products,
      orders:state.orders, settings:state.settings, reports:state.reports
    },null,2), 'application/json');
  };
  document.getElementById('importJsonInput').onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    try{
      const data=JSON.parse(await f.text());
      if(Array.isArray(data.categories)) state.categories=data.categories.includes('未分類')?data.categories:['未分類',...data.categories];
      if(Array.isArray(data.modules)) state.modules=data.modules;
      if(Array.isArray(data.products)) state.products=data.products;
      if(Array.isArray(data.orders)) state.orders=data.orders;
      if(data.settings) state.settings=data.settings;
      if(data.reports) state.reports=data.reports;
      persistAll(); window.refreshAllViews(); alert('匯入成功');
    }catch(err){ alert('匯入失敗'); }
  };

  /* 2k. 重建預設資料 */
  document.getElementById('seedDemoBtn').onclick = ()=>{ seedDefaults(); window.refreshAllViews(); alert('已重建預設資料'); };
  document.getElementById('showProductImagesToggle').onchange = (e)=>{
    state.settings.showProductImages=!!e.target.checked; persistAll(); window.refreshAllViews();
  };

  /* ============================
   * 2l. 列印預覽（欄位選擇 → 浮動視窗預覽 → 列印）
   * ============================ */

  /* --- 工具函式 --- */
  function esc(text){ return String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function money(v){ return '$'+Number(v||0).toFixed(0); }
  function selText(item){
    const o=(item.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / ');
    const n=item.note?`備註：${item.note}`:'';
    return [o,n].filter(Boolean).join(' ｜ ');
  }

  /* --- 讀取欄位勾選狀態 --- */
  function getFieldFlags(){
    return {
      storeName:    document.getElementById('pf_storeName').checked,
      storePhone:   document.getElementById('pf_storePhone').checked,
      storeAddress: document.getElementById('pf_storeAddress').checked,
      orderNo:      document.getElementById('pf_orderNo').checked,
      createdAt:    document.getElementById('pf_createdAt').checked,
      orderType:    document.getElementById('pf_orderType').checked,
      paymentMethod:document.getElementById('pf_paymentMethod').checked,
      itemSelections:document.getElementById('pf_itemSelections').checked,
      itemNote:     document.getElementById('pf_itemNote').checked,
      itemPrice:    document.getElementById('pf_itemPrice').checked,
      totalSection: document.getElementById('pf_totalSection').checked,
      footer:       document.getElementById('pf_footer').checked
    };
  }

  /* --- 產生預覽用假訂單 --- */
  function buildPreviewOrder(){
    if(Array.isArray(state.cart)&&state.cart.length) return buildCartPreviewOrder();
    return {
      orderNo:'PREVIEW-'+Date.now(), createdAt:new Date().toISOString(),
      orderType:'內用', tableNo:'A1', paymentMethod:'現金',
      subtotal:145, discountAmount:0, total:145,
      items:[{
        rowId:'p1', productId:'p1', name:'雞排', basePrice:70, qty:2, note:'不要切',
        selections:[{moduleName:'辣度',optionName:'小辣',price:0},{moduleName:'灑粉',optionName:'梅粉',price:5}],
        extraPrice:5
      }]
    };
  }

  /* --- 產生收據 HTML（顧客單 / 廚房單共用，靠 mode 與 flags 控制顯示） --- */
  function buildReceiptHtml(order, mode, flags){
    const cfg = getPrintSettings();
    const w = Number(cfg.receiptPaperWidth||58);
    const fs = Math.max(8, Number(cfg.receiptFontSize||12));
    const ox = Number(cfg.receiptOffsetX||0);
    const oy = Number(cfg.receiptOffsetY||0);
    const isKitchen = mode==='kitchen';
    const title = isKitchen ? '廚房出單' : '顧客收據';
    const time = String(order.createdAt||'').replace('T',' ').slice(0,16);

    const rows = (order.items||[]).map(item=>{
      const up = Number(item.basePrice||0)+Number(item.extraPrice||0);
      const sub = selText(item);
      const showSel = flags.itemSelections && (item.selections||[]).length;
      const showNote = flags.itemNote && item.note;
      const subParts = [];
      if(showSel) subParts.push((item.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / '));
      if(showNote) subParts.push(`備註：${item.note}`);
      return `<div class="item-row">
        <div class="item-top"><div class="item-name">${esc(item.name)}</div><div class="item-qty">x ${Number(item.qty||0)}</div></div>
        ${subParts.length?`<div class="item-sub">${esc(subParts.join(' ｜ '))}</div>`:''}
        ${flags.itemPrice&&!isKitchen?`<div class="item-sub">${money(up)} / 小計 ${money(up*Number(item.qty||0))}</div>`:''}
      </div>`;
    }).join('');

    return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><style>
      @page{size:${w}mm auto;margin:0}
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;color:#000}
      .sheet{width:${w}mm;padding:4mm;box-sizing:border-box;transform:translate(${ox}mm,${oy}mm);font-size:${fs}px;line-height:1.45}
      .center{text-align:center}.title{font-size:${fs+5}px;font-weight:800}.sub{font-size:${fs-1}px;margin-top:2px}
      .line{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px}
      .item-row{padding:6px 0;border-bottom:1px dashed #bbb}.item-top{display:flex;justify-content:space-between;gap:8px;font-weight:700}
      .item-name{flex:1}.item-qty{white-space:nowrap}.item-sub{margin-top:3px;font-size:${fs-1}px;color:#333}
      .big{font-size:${fs+2}px;font-weight:800}.footer{margin-top:10px;text-align:center;font-size:${fs-1}px}
    </style></head><body><div class="sheet">
      ${flags.storeName?`<div class="center"><div class="title">${esc(cfg.storeName||'餐廳 POS')}</div></div>`:''}
      ${flags.storePhone&&cfg.storePhone?`<div class="center"><div class="sub">電話：${esc(cfg.storePhone)}</div></div>`:''}
      ${flags.storeAddress&&cfg.storeAddress?`<div class="center"><div class="sub">地址：${esc(cfg.storeAddress)}</div></div>`:''}
      <div class="center"><div class="sub">${esc(title)}</div></div>
      <div class="line"></div>
      ${flags.orderNo?`<div class="sub">單號：${esc(order.orderNo||'')}</div>`:''}
      ${flags.createdAt?`<div class="sub">時間：${esc(time)}</div>`:''}
      ${flags.orderType?`<div class="sub">類型：${esc(order.orderType||'')}${order.tableNo?' / '+esc(order.tableNo):''}</div>`:''}
      ${flags.paymentMethod&&!isKitchen?`<div class="sub">付款：${esc(order.paymentMethod||'')}</div>`:''}
      <div class="line"></div>
      ${rows}
      ${flags.totalSection&&!isKitchen?`
        <div class="line"></div>
        <div class="row"><span>小計</span><strong>${money(order.subtotal||0)}</strong></div>
        <div class="row"><span>折扣</span><strong>${money(order.discountAmount||0)}</strong></div>
        <div class="row big"><span>合計</span><span>${money(order.total||0)}</span></div>
      `:''}
      ${flags.footer&&cfg.receiptFooter?`<div class="line"></div><div class="footer">${esc(cfg.receiptFooter)}</div>`:''}
    </div></body></html>`;
  }

  /* --- 產生標籤 HTML --- */
  function buildLabelHtml(order, flags){
    const cfg = getPrintSettings();
    const w = Math.max(30,Number(cfg.labelPaperWidth||60));
    const h = Math.max(20,Number(cfg.labelPaperHeight||40));
    const fs = Math.max(8,Number(cfg.labelFontSize||12));
    const ox = Number(cfg.labelOffsetX||0);
    const oy = Number(cfg.labelOffsetY||0);
    const labels = (order.items||[]).map(item=>{
      const subParts = [];
      if(flags.itemSelections&&(item.selections||[]).length) subParts.push((item.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / '));
      if(flags.itemNote&&item.note) subParts.push(`備註：${item.note}`);
      return `<div class="label">
        ${flags.storeName?`<div class="store">${esc(cfg.storeName||'餐廳 POS')}</div>`:''}
        <div class="main">${esc(item.name)} x ${Number(item.qty||0)}</div>
        ${subParts.length?`<div class="sub">${esc(subParts.join(' ｜ '))}</div>`:''}
        ${flags.orderNo?`<div class="sub">單號：${esc(order.orderNo||'')}</div>`:''}
        ${flags.createdAt?`<div class="sub">${esc(String(order.createdAt||'').replace('T',' ').slice(0,16))}</div>`:''}
      </div>`;
    }).join('');
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><style>
      @page{size:${w}mm ${h}mm;margin:0}
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;color:#000}
      .label{width:${w}mm;height:${h}mm;box-sizing:border-box;page-break-after:always;padding:3mm;
        transform:translate(${ox}mm,${oy}mm);font-size:${fs}px;line-height:1.35}
      .store{font-size:${fs-1}px;font-weight:700}.main{font-size:${fs+3}px;font-weight:800;margin-top:2mm}
      .sub{font-size:${fs-1}px;margin-top:1mm}
    </style></head><body>${labels}</body></html>`;
  }

  /* --- 預覽浮動視窗操作 --- */
  function openPreview(title, html){
    const modal = document.getElementById('printPreviewModal');
    const frame = document.getElementById('printPreviewFrame');
    document.getElementById('printPreviewTitle').textContent = title;
    modal.classList.remove('hidden');
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi,'');
    const doc = frame.contentDocument||frame.contentWindow.document;
    doc.open(); doc.write(clean); doc.close();
  }
  function closePreview(){
    document.getElementById('printPreviewModal').classList.add('hidden');
    const frame = document.getElementById('printPreviewFrame');
    const doc = frame.contentDocument||frame.contentWindow.document;
    doc.open(); doc.write(''); doc.close();
  }
  document.getElementById('printPreviewPrintBtn')?.addEventListener('click',()=>{
    const frame = document.getElementById('printPreviewFrame');
    if(frame&&frame.contentWindow) frame.contentWindow.print();
  });
  document.getElementById('closePrintPreviewModal')?.addEventListener('click', closePreview);
  document.querySelector('#printPreviewModal .modal-backdrop')?.addEventListener('click', closePreview);

  /* --- 欄位選擇 Modal 操作 --- */
  let pendingPreviewMode = null; /* 'receipt' | 'kitchen' | 'label' */

  function openFieldsModal(mode){
    pendingPreviewMode = mode;
    /* 依模式調整標題 */
    const titles = { receipt:'預覽顧客單 — 選擇列印欄位', kitchen:'預覽廚房單 — 選擇列印欄位', label:'預覽標籤 — 選擇列印欄位' };
    document.getElementById('printFieldsTitle').textContent = titles[mode] || '選擇列印欄位';
    /* 廚房單預設不勾付款方式、合計、收據備註；標籤預設不勾多數欄位 */
    if(mode==='kitchen'){
      document.getElementById('pf_paymentMethod').checked = false;
      document.getElementById('pf_itemPrice').checked = false;
      document.getElementById('pf_totalSection').checked = false;
      document.getElementById('pf_footer').checked = false;
    }else if(mode==='label'){
      document.getElementById('pf_storePhone').checked = false;
      document.getElementById('pf_storeAddress').checked = false;
      document.getElementById('pf_orderType').checked = false;
      document.getElementById('pf_paymentMethod').checked = false;
      document.getElementById('pf_itemPrice').checked = false;
      document.getElementById('pf_totalSection').checked = false;
      document.getElementById('pf_footer').checked = false;
    }else{
      /* 顧客單：全部勾選 */
      document.querySelectorAll('#printFieldsModal input[type="checkbox"]').forEach(cb=>cb.checked=true);
    }
    document.getElementById('printFieldsModal').classList.remove('hidden');
  }
  function closeFieldsModal(){
    document.getElementById('printFieldsModal').classList.add('hidden');
    pendingPreviewMode = null;
  }
  document.getElementById('closePrintFieldsModal')?.addEventListener('click', closeFieldsModal);
  document.getElementById('printFieldsCancelBtn')?.addEventListener('click', closeFieldsModal);
  document.querySelector('#printFieldsModal .modal-backdrop')?.addEventListener('click', closeFieldsModal);

  /* 確認欄位 → 產生 HTML → 開啟預覽 */
  document.getElementById('printFieldsConfirmBtn')?.addEventListener('click',()=>{
    const flags = getFieldFlags();
    const order = buildPreviewOrder();
    let html = '';
    let title = '';
    if(pendingPreviewMode==='receipt'){
      html = buildReceiptHtml(order, 'customer', flags);
      title = '預覽顧客單';
    }else if(pendingPreviewMode==='kitchen'){
      html = buildReceiptHtml(order, 'kitchen', flags);
      title = '預覽廚房單';
    }else if(pendingPreviewMode==='label'){
      html = buildLabelHtml(order, flags);
      title = '預覽標籤';
    }
    closeFieldsModal();
    if(html) openPreview(title, html);
  });

  /* --- 三個預覽按鈕 → 開啟欄位選擇 --- */
  document.getElementById('previewReceiptPrintBtn').onclick = ()=> openFieldsModal('receipt');
  document.getElementById('previewKitchenPrintBtn').onclick = ()=> openFieldsModal('kitchen');
  document.getElementById('previewLabelPrintBtn').onclick  = ()=> openFieldsModal('label');

  /* --- 儲存列印設定 --- */
  document.getElementById('savePrintSettingsBtn').onclick = ()=>{
    const cfg = getPrintSettings();
    cfg.storeName = document.getElementById('printStoreName').value.trim();
    cfg.storePhone = document.getElementById('printStorePhone').value.trim();
    cfg.storeAddress = document.getElementById('printStoreAddress').value.trim();
    cfg.receiptFooter = document.getElementById('printReceiptFooter').value.trim();
    cfg.receiptPaperWidth = document.getElementById('printReceiptPaperWidth').value||'58';
    cfg.labelPaperWidth = Number(document.getElementById('printLabelPaperWidth').value||60);
    cfg.labelPaperHeight = Number(document.getElementById('printLabelPaperHeight').value||40);
    cfg.receiptFontSize = Number(document.getElementById('printReceiptFontSize').value||12);
    cfg.labelFontSize = Number(document.getElementById('printLabelFontSize').value||12);
    cfg.receiptOffsetX = Number(document.getElementById('printReceiptOffsetX').value||0);
    cfg.receiptOffsetY = Number(document.getElementById('printReceiptOffsetY').value||0);
    cfg.labelOffsetX = Number(document.getElementById('printLabelOffsetX').value||0);
    cfg.labelOffsetY = Number(document.getElementById('printLabelOffsetY').value||0);
    cfg.kitchenCopies = Math.max(1,Number(document.getElementById('printKitchenCopies').value||1));
    cfg.autoPrintCheckout = document.getElementById('printAutoCheckout').checked;
    cfg.autoPrintKitchen = document.getElementById('printAutoKitchen').checked;
    persistAll();
    alert('列印設定已儲存');
  };

  /* ============================
   * 2m. 自訂進單提示音
   * ============================ */
  initCustomSoundSection();
}

/* ============================
 * 自訂進單提示音設定區塊
 * ============================ */
function initCustomSoundSection(){
  renderCustomSoundStatus();

  document.getElementById('uploadCustomSoundBtn')?.addEventListener('click',()=>{
    document.getElementById('customSoundFileInput')?.click();
  });
  document.getElementById('customSoundFileInput')?.addEventListener('change',(e)=>{
    const file=e.target.files[0]; if(!file) return;
    if(file.size>500*1024){ alert('音效檔案太大，請選擇 500KB 以下'); e.target.value=''; return; }
    const reader=new FileReader();
    reader.onload=()=>{
      const cfg=getRealtimeConfig(); cfg.customSoundData=reader.result; cfg.customSoundName=file.name;
      persistAll(); renderCustomSoundStatus(); alert(`已設定自訂音效：${file.name}`);
    };
    reader.onerror=()=>alert('讀取失敗');
    reader.readAsDataURL(file); e.target.value='';
  });
  document.getElementById('previewCustomSoundBtn')?.addEventListener('click',()=>{
    const cfg=getRealtimeConfig();
    if(cfg.customSoundData){
      try{ const a=new Audio(cfg.customSoundData); a.volume=1.0; a.play().catch(()=>alert('播放失敗')); }
      catch(err){ alert('播放失敗'); }
    }else{
      try{
        const AC=window.AudioContext||window.webkitAudioContext; if(!AC){alert('不支援');return;}
        const ctx=new AC();
        [880,1047,880].forEach((f,i)=>{
          const o=ctx.createOscillator(),g=ctx.createGain();
          o.type='square'; o.frequency.value=f; g.gain.value=0.35;
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime+i*0.33); o.stop(ctx.currentTime+i*0.33+0.15);
        });
        setTimeout(()=>ctx.close(),2000);
      }catch(err){ alert('播放失敗'); }
    }
  });
  document.getElementById('removeCustomSoundBtn')?.addEventListener('click',()=>{
    if(!confirm('確定移除自訂音效？')) return;
    const cfg=getRealtimeConfig(); cfg.customSoundData=''; cfg.customSoundName='';
    persistAll(); renderCustomSoundStatus(); alert('已移除，將使用預設提示音');
  });
}

function renderCustomSoundStatus(){
  const cfg=getRealtimeConfig();
  const box=document.getElementById('customSoundStatusBox'); if(!box) return;
  box.innerHTML = cfg.customSoundData&&cfg.customSoundName
    ? `目前音效：<strong>${cfg.customSoundName}</strong>（自訂音效）`
    : '目前音效：<strong>預設提示音</strong>（3 聲合成音）';
}
