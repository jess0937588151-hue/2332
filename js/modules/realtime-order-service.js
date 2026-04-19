/*
 * ====================================================================
 * 中文備註：Firebase 即時接單服務（realtime-order-service.js）
 * ====================================================================
 * 目錄：
 *   1. 匯入與常數設定
 *   2. 內部變數
 *   3. ensureRealtimeConfig() - 確保即時接單設定存在
 *   4. updateSyncStatus() - 更新同步狀態文字
 *   5. getRealtimeConfig() - 取得即時接單設定（匯出）
 *   6. loadFirebaseModules() - 動態載入 Firebase SDK
 *   7. getRef() - 取得 Firebase 資料庫參考路徑
 *   8. beep() - 進單提示音（支援自訂音效 + 預設合成音）
 *   9. 認證相關：signInPOSWithGoogle / signOutPOSGoogle / signInCustomerAnonymously / getRealtimeAuthUser / waitForAuthReady
 *  10. verifyPOSAccess() - 驗證 POS 是否有 staff 權限
 *  11. pushOnlineOrder() - 顧客送出線上訂單
 *  12. watchCustomerOrder() - 顧客監聽自己訂單狀態
 *  13. startPOSRealtimeListener() - POS 端即時監聽所有線上訂單
 *  14. visibilitychange 事件 - 切回頁面自動重連
 *  15. confirmOnlineOrder() - 店家確認訂單
 *  16. rejectOnlineOrder() - 店家拒絕訂單
 *  17. buildRealtimeOrderForPOS() - 轉換遠端訂單為 POS 格式
 *  18. syncMenuToFirebase() - 同步菜單到 Firebase
 *  19. loadMenuFromFirebase() - 從 Firebase 載入菜單
 * ====================================================================
 */

/* ============================
 * 1. 匯入與常數設定
 * ============================ */
import { state, persistAll } from '../core/store.js';

/* Firebase CDN 基礎路徑 */
const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';

/* Firebase 預設設定值（專案：webpos-1f626） */
const DEFAULT_FIREBASE_CONFIG = {
  enabled: true,
  apiKey: 'AIzaSyB0mGn6HQI00eR6UiU2hn44TbFoneblybk',
  authDomain: 'webpos-1f626.firebaseapp.com',
  databaseURL: 'https://webpos-1f626-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'webpos-1f626',
  storageBucket: 'webpos-1f626.firebasestorage.app',
  messagingSenderId: '203764995518',
  appId: '1:203764995518:web:8ebdf39837c5c59c4995ef',
  measurementId: 'G-34XEG1QCHW'
};

/* ============================
 * 2. 內部變數
 * ============================ */
let appInstance = null;       /* Firebase App 實例 */
let dbInstance = null;        /* Firebase Realtime Database 實例 */
let dbApi = null;             /* firebase-database 模組 API */
let authApi = null;           /* firebase-auth 模組 API */
let authInstance = null;      /* Firebase Auth 實例 */
let googleProvider = null;    /* Google 登入 Provider */
let initialized = false;     /* 是否已完成 Firebase 初始化 */
let posListenerRef = null;    /* POS 監聽器的資料庫參考 */
let posListenerCallback = null; /* POS 監聽器的回呼函式 */
let lastOnRefreshCallback = null; /* 記錄最後一次的 onRefresh callback，切回頁面時重連用 */

/* ============================
 * 3. ensureRealtimeConfig() - 確保即時接單設定存在
 *    若 state.settings.realtimeOrder 不存在則建立預設值
 * ============================ */
