/* 中文備註：Firebase 即時接單服務。顧客匿名送單，POS 端使用 Google 登入接單，並搭配安全規則。 */
/* 新增功能：切回頁面自動重連 Firebase、加強進單提示音（更大聲、重複 3 輪） */
import { state, persistAll } from '../core/store.js';

const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
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
let appInstance = null;
let dbInstance = null;
let dbApi = null;
let authApi = null;
let authInstance = null;
let googleProvider = null;
let initialized = false;
let posListenerRef = null;
let posListenerCallback = null;
/* 記錄最後一次的 onRefresh callback，切回頁面時重連用 */
let lastOnRefreshCallback = null;

function ensureRealtimeConfig(){
  if(!state.settings) state.settings = {};
  const current = state.settings.realtimeOrder || {};
  state.settings.realtimeOrder = {
    enabled: typeof current.enabled === 'boolean' ? current.enabled : DEFAULT_FIREBASE_CONFIG.enabled,
    apiKey: String(current.apiKey || '').trim() || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: String(current.authDomain || '').trim() || DEFAULT_FIREBASE_CONFIG.authDomain,
    databaseURL: String(current.databaseURL || '').trim() || DEFAULT_FIREBASE_CONFIG.databaseURL,
    projectId: String(current.projectId || '').trim() || DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket: String(current.storageBucket || '').trim() || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: String(current.messagingSenderId || '').trim() || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: String(current.appId || '').trim() || DEFAULT_FIREBASE_CONFIG.appId,
    measurementId: String(current.measurementId || '').trim() || DEFAULT_FIREBASE_CONFIG.measurementId,
    onlineStoreTitle: current.onlineStoreTitle || '',
    onlineStoreSubtitle: current.onlineStoreSubtitle || '',
    autoPrintKitchenOnConfirm: current.autoPrintKitchenOnConfirm !== false,
    autoPrintReceiptOnConfirm: !!current.autoPrintReceiptOnConfirm,
    incomingSoundEnabled: current.incomingSoundEnabled !== false,
    lastSyncStatus: current.lastSyncStatus || '尚未啟用',
    lastOrderAt: current.lastOrderAt || '',
    lastConfirmedAt: current.lastConfirmedAt || ''
  };
  return state.settings.realtimeOrder;
}

function updateSyncStatus(message){
  const cfg = ensureRealtimeConfig();
  cfg.lastSyncStatus = message;
  persistAll();
  if(typeof window.refreshRealtimeOrderPanel === 'function') window.refreshRealtimeOrderPanel();
}

export function getRealtimeConfig(){
  return ensureRealtimeConfig();
}

async function loadFirebaseModules(){
  if(initialized) return;
  const appMod = await import(`${FIREBASE_BASE}/firebase-app.js`);
  dbApi = await import(`${FIREBASE_BASE}/firebase-database.js`);
  authApi = await import(`${FIREBASE_BASE}/firebase-auth.js`);

  const cfg = ensureRealtimeConfig();
  if(!cfg.apiKey || !cfg.databaseURL || !cfg.projectId || !cfg.appId){
    throw new Error('請先完整設定 Firebase');
  }

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

  dbInstance = dbApi.getDatabase(appInstance);
  authInstance = authApi.getAuth(appInstance);
  googleProvider = new authApi.GoogleAuthProvider();
  initialized = true;
}

async function getRef(path){
  await loadFirebaseModules();
  return dbApi.ref(dbInstance, path);
}

