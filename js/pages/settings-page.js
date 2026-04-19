/*
 * ====================================================================
 * 中文備註：POS 設定頁（settings-page.js）
 * ====================================================================
 * 目錄：
 *   1. 匯入模組
 *   2. initSettingsPage() 主函式
 *      2a. 列印設定欄位初始化
 *      2b. 即時接單設定欄位初始化
 *      2c. renderPOSGoogleAccountBox() - 顯示 POS Google 帳號
 *      2d. renderRealtimeOrderPanel() - 顯示即時接單狀態
 *      2e. 儲存即時接單設定按鈕
 *      2f. 同步菜單到雲端按鈕
 *      2g. 商品圖片顯示切換
 *      2h. Google Drive 備份設定
 *      2i. POS Google 登入/登出
 *      2j. 匯出/匯入 JSON
 *      2k. 重建預設資料
 *      2l. 列印預覽與儲存列印設定
 *      2m. 自訂進單提示音設定（設定頁最底部）
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
 * 2. initSettingsPage() 主函式
 * ============================ */
export function initSettingsPage(){

  /* ============================
   * 2a. 列印設定欄位初始化
   * ============================ */
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

  /* ============================
   * 2b. 即時接單設定欄位初始化
   * ============================ */
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

  /* ============================
   * 2c. renderPOSGoogleAccountBox() - 顯示目前 POS Google 登入帳號
   * ============================ */
  async function renderPOSGoogleAccountBox(){
    await waitForAuthReady().catch(()=> null);
    const user = getRealtimeAuthUser();
    document.getElementById('posGoogleAccountBox').innerHTML = user
      ? `POS 登入帳號：${user.email || user.uid}`
      : 'POS 登入帳號：未登入';
  }

  /* ============================
   * 2d. renderRealtimeOrderPanel() - 顯示即時接單狀態面板
   * ============================ */
  function renderRealtimeOrderPanel(){
    const cfg = getRealtimeConfig();
    const incomingCount = Array.isArray(state.onlineIncomingOrders) ? state.onlineIncomingOrders.filter(x => x.status === 'pending_confirm').length : 0;
    document.getElementById('realtimeOrderStatusBox').innerHTML =
      `同步狀態：${cfg.lastSyncStatus || '無'}<br>` +
      `最近收到訂單：${cfg.lastOrderAt ? cfg.lastOrderAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `最近確認訂單：${cfg.lastConfirmedAt ? cfg.lastConfirmedAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `線上待確認：${incomingCount} 筆`;
  }
  /* 掛載到 window 讓其他模組可以呼叫刷新 */
  window.refreshRealtimeOrderPanel = renderRealtimeOrderPanel;
  renderRealtimeOrderPanel();
  renderPOSGoogleAccountBox();

  /* ============================
   * 2e. 儲存即時接單設定按鈕
   * ============================ */
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
    startPOSRealtimeListener(()=> window.refreshAllViews()).catch(err=> console.error(err));
    alert('即時接單設定已儲存');
  };

  /* ============================
   * 2f. 同步菜單到雲端按鈕
   * ============================ */
  document.getElementById('syncMenuBtn')?.addEventListener('click', async ()=>{
    try{
      await syncMenuToFirebase();
      alert('菜單已同步到雲端，線上點餐將顯示最新菜單');
    }catch(err){
      alert(err.message || '同步失敗');
    }
  });

  /* ============================
   * 2g. 商品圖片顯示切換
   * ============================ */
  document.getElementById('showProductImagesToggle').checked = !!state.settings.showProductImages;

  /* ============================
   * 2h. Google Drive 備份設定
   * ============================ */
  const googleCfg = getGoogleBackupConfig();
  document.getElementById('googleClientId').value = googleCfg.clientId || '';
  document.getElementById('googleFolderId').value = googleCfg.folderId || '';
  document.getElementById('googleAutoBackupEnabled').checked = !!googleCfg.autoBackupEnabled;
  document.getElementById('googleAutoBackupMinutes').value = Number(googleCfg.autoBackupMinutes || 60);

  /* 渲染 Google Drive 備份狀態面板 */
  async function renderGoogleBackupPanel(){
    const cfg = getGoogleBackupConfig();
    const session = getGoogleDriveSession();

    document.getElementById('googleDriveAccountBox').innerHTML =
      `登入狀態：${session.isSignedIn ? '已登入' : '未登入'}${session.email ? ' / ' + session.email : ''}`;

    document.getElementById('googleBackupStatusBox').innerHTML =
      `最近備份：${cfg.lastBackupAt ? cfg.lastBackupAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `備份狀態：${cfg.lastBackupStatus || '無'}<br>` +
      `最近還原：${cfg.lastRestoreAt ? cfg.lastRestoreAt.replace('T',' ').slice(0,16) : '無'}<br>` +
      `還原狀態：${cfg.lastRestoreStatus || '無'}`;

    const listBox = document.getElementById('googleBackupFileList');
    if(!session.isSignedIn){
      listBox.innerHTML = '備份清單：請先登入 Google';
      return;
    }
    try{
      const files = await listGoogleBackups();
      listBox.innerHTML = files.length
        ? '最近備份檔：<br>' + files.slice(0,5).map(f => `${f.name} / ${String(f.modifiedTime || '').replace('T',' ').slice(0,16)}`).join('<br>')
        : '最近備份檔：無';
    }catch(err){
      listBox.innerHTML = '最近備份檔：讀取失敗';
    }
  }

  window.refreshGoogleBackupPanel = renderGoogleBackupPanel;
  initializeGoogleDriveApi().then(()=> renderGoogleBackupPanel()).catch(()=> renderGoogleBackupPanel());

  /* 儲存 Google Drive 設定 */
  document.getElementById('saveGoogleBackupSettingsBtn').onclick = ()=>{
    const cfg = getGoogleBackupConfig();
    cfg.clientId = document.getElementById('googleClientId').value.trim();
    cfg.folderId = document.getElementById('googleFolderId').value.trim();
    cfg.autoBackupEnabled = document.getElementById('googleAutoBackupEnabled').checked;
    cfg.autoBackupMinutes = Math.max(5, Number(document.getElementById('googleAutoBackupMinutes').value || 60));
    persistAll();
    startGoogleAutoBackup();
    renderGoogleBackupPanel();
    alert('Google Drive 設定已儲存');
  };

  /* Google Drive 登入 */
  document.getElementById('googleLoginBtn').onclick = async ()=>{
    try{
      const cfg = getGoogleBackupConfig();
      cfg.clientId = document.getElementById('googleClientId').value.trim();
      cfg.folderId = document.getElementById('googleFolderId').value.trim();
      persistAll();
      await signInGoogleDrive();
      await renderGoogleBackupPanel();
      alert('已登入 Google');
    }catch(err){
      alert(err.message || 'Google 登入失敗');
    }
  };

  /* Google Drive 登出 */
  document.getElementById('googleLogoutBtn').onclick = ()=>{
    signOutGoogleDrive();
    renderGoogleBackupPanel();
    alert('已登出 Google');
  };

  /* 手動備份到 Google Drive */
  document.getElementById('manualGoogleBackupBtn').onclick = async ()=>{
    try{
      const cfg = getGoogleBackupConfig();
      cfg.lastBackupStatus = '備份中...';
      persistAll();
      await renderGoogleBackupPanel();
      await backupToGoogle();
      await renderGoogleBackupPanel();
      alert('已完成 Google Drive 備份');
    }catch(err){
      const cfg = getGoogleBackupConfig();
      cfg.lastBackupStatus = err.message || '備份失敗';
      persistAll();
      await renderGoogleBackupPanel();
      alert(cfg.lastBackupStatus);
    }
  };

  /* 從 Google Drive 還原 */
  document.getElementById('manualGoogleRestoreBtn').onclick = async ()=>{
    if(!confirm('確定要從 Google Drive 還原？目前本機資料會被覆蓋。')) return;
    try{
      const cfg = getGoogleBackupConfig();
      cfg.lastRestoreStatus = '還原中...';
      persistAll();
      await renderGoogleBackupPanel();
      await restoreFromGoogle();
      await renderGoogleBackupPanel();
      window.refreshAllViews();
      alert('已完成 Google Drive 還原');
    }catch(err){
      const cfg = getGoogleBackupConfig();
      cfg.lastRestoreStatus = err.message || '還原失敗';
      persistAll();
      await renderGoogleBackupPanel();
      alert(cfg.lastRestoreStatus);
    }
  };

  /* ============================
   * 2i. POS Google 登入/登出
   * ============================ */
  document.getElementById('posGoogleLoginBtn').onclick = async ()=>{
    try{
      await signInPOSWithGoogle();
      const access = await verifyPOSAccess();
      await renderPOSGoogleAccountBox();
      await startPOSRealtimeListener(()=> window.refreshAllViews());
      if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
      alert(`POS Google 登入成功（${access.role}）`);
    }catch(err){
      alert(err.message || 'POS Google 登入失敗');
    }
  };

  document.getElementById('posGoogleLogoutBtn').onclick = async ()=>{
    try{
      await signOutPOSGoogle();
      await renderPOSGoogleAccountBox();
      alert('POS Google 已登出');
    }catch(err){
      alert(err.message || 'POS Google 登出失敗');
    }
  };

  /* ============================
   * 2j. 匯出/匯入 JSON
   * ============================ */
  document.getElementById('exportJsonBtn').onclick = ()=>{
    downloadFile('pos-backup.json', JSON.stringify({
      categories: state.categories,
      modules: state.modules,
      products: state.products,
      orders: state.orders,
      settings: state.settings,
      reports: state.reports
    }, null, 2), 'application/json');
  };

  document.getElementById('importJsonInput').onchange = async (e)=>{
    const f = e.target.files[0];
    if(!f) return;
    try{
      const data = JSON.parse(await f.text());
      if(Array.isArray(data.categories)) state.categories = data.categories.includes('未分類') ? data.categories : ['未分類', ...data.categories];
      if(Array.isArray(data.modules)) state.modules = data.modules;
      if(Array.isArray(data.products)) state.products = data.products;
      if(Array.isArray(data.orders)) state.orders = data.orders;
      if(data.settings) state.settings = data.settings;
      if(data.reports) state.reports = data.reports;
      persistAll();
      window.refreshAllViews();
      alert('匯入成功');
    }catch(err){
      alert('匯入失敗');
    }
  };

  /* ============================
   * 2k. 重建預設資料
   * ============================ */
  document.getElementById('seedDemoBtn').onclick = ()=>{
    seedDefaults();
    window.refreshAllViews();
    alert('已重建預設資料');
  };

  document.getElementById('showProductImagesToggle').onchange = (e)=>{
    state.settings.showProductImages = !!e.target.checked;
    persistAll();
    window.refreshAllViews();
  };

  /* ============================
   * 2l. 列印預覽與儲存列印設定
   * ============================ */
  function buildPreviewOrderForSettings(){
    if(Array.isArray(state.cart) && state.cart.length){
      return buildCartPreviewOrder();
    }
    return {
      orderNo: 'PREVIEW-' + Date.now(),
      createdAt: new Date().toISOString(),
      orderType: '內用',
      tableNo: 'A1',
      paymentMethod: '現金',
      subtotal: 145,
      discountAmount: 0,
      total: 145,
      items: [
        {
          rowId: 'preview1',
          productId: 'preview1',
          name: '雞排',
          basePrice: 70,
          qty: 2,
          note: '不要切',
          selections: [
            { moduleName: '辣度', optionName: '小辣', price: 0 },
            { moduleName: '灑粉', optionName: '梅粉', price: 5 }
          ],
          extraPrice: 5
        }
      ]
    };
  }

  document.getElementById('previewReceiptPrintBtn').onclick = ()=>{
    printOrderReceipt(buildPreviewOrderForSettings(), 'customer');
  };

  document.getElementById('previewLabelPrintBtn').onclick = ()=>{
    printOrderLabels(buildPreviewOrderForSettings());
  };

  /* 儲存列印設定 */
  document.getElementById('savePrintSettingsBtn').onclick = ()=>{
    const cfg = getPrintSettings();
    cfg.storeName = document.getElementById('printStoreName').value.trim();
    cfg.storePhone = document.getElementById('printStorePhone').value.trim();
    cfg.storeAddress = document.getElementById('printStoreAddress').value.trim();
    cfg.receiptFooter = document.getElementById('printReceiptFooter').value.trim();
    cfg.receiptPaperWidth = document.getElementById('printReceiptPaperWidth').value || '58';
    cfg.labelPaperWidth = Number(document.getElementById('printLabelPaperWidth').value || 60);
    cfg.labelPaperHeight = Number(document.getElementById('printLabelPaperHeight').value || 40);
    cfg.receiptFontSize = Number(document.getElementById('printReceiptFontSize').value || 12);
    cfg.labelFontSize = Number(document.getElementById('printLabelFontSize').value || 12);
    cfg.receiptOffsetX = Number(document.getElementById('printReceiptOffsetX').value || 0);
    cfg.receiptOffsetY = Number(document.getElementById('printReceiptOffsetY').value || 0);
    cfg.labelOffsetX = Number(document.getElementById('printLabelOffsetX').value || 0);
    cfg.labelOffsetY = Number(document.getElementById('printLabelOffsetY').value || 0);
    cfg.kitchenCopies = Math.max(1, Number(document.getElementById('printKitchenCopies').value || 1));
    cfg.autoPrintCheckout = document.getElementById('printAutoCheckout').checked;
    cfg.autoPrintKitchen = document.getElementById('printAutoKitchen').checked;
    persistAll();
    alert('列印設定已儲存');
  };

  /* ============================
   * 2m. 自訂進單提示音設定（設定頁最底部）
   *     使用者可上傳 .mp3 / .wav 音效檔，儲存為 base64，
   *     進單時優先播放自訂音效，無自訂則使用預設合成音。
   * ============================ */
  initCustomSoundSection();
}

/* ============================
 * 自訂進單提示音設定區塊
 * ============================ */
function initCustomSoundSection(){
  const cfg = getRealtimeConfig();

  /* 顯示目前音效狀態 */
  renderCustomSoundStatus();

  /* 上傳自訂音效按鈕 */
  document.getElementById('uploadCustomSoundBtn')?.addEventListener('click', ()=>{
    document.getElementById('customSoundFileInput')?.click();
  });

  /* 檔案選擇事件：讀取音效檔並轉成 base64 存入設定 */
  document.getElementById('customSoundFileInput')?.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;

    /* 限制檔案大小 500KB（base64 會膨脹約 33%，localStorage 有限制） */
    if(file.size > 500 * 1024){
      alert('音效檔案太大，請選擇 500KB 以下的 .mp3 或 .wav 檔案');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = ()=>{
      const cfg = getRealtimeConfig();
      cfg.customSoundData = reader.result;    /* base64 data URL */
      cfg.customSoundName = file.name;
      persistAll();
      renderCustomSoundStatus();
      alert(`已設定自訂音效：${file.name}`);
    };
    reader.onerror = ()=>{
      alert('讀取音效檔案失敗');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; /* 清空避免同檔案無法再次選取 */
  });

  /* 試聽自訂音效按鈕 */
  document.getElementById('previewCustomSoundBtn')?.addEventListener('click', ()=>{
    const cfg = getRealtimeConfig();
    if(!cfg.customSoundData){
      /* 無自訂音效，播放預設合成音 */
      alert('目前無自訂音效，將播放預設提示音');
    }
    /* 暫時強制啟用聲音以便試聽 */
    const originalEnabled = cfg.incomingSoundEnabled;
    cfg.incomingSoundEnabled = true;

    if(cfg.customSoundData){
      /* 播放自訂音效 */
      try{
        const audio = new Audio(cfg.customSoundData);
        audio.volume = 1.0;
        audio.play().catch(()=> alert('播放失敗，請嘗試其他音效檔'));
      }catch(err){
        alert('播放失敗：' + (err.message || '未知錯誤'));
      }
    }else{
      /* 播放預設合成音（透過 import 的 beep 不方便直接呼叫，
         這裡內建一個簡易版） */
      try{
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if(!AudioCtx){ alert('此瀏覽器不支援音效播放'); return; }
        const ctx = new AudioCtx();
        [880, 1047, 880].forEach((freq, i)=>{
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = freq;
          gain.gain.value = 0.35;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.33);
          osc.stop(ctx.currentTime + i * 0.33 + 0.15);
        });
        setTimeout(()=> ctx.close(), 2000);
      }catch(err){
        alert('播放失敗');
      }
    }

    /* 還原原本的啟用狀態 */
    cfg.incomingSoundEnabled = originalEnabled;
  });

  /* 移除自訂音效按鈕（恢復為預設合成音） */
  document.getElementById('removeCustomSoundBtn')?.addEventListener('click', ()=>{
    if(!confirm('確定要移除自訂音效？移除後將使用預設提示音。')) return;
    const cfg = getRealtimeConfig();
    cfg.customSoundData = '';
    cfg.customSoundName = '';
    persistAll();
    renderCustomSoundStatus();
    alert('已移除自訂音效，將使用預設提示音');
  });
}

/* 渲染自訂音效狀態文字 */
function renderCustomSoundStatus(){
  const cfg = getRealtimeConfig();
  const box = document.getElementById('customSoundStatusBox');
  if(!box) return;
  if(cfg.customSoundData && cfg.customSoundName){
    box.innerHTML = `目前音效：<strong>${cfg.customSoundName}</strong>（自訂音效）`;
  }else{
    box.innerHTML = '目前音效：<strong>預設提示音</strong>（3 聲合成音）';
  }
}