function ensureRealtimeConfig(){
  if(!state.settings) state.settings = {};
  const current = state.settings.realtimeOrder || {};
  state.settings.realtimeOrder = {
    /* Firebase 基本設定 */
    enabled: typeof current.enabled === 'boolean' ? current.enabled : DEFAULT_FIREBASE_CONFIG.enabled,
    apiKey: String(current.apiKey || '').trim() || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: String(current.authDomain || '').trim() || DEFAULT_FIREBASE_CONFIG.authDomain,
    databaseURL: String(current.databaseURL || '').trim() || DEFAULT_FIREBASE_CONFIG.databaseURL,
    projectId: String(current.projectId || '').trim() || DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket: String(current.storageBucket || '').trim() || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: String(current.messagingSenderId || '').trim() || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: String(current.appId || '').trim() || DEFAULT_FIREBASE_CONFIG.appId,
    measurementId: String(current.measurementId || '').trim() || DEFAULT_FIREBASE_CONFIG.measurementId,
    /* 線上點餐頁面顯示設定 */
    onlineStoreTitle: current.onlineStoreTitle || '',
    onlineStoreSubtitle: current.onlineStoreSubtitle || '',
    /* 自動列印設定 */
    autoPrintKitchenOnConfirm: current.autoPrintKitchenOnConfirm !== false,
    autoPrintReceiptOnConfirm: !!current.autoPrintReceiptOnConfirm,
    /* 進單提醒聲音設定 */
    incomingSoundEnabled: current.incomingSoundEnabled !== false,
    /* 自訂音效（base64 格式，若為空則使用預設合成音） */
    customSoundData: current.customSoundData || '',
    customSoundName: current.customSoundName || '',
    /* 同步狀態紀錄 */
    lastSyncStatus: current.lastSyncStatus || '尚未啟用',
    lastOrderAt: current.lastOrderAt || '',
    lastConfirmedAt: current.lastConfirmedAt || ''
  };
  return state.settings.realtimeOrder;
}

/* ============================
 * 4. updateSyncStatus() - 更新同步狀態文字並重繪 UI
 * ============================ */
function updateSyncStatus(message){
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = message;
  persistAll();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

/* ============================
 * 5. getRealtimeConfig() - 匯出即時接單設定（供其他模組使用）
 * ============================ */
export function getRealtimeConfig(){
  return ensureRealtimeConfig();
}

/* ============================
 * 6. loadFirebaseModules() - 動態載入 Firebase SDK 並初始化
 * ============================ */
async function loadFirebaseModules(){
  if(initialized) return;
  /* 動態匯入 Firebase 模組 */
  const appMod = await import(`${FIREBASE_BASE}/firebase-app.js`);
  dbApi = await import(`${FIREBASE_BASE}/firebase-database.js`);
  authApi = await import(`${FIREBASE_BASE}/firebase-auth.js`);

  const cfg = ensureRealtimeConfig();
  /* 檢查必要設定是否已填寫 */
  if(!cfg.apiKey || !cfg.databaseURL || !cfg.projectId || !cfg.appId){
    throw new Error('請先完整設定 Firebase');
  }

  /* 初始化 Firebase App */
  appInstance = appMod.initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || undefined,
    databaseURL: cfg.databaseURL,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket || undefined,
    messagingSenderId: cfg.messagingSenderId || undefined,
    appId: cfg.appId,
    measurementId: cfg.measurementId || undefined
  });

  /* 取得 Database、Auth 實例與 Google Provider */
  dbInstance = dbApi.getDatabase(appInstance);
  authInstance = authApi.getAuth(appInstance);
  googleProvider = new authApi.GoogleAuthProvider();
  initialized = true;
}

/* ============================
 * 7. getRef() - 取得 Firebase Realtime Database 參考路徑
 * ============================ */
async function getRef(path){
  await loadFirebaseModules();
  return dbApi.ref(dbInstance, path);
}

/* ============================
 * 8. beep() - 進單提示音
 *    優先播放使用者上傳的自訂音效（base64），
 *    若無自訂音效則播放預設合成提示音（3 輪 3 音）。
 * ============================ */
function beep(){
  try{
    const cfg = ensureRealtimeConfig();
    /* 未啟用提醒聲音則跳過 */
    if(!cfg.incomingSoundEnabled) return;

    /* --- 優先嘗試播放自訂音效 --- */
    if(cfg.customSoundData){
      try{
        const audio = new Audio(cfg.customSoundData);
        audio.volume = 1.0;
        const playPromise = audio.play();
        if(playPromise && typeof playPromise.catch === 'function'){
          playPromise.catch(()=>{
            /* 自訂音效播放失敗（例如瀏覽器阻擋），改用合成音 */
            playDefaultBeep();
          });
        }
        return; /* 自訂音效已開始播放，結束 */
      }catch(e){
        /* 自訂音效建立失敗，改用預設合成音 */
      }
    }

    /* --- 無自訂音效，播放預設合成提示音 --- */
    playDefaultBeep();
  }catch(err){
    console.error('提示音播放失敗：', err);
  }
}