/* === 進單提示音：更大聲、播放 3 輪、每輪 3 個音、總長約 2.5 秒 === */
function beep(){
  try{
    const cfg = ensureRealtimeConfig();
    if(!cfg.incomingSoundEnabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx = new AudioCtx();
    /* 3 輪提示音，每輪間隔 0.8 秒 */
    const rounds = 3;
    const notesPerRound = [880, 1047, 880]; /* 高音 La、高音 Do、高音 La */
    const noteLength = 0.15;    /* 每個音的長度（秒） */
    const noteGap = 0.18;       /* 音與音之間的間隔（秒） */
    const roundGap = 0.6;       /* 每輪之間的間隔（秒） */
    const volume = 0.35;        /* 音量（0~1，原本 0.05 太小聲） */

    for(let r = 0; r < rounds; r++){
      const roundStart = r * (notesPerRound.length * (noteLength + noteGap) + roundGap);
      notesPerRound.forEach((freq, i)=>{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square'; /* square 波形比 sine 更尖銳、更容易聽到 */
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
    console.error('提示音播放失敗：', err);
  }
}

export async function signInPOSWithGoogle(){
  await loadFirebaseModules();
  const result = await authApi.signInWithPopup(authInstance, googleProvider);
  return result.user;
}

export async function signOutPOSGoogle(){
  await loadFirebaseModules();
  await authApi.signOut(authInstance);
  state.onlineIncomingOrders = [];
  updateSyncStatus('POS Google 已登出');
}

export async function signInCustomerAnonymously(){
  await loadFirebaseModules();
  if(authInstance.currentUser) return authInstance.currentUser;
  const result = await authApi.signInAnonymously(authInstance);
  return result.user;
}

export function getRealtimeAuthUser(){
  return authInstance?.currentUser || null;
}

export async function waitForAuthReady(){
  await loadFirebaseModules();
  return await new Promise(resolve => {
    const unsub = authApi.onAuthStateChanged(authInstance, user => {
      unsub();
      resolve(user || null);
    });
  });
}

export async function verifyPOSAccess(){
  await loadFirebaseModules();
  const user = authInstance.currentUser || await waitForAuthReady();
  if(!user) throw new Error('請先使用 POS Google 登入');

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

export async function pushOnlineOrder(order){
  const cfg = ensureRealtimeConfig();
  if(!cfg.enabled) throw new Error('即時接單尚未啟用');
  const user = await signInCustomerAnonymously();
  const rootRef = await getRef('onlineOrders');
  const newRef = dbApi.push(rootRef);

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

export async function watchCustomerOrder(orderId, onChange){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const callback = snapshot => onChange(snapshot.val());
  dbApi.onValue(ref, callback);
  return ()=> dbApi.off(ref, 'value', callback);
}

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

  let seen = new Set(JSON.parse(sessionStorage.getItem('pos_seen_online_orders') || '[]'));

  posListenerRef = ref;
  posListenerCallback = snapshot => {
    const value = snapshot.val() || {};
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
        /* 播放進單提示音 */
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

/* === 頁面切回前景時自動重新連線 Firebase 監聽器 === */
/* iPad Safari 在背景分頁會暫停 WebSocket，切回時需要重建監聽 */
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

export async function confirmOnlineOrder(orderId, prepTimeMinutes = 0, replyMessage = ''){
  const ref = await getRef(`onlineOrders/${orderId}`);
  const snapshot = await dbApi.get(ref);
  const order = snapshot.val();
  if(!order) throw new Error('找不到訂單');

  const safePrepMinutes = Math.max(0, Number(prepTimeMinutes || 0));
  const estimatedReadyAt = safePrepMinutes > 0
    ? new Date(Date.now() + safePrepMinutes * 60 * 1000).toISOString()
    : null;
  const safeReplyMessage = String(replyMessage || '').trim().slice(0, 120);

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

export function buildRealtimeOrderForPOS(remote){
  const items = Array.isArray(remote.items) ? remote.items : [];
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

/* === 同步菜單到 Firebase（POS 端呼叫） === */
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

/* === 從 Firebase 載入菜單（線上點餐端呼叫） === */
export async function loadMenuFromFirebase(){
  await loadFirebaseModules();
  const menuRef = await getRef('menu');
  const snapshot = await dbApi.get(menuRef);
  return snapshot.val() || null;
}
