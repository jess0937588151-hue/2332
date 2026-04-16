/* 中文備註：js/pages/orders-page.js，此檔已加入中文說明，方便後續維護。 */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, deepCopy, money } from '../core/utils.js';
import { printKitchenCopies, printOrderLabels, printOrderReceipt } from '../modules/print-service.js';

export function getFilteredOrders(){
  const kw = document.getElementById('orderItemSearch').value.trim();
  const from = document.getElementById('orderDateFrom').value;
  const to = document.getElementById('orderDateTo').value;
  const min = Number(document.getElementById('orderMinAmount').value || 0);
  const maxInput = document.getElementById('orderMaxAmount').value;
  const max = maxInput === '' ? null : Number(maxInput);
  const paymentMethod = document.getElementById('orderPaymentMethodFilter').value;

  return state.orders.filter(o=>{
    const itemText = o.items.map(i=> [i.name, ...(i.selections||[]).map(s=>s.optionName), i.note||''].join(' ')).join(' ');
    const kwOk = !kw || itemText.includes(kw);
    const d = o.createdAt.slice(0,10);
    const dateOk = (!from || d >= from) && (!to || d <= to);
    const amtOk = o.total >= min && (max === null || o.total <= max);
    const paymentOk = !paymentMethod || o.paymentMethod === paymentMethod;
    return kwOk && dateOk && amtOk && paymentOk;
  }).sort((a,b)=> new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function loadOrderToCart(orderId){
  const o = state.orders.find(x=>x.id===orderId);
  if(!o) return;
  state.cart = deepCopy(o.items);
  state.editingOrderId = o.id;
  document.getElementById('orderType').value = o.orderType || '內用';
  document.getElementById('tableNo').value = o.tableNo || '';
  document.getElementById('discountValue').value = o.discountValue || 0;
  state.settings.discountType = o.discountType || 'amount';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="posView"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('posView').classList.add('active');
  window.refreshAllViews();
  alert('已載回點餐頁，可修改後重新結帳');
}

function renderOrdersSection(wrap, orders, isPending){
  wrap.innerHTML = '';
  if(!orders.length){
    wrap.innerHTML = '<div class="muted">沒有資料</div>';
    return;
  }
  orders.forEach(o=>{
    const row = document.createElement('div');
    row.className = 'order-card' + (isPending ? ' pending' : '');
    row.innerHTML = `
      <div class="row between wrap">
        <div>
          <strong>${escapeHtml(o.orderNo)}</strong>
          <span class="badge ${isPending ? 'pending' : 'done'}">${isPending ? '待付款' : '已完成'}</span>
          <div class="muted">${o.createdAt.replace('T',' ').slice(0,16)} ・ ${escapeHtml(o.orderType)} ${o.tableNo ? '・' + escapeHtml(o.tableNo) : ''}${!isPending && o.paymentMethod ? ' ・ 付款：' + escapeHtml(o.paymentMethod) : ''}</div>
        </div>
        <div><strong>${money(o.total)}</strong></div>
      </div>
      <div class="stack small" style="margin-top:12px">
        ${o.items.map(i=>{
          const desc = (i.selections||[]).map(s=>`${s.moduleName}:${s.optionName}`).join(' / ');
          return `<div>${escapeHtml(i.name)}${desc ? ' / ' + escapeHtml(desc) : ''} x ${i.qty}${i.note ? '（' + escapeHtml(i.note) + '）' : ''}</div>`;
        }).join('')}
      </div>
      <div class="row gap wrap" style="margin-top:12px">
        <button class="secondary-btn small-btn">修改</button>
        <button class="danger-btn small-btn">刪除</button>
        <button class="secondary-btn small-btn">列印顧客單</button>
        <button class="secondary-btn small-btn">列印廚房單</button>
        <button class="secondary-btn small-btn">列印標籤</button>
        ${isPending ? '<button class="primary-btn small-btn">改為已付款</button>' : ''}
      </div>
    `;
    const btns = row.querySelectorAll('button');
    btns[0].onclick = ()=> loadOrderToCart(o.id);
    btns[1].onclick = ()=>{
      if(!confirm(`確定刪除訂單「${o.orderNo}」？`)) return;
      state.orders = state.orders.filter(x=>x.id!==o.id);
      persistAll();
      window.refreshAllViews();
    };
    btns[2].onclick = ()=> printOrderReceipt(o, 'customer');
    btns[3].onclick = ()=> printKitchenCopies(o);
    btns[4].onclick = ()=> printOrderLabels(o);
    if(isPending && btns[5]){
      btns[5].onclick = ()=>{
        document.getElementById('paymentTargetMode').value = 'pending';
        document.getElementById('paymentTargetOrderId').value = o.id;
        document.getElementById('paymentModal').classList.remove('hidden');
      };
    }
    wrap.appendChild(row);
  });
}

export function renderOrders(){
  const list = getFilteredOrders();
  renderOrdersSection(document.getElementById('pendingOrdersList'), list.filter(o=>o.status==='pending'), true);
  renderOrdersSection(document.getElementById('completedOrdersList'), list.filter(o=>o.status!=='pending'), false);
}

export function initOrdersPage(){
  ['orderItemSearch','orderDateFrom','orderDateTo','orderMinAmount','orderMaxAmount'].forEach(idv=>{
    document.getElementById(idv).addEventListener('input', renderOrders);
  });
  document.getElementById('orderPaymentMethodFilter').addEventListener('change', renderOrders);
  document.getElementById('clearOrderFiltersBtn').onclick = ()=>{
    ['orderItemSearch','orderDateFrom','orderDateTo','orderMinAmount','orderMaxAmount','orderPaymentMethodFilter'].forEach(idv=> document.getElementById(idv).value = '');
    renderOrders();
  };
}