/* 預設合成提示音：3 輪 × 3 個音，square 波形，音量 0.35 */
function playDefaultBeep(){
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx = new AudioCtx();
    const rounds = 3;                       /* 播放 3 輪 */
    const notesPerRound = [880, 1047, 880]; /* 高音 La → 高音 Do → 高音 La */
    const noteLength = 0.15;                /* 每個音長度（秒） */
    const noteGap = 0.18;                   /* 音與音之間的間隔（秒） */
    const roundGap = 0.6;                   /* 每輪之間的間隔（秒） */
    const volume = 0.35;                    /* 音量（0~1） */

    for(let r = 0; r < rounds; r++){
      const roundStart = r * (notesPerRound.length * (noteLength + noteGap) + roundGap);
      notesPerRound.forEach((freq, i)=>{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';          /* square 波形較尖銳、容易聽到 */
        osc.frequency.value = freq;
        gain.gain.value = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const startAt = ctx.currentTime + roundStart + i * (noteLength + noteGap);
        osc.start(startAt);
        osc.stop(startAt + noteLength);
      });
    }
    /* 全部播完後關閉 AudioContext */
    const totalDuration = rounds * (notesPerRound.length * (noteLength + noteGap) + roundGap);
    setTimeout(()=> ctx.close(), (totalDuration + 1) * 1000);
  }catch(err){
    console.error('預設提示音播放失敗：', err);
  }
}

/* ============================
 * 9. 認證相關函式
 * ============================ */

/* POS 使用 Google 帳號登入 */
export async function signInPOSWithGoogle(){
  await loadFirebaseModules();
  const result = await authApi.signInWithPopup(authInstance, googleProvider);
  return result.user;
}

/* POS Google 登出 */
export async function signOutPOSGoogle(){
  await loadFirebaseModules();
  await authApi.signOut(authInstance);
  state.onlineIncomingOrders = [];
  updateSyncStatus('POS Google 已登出');
}

/* 顧客匿名登入（用於線上點餐送單） */
export async function signInCustomerAnonymously(){
  await loadFirebaseModules();
  if(authInstance.currentUser) return authInstance.currentUser;
  const result = await authApi.signInAnonymously(authInstance);
  return result.user;
}

/* 取得目前已登入的 Firebase Auth 使用者 */
export function getRealtimeAuthUser(){
  return authInstance?.currentUser || null;
}

/* 等待 Firebase Auth 初始化完成 */
export async function waitForAuthReady(){
  await loadFirebaseModules();
  return await new Promise(resolve => {
    const unsub = authApi.onAuthStateChanged(authInstance, user => {
      unsub();
      resolve(user || null);
    });
  });
}

/* ============================
 * 10. verifyPOSAccess() - 驗證 POS 是否有 staff 權限
 * ============================ */
export async function verifyPOSAccess(){
  await loadFirebaseModules();
  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');

  /* 查詢 Firebase staff/{uid} 節點 */
  const staffRef = await getRef(`staff/${user.uid}`);
  const snapshot = await dbApi.get(staffRef);
  const staffRow = snapshot.val() || null;
  const role = String(staffRow?.role || '').trim();
  if(role !== 'staff' && role !== 'admin'){
    throw new Error(`Google 已登入，但 Firebase 沒有 POS 權限。請到 Realtime Database 手動建立：staff/${user.uid}/role = "admin"（或 staff），並加入 email 欄位。`);
  }
  return {
    uid: user.uid,
    email: user.email || staffRow?.email || '',
    role
  };
}

/* ============================
 * 11. pushOnlineOrder() - 顧客送出線上訂單到 Firebase
 * ============================ */
