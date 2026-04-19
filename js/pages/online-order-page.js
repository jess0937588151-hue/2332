/* 中文備註：線上點餐頁邏輯，顧客送單後會等待 POS 確認，確認後才完成訂購。 */
/* 功能：雲端菜單自動同步（每30秒）、顧客資料記憶、模組選擇、購物車、送單。 */
import { state } from '../core/store.js';
import { escapeHtml, id, money } from '../core/utils.js';
import { getRealtimeConfig, pushOnlineOrder, watchCustomerOrder, loadMenuFromFirebase } from '../modules/realtime-order-service.js';

/* === 線上點餐頁面的狀態 === */
const onlineState = {
  selectedCategory: '全部',  /* 目前選中的分類 */
  cart: [],                   /* 購物車內容 */
  currentSelections: {},      /* 模組選項的目前選擇 */
  configTarget: null          /* 正在設定的商品（新增或編輯） */
};

/* === 底部浮動提示訊息 === */
function showOnlineToast(message){
  let toast = document.getElementById('onlineToast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'onlineToast';
    toast.className = 'online-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showOnlineToast._timer);
  showOnlineToast._timer = setTimeout(()=> toast.classList.remove('show'), 1600);
}

/* === 取得店家名稱與副標題 === */
function getStoreName(){
  return state.settings?.realtimeOrder?.onlineStoreTitle || state.settings?.printConfig?.storeName || '立即點餐';
}

function getStoreMeta(){
  return state.settings?.realtimeOrder?.onlineStoreSubtitle || '內用 / 外帶皆可';
}

/* === 建立模組選項的初始狀態（單選為 null，多選為空陣列） === */
function createConfigState(product){
  const selections = {};
  for(const att of product.modules || []){
    const mod = state.modules.find(m => m.id === att.moduleId);
    if(mod) selections[mod.id] = mod.selection === 'multi' ? [] : null;
  }
  return selections;
}

/* === 將目前的模組選擇轉成扁平陣列（用於儲存到購物車） === */
function flattenSelections(product){
  const rows = [];
  for(const att of product.modules || []){
    const mod = state.modules.find(m => m.id === att.moduleId);
    if(!mod) continue;
    const val = onlineState.currentSelections[mod.id];
    if(Array.isArray(val)){
      val.forEach(idv=>{
        const opt = mod.options.find(o=>o.id===idv);
        if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
      });
    }else if(val){
      const opt = mod.options.find(o=>o.id===val);
      if(opt) rows.push({moduleId:mod.id, moduleName:mod.name, optionId:opt.id, optionName:opt.name, price:opt.price});
    }
  }
  return rows;
}

/* === 比較兩組選項是否相同（用於合併購物車相同品項） === */
function sameSelections(a=[], b=[]){
  if(a.length !== b.length) return false;
  const format = rows => rows.map(x=>`${x.moduleId}:${x.optionId}`).sort().join('|');
  return format(a) === format(b);
}

/* === 合併或新增購物車品項（相同商品+相同選項+相同備註 → 數量合併） === */
function mergeOrPushCartItem(payload){
  const existing = onlineState.cart.find(item =>
    item.productId === payload.productId &&
    String(item.note || '') === String(payload.note || '') &&
    Number(item.basePrice || 0) === Number(payload.basePrice || 0) &&
    Number(item.extraPrice || 0) === Number(payload.extraPrice || 0) &&
    sameSelections(item.selections || [], payload.selections || [])
  );
  if(existing) existing.qty += payload.qty;
  else onlineState.cart.push(payload);
}

/* === 渲染分類標籤列 === */
function renderCategoryTabs(){
  const wrap = document.getElementById('onlineCategoryTabs');
  const categories = ['全部', ...state.categories.filter(c => c && c !== '全部')];
  wrap.innerHTML = categories.map(c => `<button class="online-category-chip ${onlineState.selectedCategory===c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  wrap.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{
      onlineState.selectedCategory = btn.dataset.category;
      renderCategoryTabs();
      renderProducts();
    };
  });
}

/* === 渲染商品列表（依分類與搜尋關鍵字過濾） === */
function renderProducts(){
  const keyword = document.getElementById('onlineSearchInput').value.trim();
  const grid = document.getElementById('onlineProductGrid');
  const list = [...state.products].sort((a,b)=>a.sortOrder-b.sortOrder).filter(p=>{
    if(p.enabled === false) return false;
    const catOk = onlineState.selectedCategory === '全部' || p.category === onlineState.selectedCategory;
    const kwOk = !keyword || [p.name, p.category, ...(p.aliases||[])].join(' ').includes(keyword);
    return catOk && kwOk;
  });
  if(!list.length){
    grid.innerHTML = '<div class="online-empty card">目前沒有符合的商品</div>';
    return;
  }
  grid.innerHTML = '';
  list.forEach(p=>{
    const moduleNames = (p.modules||[]).map(att=> state.modules.find(m=>m.id===att.moduleId)?.name).filter(Boolean);
    const card = document.createElement('div');
    card.className = 'online-product-card';
    card.innerHTML = `
      ${p.image ? `<div class="online-product-image"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"></div>` : '<div class="online-product-image"></div>'}
      <div class="online-product-body">
        <div class="online-product-name">${escapeHtml(p.name)}</div>
        <div class="online-product-price">${money(p.price)}</div>
        <div class="online-product-meta">${escapeHtml(p.category)}${moduleNames.length ? '・' + escapeHtml(moduleNames.join('/')) : ''}</div>
        <div class="online-product-footer"><button class="primary-btn full">加入購物車</button></div>
      </div>
    `;
    card.querySelector('button').onclick = ()=> openProductConfigForNew(p.id);
    grid.appendChild(card);
  });
}

/* === 更新商品設定視窗中的小計金額預覽 === */
function updateItemPricePreview(product){
  let add = 0;
  const selections = flattenSelections(product);
  selections.forEach(s=> add += Number(s.price || 0));
  const qty = Math.max(1, Number(document.getElementById('onlineItemQtyInput').value || 1));
  document.getElementById('onlineItemPricePreview').textContent = '小計：' + money((Number(product.price||0) + add) * qty);
}

/* === 渲染商品模組設定（灑粉、辣度等選項按鈕） === */
function renderProductConfig(product){
  document.getElementById('onlineModalTitle').textContent = product.name + ' - 設定';
  const imageWrap = document.getElementById('onlineModalImageWrap');
  imageWrap.innerHTML = product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">` : '';
  imageWrap.classList.toggle('hidden', !product.image);

  const wrap = document.getElementById('onlineModalModules');
  wrap.innerHTML = '';
  (product.modules || []).forEach(att=>{
    const mod = state.modules.find(m=>m.id===att.moduleId);
    if(!mod) return;
    const required = att.requiredOverride === null ? mod.required : att.requiredOverride;
    const block = document.createElement('div');
    block.className = 'module-block';
    block.innerHTML = `
      <div class="module-header">
        <div>
          <strong>${escapeHtml(mod.name)}</strong>
          <div class="muted">${required ? '必選' : '非必選'}・${mod.selection === 'multi' ? '多選' : '單選'}</div>
        </div>
      </div>
      <div class="option-list"></div>
    `;
    const list = block.querySelector('.option-list');
    mod.options.filter(o=>o.enabled!==false).forEach(opt=>{
      const active = Array.isArray(onlineState.currentSelections[mod.id])
        ? onlineState.currentSelections[mod.id].includes(opt.id)
        : onlineState.currentSelections[mod.id] === opt.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-chip' + (active ? ' active' : '');
      btn.innerHTML = `<span>${escapeHtml(opt.name)}</span><strong>${opt.price ? '+' + money(opt.price) : money(0)}</strong>`;
      btn.onclick = ()=>{
        if(mod.selection === 'multi'){
          /* 多選：切換選取狀態 */
          const arr = onlineState.currentSelections[mod.id] || [];
          if(arr.includes(opt.id)) onlineState.currentSelections[mod.id] = arr.filter(x=>x!==opt.id);
          else onlineState.currentSelections[mod.id] = [...arr, opt.id];
        } else {
          /* 單選：再點一次取消 */
          onlineState.currentSelections[mod.id] = onlineState.currentSelections[mod.id] === opt.id ? null : opt.id;
        }
        renderProductConfig(product);
      };
      list.appendChild(btn);
    });
    wrap.appendChild(block);
  });
  updateItemPricePreview(product);
}

/* === 點擊商品「加入購物車」→ 開啟模組設定視窗（新增模式） === */
function openProductConfigForNew(productId){
  const product = state.products.find(p=>p.id===productId && p.enabled!==false);
  if(!product) return;
  onlineState.configTarget = { mode:'new', productId };
  onlineState.currentSelections = createConfigState(product);
  document.getElementById('onlineItemNoteInput').value = '';
  document.getElementById('onlineItemQtyInput').value = 1;
  renderProductConfig(product);
  document.getElementById('onlineProductModal').classList.remove('hidden');
}

/* === 購物車中點「編輯」→ 開啟模組設定視窗（編輯模式） === */
function openProductConfigForEdit(rowId){
  const item = onlineState.cart.find(x=>x.rowId===rowId);
  if(!item) return;
  const product = state.products.find(p=>p.id===item.productId && p.enabled!==false);
  if(!product) return;
  onlineState.configTarget = { mode:'edit', rowId, productId:item.productId };
  onlineState.currentSelections = createConfigState(product);
  /* 還原先前選擇的模組選項 */
  (item.selections || []).forEach(sel=>{
    if(Array.isArray(onlineState.currentSelections[sel.moduleId])) onlineState.currentSelections[sel.moduleId].push(sel.optionId);
    else onlineState.currentSelections[sel.moduleId] = sel.optionId;
  });
  document.getElementById('onlineItemNoteInput').value = item.note || '';
  document.getElementById('onlineItemQtyInput').value = item.qty || 1;
  renderProductConfig(product);
  document.getElementById('onlineProductModal').classList.remove('hidden');
}

/* === 關閉模組設定視窗 === */
function closeProductConfig(){
  document.getElementById('onlineProductModal').classList.add('hidden');
  onlineState.configTarget = null;
  onlineState.currentSelections = {};
}

/* === 渲染購物車清單 === */
function renderCart(){
  const list = document.getElementById('onlineCartList');
  list.innerHTML = '';
  if(!onlineState.cart.length){
    list.innerHTML = '<div class="online-empty">尚未加入商品</div>';
  }else{
    onlineState.cart.forEach(item=>{
      const desc = (item.selections||[]).map(s=> `${s.moduleName}:${s.optionName}`).join(' / ');
      const row = document.createElement('div');
      row.className = 'online-cart-item';
      row.innerHTML = `
        <div class="row between wrap">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            ${desc ? `<div class="muted">${escapeHtml(desc)}</div>` : ''}
            ${item.note ? `<div class="muted">備註：${escapeHtml(item.note)}</div>` : ''}
          </div>
          <strong>${money((item.basePrice + item.extraPrice) * item.qty)}</strong>
        </div>
        <div class="row gap wrap" style="margin-top:10px">
          <button class="secondary-btn small-btn minus-btn">-</button>
          <span>${item.qty}</span>
          <button class="secondary-btn small-btn plus-btn">+</button>
          <button class="secondary-btn small-btn edit-btn">編輯</button>
          <button class="danger-btn small-btn delete-btn">刪除</button>
        </div>
      `;
      row.querySelector('.minus-btn').onclick = ()=>{ item.qty = Math.max(1, item.qty - 1); renderCart(); };
      row.querySelector('.plus-btn').onclick = ()=>{ item.qty += 1; renderCart(); };
      row.querySelector('.edit-btn').onclick = ()=> openProductConfigForEdit(item.rowId);
      row.querySelector('.delete-btn').onclick = ()=>{ onlineState.cart = onlineState.cart.filter(x => x.rowId !== item.rowId); renderCart(); };
      list.appendChild(row);
    });
  }
  /* 更新小計與總數量 */
  const subtotal = onlineState.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const totalQty = onlineState.cart.reduce((s,x)=>s + x.qty, 0);
  document.getElementById('onlineSubtotalText').textContent = money(subtotal);
  document.getElementById('onlineTotalQtyText').textContent = String(totalQty);
  document.getElementById('openCartBtn').innerHTML = `購物車 <span id="cartQtyBadge">${totalQty}</span>`;
}

/* === 購物車抽屜開關 === */
function openCartDrawer(){ document.getElementById('onlineCartDrawer').classList.remove('hidden'); }
function closeCartDrawer(){ document.getElementById('onlineCartDrawer').classList.add('hidden'); }

/* === 訂單狀態遮罩（等待確認 / 已確認 / 已拒絕） === */
function openStatusOverlay(title, text, closable = false){
  document.getElementById('onlineOrderStatusTitle').textContent = title;
  document.getElementById('onlineOrderStatusText').textContent = text;
  document.getElementById('closeOnlineStatusBtn').classList.toggle('hidden', !closable);
  document.getElementById('onlineOrderStatusOverlay').classList.remove('hidden');
}
function closeStatusOverlay(){ document.getElementById('onlineOrderStatusOverlay').classList.add('hidden'); }

/* === 格式化日期時間文字 === */
function formatDateTimeText(isoString){
  if(!isoString) return '';
  const date = new Date(isoString);
  if(Number.isNaN(date.getTime())) return String(isoString).replace('T',' ').slice(0,16);
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/* === 組合店家確認訂單後的回覆訊息 === */
function buildConfirmedMessage(remote, orderId){
  const parts = [`訂單編號：${remote.orderNo || orderId}`];
  if(remote.prepTimeMinutes) parts.push(`預估備餐 ${remote.prepTimeMinutes} 分鐘`);
  if(remote.estimatedReadyAt) parts.push(`預計完成時間：${formatDateTimeText(remote.estimatedReadyAt)}`);
  if(remote.replyMessage) parts.push(remote.replyMessage);
  return parts.join('，');
}

/* === 顧客資料記憶功能（使用 localStorage 儲存姓名、電話、訂單類型） === */
function loadCustomerInfo(){
  try{
    const saved = JSON.parse(localStorage.getItem('onlineCustomerInfo') || '{}');
    if(saved.name) document.getElementById('onlineCustomerName').value = saved.name;
    if(saved.phone) document.getElementById('onlineCustomerPhone').value = saved.phone;
    if(saved.orderType) document.getElementById('onlineOrderType').value = saved.orderType;
  }catch(e){}
}

function saveCustomerInfo(){
  try{
    localStorage.setItem('onlineCustomerInfo', JSON.stringify({
      name: document.getElementById('onlineCustomerName').value.trim(),
      phone: document.getElementById('onlineCustomerPhone').value.trim(),
      orderType: document.getElementById('onlineOrderType').value
    }));
  }catch(e){}
}

/* === 送出線上訂單到 Firebase === */
async function submitOnlineOrder(){
  if(!onlineState.cart.length) return alert('請先加入商品');
  const name = document.getElementById('onlineCustomerName').value.trim();
  const phone = document.getElementById('onlineCustomerPhone').value.trim();
  const customerNote = document.getElementById('onlineCustomerNote').value.trim();
  const orderType = document.getElementById('onlineOrderType').value || '外帶';
  if(!name) return alert('請輸入姓名');
  if(!phone) return alert('請輸入電話');

  /* 送單時也儲存顧客資料 */
  saveCustomerInfo();

  const realtimeCfg = getRealtimeConfig();
  if(!realtimeCfg.enabled) return alert('店家尚未啟用即時接單');

  const subtotal = onlineState.cart.reduce((s,x)=>s + (x.basePrice + x.extraPrice) * x.qty, 0);
  const payload = {
    orderNo: 'ON' + Date.now(),
    customerName: name,
    customerPhone: phone,
    customerNote,
    orderType: '線上點餐-' + orderType,
    items: JSON.parse(JSON.stringify(onlineState.cart)),
    subtotal,
    total: subtotal
  };

  try{
    openStatusOverlay('等待店家確認訂單', '送出後請稍候，店家確認後才算完成訂購。');
    const orderId = await pushOnlineOrder(payload);
    /* 監聽此筆訂單的狀態變化（確認 / 拒絕） */
    const stopWatch = await watchCustomerOrder(orderId, (remote)=>{
      if(!remote) return;
      if(remote.status === 'confirmed'){
        /* 店家已確認 → 清空購物車，顯示確認訊息 */
        onlineState.cart = [];
        renderCart();
        closeCartDrawer();
        document.getElementById('onlineCustomerNote').value = '';
        openStatusOverlay('店家已確認訂單', buildConfirmedMessage(remote, orderId), true);
        stopWatch();
      }else if(remote.status === 'rejected'){
        /* 店家已拒絕 → 顯示拒絕訊息 */
        openStatusOverlay('店家已拒絕訂單', remote.replyMessage || '很抱歉，店家目前無法接單，請稍後再試。', true);
        stopWatch();
      }else{
        /* 仍在等待中 */
        const pendingText = remote.replyMessage || '訂單已送出，請稍候店家確認。';
        openStatusOverlay('等待店家確認訂單', pendingText);
      }
    });
  }catch(err){
    closeStatusOverlay();
    alert(err.message || '送出訂單失敗');
  }
}

/* === 從 Firebase 雲端拉取最新菜單並更新頁面 === */
async function refreshMenuFromCloud(){
  try{
    const menu = await loadMenuFromFirebase();
    if(menu){
      if(Array.isArray(menu.categories)) state.categories = menu.categories;
      if(Array.isArray(menu.modules)) state.modules = menu.modules;
      if(Array.isArray(menu.products)) state.products = menu.products;
      /* 重新渲染分類與商品列表 */
      renderCategoryTabs();
      renderProducts();
    }
  }catch(e){
    console.error('載入雲端菜單失敗，使用本機資料', e);
  }
}

/* === 頁面初始化 === */
async function init(){
  document.getElementById('onlineStoreName').textContent = getStoreName();
  document.getElementById('onlineStoreMeta').textContent = getStoreMeta();

  /* 首次載入：從 Firebase 取得最新菜單 */
  await refreshMenuFromCloud();

  /* 每 30 秒自動從雲端更新菜單（POS 同步後顧客端自動生效） */
  setInterval(async ()=>{
    try{ await refreshMenuFromCloud(); }catch(e){}
  }, 30000);

  renderCategoryTabs();
  renderProducts();
  renderCart();
  /* 自動帶入上次填寫的顧客資料 */
  loadCustomerInfo();

  /* 顧客輸入姓名、電話、訂單類型時自動儲存 */
  document.getElementById('onlineCustomerName').addEventListener('input', saveCustomerInfo);
  document.getElementById('onlineCustomerPhone').addEventListener('input', saveCustomerInfo);
  document.getElementById('onlineOrderType').addEventListener('change', saveCustomerInfo);

  /* 商品搜尋 */
  document.getElementById('onlineSearchInput').addEventListener('input', renderProducts);
  /* 數量變更時更新小計預覽 */
  document.getElementById('onlineItemQtyInput').addEventListener('input', ()=>{
    const p = state.products.find(x=>x.id===onlineState.configTarget?.productId);
    if(p) updateItemPricePreview(p);
  });

  /* 購物車抽屜按鈕 */
  document.getElementById('openCartBtn').onclick = openCartDrawer;
  document.getElementById('closeCartBtn').onclick = closeCartDrawer;
  document.querySelector('.online-drawer-backdrop').onclick = closeCartDrawer;

  /* 模組設定視窗按鈕 */
  document.getElementById('closeOnlineProductModal').onclick = closeProductConfig;
  document.getElementById('cancelOnlineProductBtn').onclick = closeProductConfig;
  document.querySelector('#onlineProductModal .modal-backdrop').onclick = closeProductConfig;

  /* 模組設定視窗「加入購物車」按鈕 */
  document.getElementById('saveOnlineProductBtn').onclick = ()=>{
    const product = state.products.find(p=>p.id===onlineState.configTarget?.productId);
    if(!product) return closeProductConfig();
    /* 檢查必選模組是否已選擇 */
    for(const att of product.modules || []){
      const mod = state.modules.find(m=>m.id===att.moduleId);
      if(!mod) continue;
      const required = att.requiredOverride === null ? mod.required : att.requiredOverride;
      const val = onlineState.currentSelections[mod.id];
      const missing = Array.isArray(val) ? val.length === 0 : !val;
      if(required && missing) return alert(`請先選擇「${mod.name}」`);
    }
    const selections = flattenSelections(product);
    const extra = selections.reduce((s,x)=>s + Number(x.price||0), 0);
    const payload = {
      rowId: onlineState.configTarget?.mode === 'edit' ? onlineState.configTarget.rowId : id(),
      productId: product.id,
      name: product.name,
      basePrice: Number(product.price||0),
      qty: Math.max(1, Number(document.getElementById('onlineItemQtyInput').value || 1)),
      note: document.getElementById('onlineItemNoteInput').value.trim(),
      selections,
      extraPrice: extra
    };
    if(onlineState.configTarget?.mode === 'edit'){
      /* 編輯模式：更新購物車中的該筆品項 */
      const idx = onlineState.cart.findIndex(x=>x.rowId===onlineState.configTarget.rowId);
      if(idx >= 0) onlineState.cart[idx] = payload;
      showOnlineToast('已更新購物車商品');
    }else{
      /* 新增模式：合併或加入購物車 */
      mergeOrPushCartItem(payload);
      showOnlineToast('已加入購物車');
    }
    closeProductConfig();
    renderCart();
  };

  /* 送出訂單按鈕 */
  document.getElementById('submitOnlineOrderBtn').onclick = submitOnlineOrder;
  /* 訂單狀態遮罩關閉按鈕 */
  document.getElementById('closeOnlineStatusBtn').onclick = closeStatusOverlay;
}
init();