export async function pushOnlineOrder(order){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) throw new Error('即時接單尚未啟用');
  /* 顧客端使用匿名登入 */
  const user = await signInCustomerAnonymously();
  const rootRef = await getRef('onlineOrders');
  const newRef = dbApi.push(rootRef);

  /* 寫入訂單資料 */
  await dbApi.set(newRef, Object.assign({}, order, {
    customerUid: user.uid,
    status: 'pending_confirm',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prepTimeMinutes: null,
    estimatedReadyAt: null,
    replyMessage: ''
  }));

  cfg.lastOrderAt = new Date().toISOString();
  cfg.lastSyncStatus = '顧客訂單已送出';
  persistAll();
  return newRef.key;
}

/* ============================
 * 12. watchCustomerOrder() - 顧客監聽自己訂單的狀態變化
 * ============================ */
export async function watchCustomerOrder(orderId, onChange){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const callback = snapshot => onChange(snapshot.val());
  dbApi.onValue(ref, callback);
  return ()=> dbApi.off(ref, 'value', callback);
}

/* ============================
 * 13. startPOSRealtimeListener() - POS 端即時監聽所有線上訂單
 *     新訂單進來時播放提示音並更新 UI
 * ============================ */
export async function startPOSRealtimeListener(onRefresh){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) return;
  await loadFirebaseModules();

  /* 記錄 callback，切回頁面時重連用 */
  lastOnRefreshCallback = onRefresh;

  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user){
    updateSyncStatus('POS 尚未登入 Google');
    return;
  }

  await verifyPOSAccess();
  const ref = await getRef('onlineOrders');

  /* 若之前有監聽器，先移除避免重複 */
  if(posListenerRef && posListenerCallback){
    dbApi.off(posListenerRef, 'value', posListenerCallback);
  }

  /* 已知訂單集合（避免重複提醒） */
  let seen = new Set(JSON.parse(sessionStorage.getItem('pos_seen_online_orders') || '[]'));

  posListenerRef = ref;
  posListenerCallback = snapshot => {
    const value = snapshot.val() || {};
    /* 將所有訂單轉為陣列並依建立時間倒序排列 */
    const incoming = Object.entries(value)
      .map(([id, row]) => ({ id, ...row }))
      .sort((a,b)=> new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    state.onlineIncomingOrders = incoming;

    /* 檢查是否有新的待確認訂單 */
    incoming.forEach(order => {
      if(order.status === 'pending_confirm' && !seen.has(order.id)){
        seen.add(order.id);
        cfg.lastOrderAt = new Date().toISOString();
        cfg.lastSyncStatus = `收到新訂單：${order.customerName || order.orderNo || order.id}`;
        sessionStorage.setItem('pos_seen_online_orders', JSON.stringify([...seen]));
        /* 播放進單提示音（自訂或預設） */
        beep();
      }
    });

    if(!incoming.some(order => order.status === 'pending_confirm')){
      cfg.lastSyncStatus = '即時接單監聽中';
    }

    persistAll();
    if(typeof onRefresh === 'function') onRefresh();
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
  };

  /* 開始監聽，同時處理權限錯誤 */
  dbApi.onValue(ref, posListenerCallback, (error)=>{
    state.onlineIncomingOrders = [];
    cfg.lastSyncStatus = error?.code === 'PERMISSION_DENIED'
      ? '沒有 Firebase staff 權限，請建立 staff/你的uid/role'
      : `即時接單監聽失敗：${error?.message || '未知錯誤'}`;
    persistAll();
    if(typeof onRefresh === 'function') onRefresh();
    if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
  });

  cfg.lastSyncStatus = '即時接單監聽中';
  persistAll();
  if(typeof onRefresh === 'function') onRefresh();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

/* ============================
 * 14. visibilitychange 事件
 *     iPad Safari 在背景分頁會暫停 WebSocket，切回時需要重建監聽
 * ============================ */
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){
    const cfg = ensureRealtimeConfig();
    if(!cfg.enabled) return;
    if(!authInstance?.currentUser) return;
    /* 重新啟動監聽器 */
    startPOSRealtimeListener(lastOnRefreshCallback || (()=> {
      if(typeof window.refreshAllViews === 'function') window.refreshAllViews();
    })).catch(err => console.error('切回頁面重連失敗：', err));
  }
});

/* ============================
 * 15. confirmOnlineOrder() - 店家確認訂單
 * ============================ */
export async function confirmOnlineOrder(orderId, prepTimeMinutes = 0, replyMessage = ''){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const snapshot = await dbApi.get(ref);
  const order = snapshot.val();
  if(!order) throw new Error('找不到訂單');

  const safePrepMinutes = Math.max(0, Number(prepTimeMinutes || 0));
  /* 計算預計完成時間 */
  const estimatedReadyAt = safePrepMinutes > 0
    ? new Date(Date.now() + safePrepMinutes * 60 * 1000).toISOString()
    : null;
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);

  /* 更新訂單狀態為 confirmed */
  await dbApi.update(ref, {
    status: 'confirmed',
    prepTimeMinutes: safePrepMinutes || null,
    estimatedReadyAt: estimatedReadyAt || null,
    replyMessage: safeReplyMessage || null,
    updatedAt: new Date().toISOString()
  });

  const cfg = ensureRealtimeConfig();
  cfg.lastConfirmedAt = new Date().toISOString();
  cfg.lastSyncStatus = `已確認訂單：${order.customerName || order.orderNo || orderId}`;
  persistAll();
  return {
    id: orderId,
    ...order,
    status: 'confirmed',
    prepTimeMinutes: safePrepMinutes,
    estimatedReadyAt,
    replyMessage: safeReplyMessage
  };
}

/* ============================
 * 16. rejectOnlineOrder() - 店家拒絕訂單
 * ============================ */
export async function rejectOnlineOrder(orderId, replyMessage = ''){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);
  await dbApi.update(ref, {
    status: 'rejected',
    replyMessage: safeReplyMessage || '店家目前無法接單，請稍後再試。',
    updatedAt: new Date().toISOString()
  });
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = `已拒絕訂單：${orderId}`;
  persistAll();
}

/* ============================
 * 17. buildRealtimeOrderForPOS() - 將遠端訂單轉換為 POS 內部格式
 * ============================ */
export function buildRealtimeOrderForPOS(remote){
  const items = Array.isArray(remote.items) ? remote.items : [];
  /* 計算小計金額 */
  const subtotal = items.reduce((s, x) => s + ((Number(x.basePrice || 0) + Number(x.extraPrice || 0)) * Number(x.qty || 0)), 0);
  return {
    id: 'online_' + remote.id,
    orderNo: remote.orderNo || ('ON' + Date.now()),
    createdAt: remote.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
    paymentMethod: '待付款',
    orderType: remote.orderType || '線上點餐',
    tableNo: `${remote.customerName || ''}${remote.customerPhone ? ' / ' + remote.customerPhone : ''}`,
    customerName: remote.customerName || '',
    customerPhone: remote.customerPhone || '',
    customerNote: remote.customerNote || '',
    prepTimeMinutes: Number(remote.prepTimeMinutes || 0),
    estimatedReadyAt: remote.estimatedReadyAt || '',
    merchantReplyMessage: remote.replyMessage || '',
    discountType: 'amount',
    discountValue: 0,
    discountAmount: 0,
    subtotal,
    total: subtotal,
    items
  };
}

/* ============================
 * 18. syncMenuToFirebase() - 將本機菜單同步到 Firebase（POS 端呼叫）
 * ============================ */
export async function syncMenuToFirebase(){
  await loadFirebaseModules();
  const user = authInstance.currentUser;
  if(!user) throw new Error('請先 POS Google 登入');
  const menuRef = await getRef('menu');
  await dbApi.set(menuRef, {
    categories: state.categories || [],
    modules: state.modules || [],
    products: (state.products || []).filter(p => p.enabled !== false),
    updatedAt: new Date().toISOString()
  });
}

/* ============================
 * 19. loadMenuFromFirebase() - 從 Firebase 載入菜單（線上點餐端呼叫）
 * ============================ */
export async function loadMenuFromFirebase(){
  await loadFirebaseModules();
  const menuRef = await getRef('menu');
  const snapshot = await dbApi.get(menuRef);
  return snapshot.val() || null;
}
