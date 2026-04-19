import { persistAll } from './core/store.js';
import { renderTabs, renderProducts, renderCart, initPOSPage } from './pages/pos-page.js';
import { renderOrders, initOrdersPage } from './pages/orders-page.js';
import { renderReports, initReportsPage } from './pages/reports-page.js';
import { renderCategoryOptions, renderCategoryList, renderModuleSelect, renderModuleLibrary, renderProductModulesEditor, renderProductsTable, renderPendingMenuList, initProductsPage } from './pages/products-page.js';
import { initSettingsPage } from './pages/settings-page.js';
import { startPOSRealtimeListener, waitForAuthReady } from './modules/realtime-order-service.js';
import { startGoogleAutoBackup } from './modules/google-backup-service.js';

const errorBox = document.createElement('div');
errorBox.id = 'debugErrors';
errorBox.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#d00;color:#fff;padding:10px 14px;font-size:13px;z-index:99999;max-height:35vh;overflow:auto;display:none;white-space:pre-wrap';
document.body.appendChild(errorBox);

function showError(msg){
  errorBox.style.display = 'block';
  errorBox.textContent += msg + '\n';
}

function safeRun(fn, name){
  try { fn(); }
  catch (err) {
    console.error(`Init error in ${name}:`, err);
    showError(`❌ ${name}: ${err.message}\n${err.stack||''}`);
  }
}

function setupNavigation(){
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById(btn.dataset.view)?.classList.add('active');
    });
  });
}

window.refreshAllViews = function(){
  safeRun(renderTabs, 'renderTabs');
  safeRun(renderProducts, 'renderProducts');
  safeRun(renderCart, 'renderCart');
  safeRun(renderOrders, 'renderOrders');
  safeRun(renderReports, 'renderReports');
  safeRun(renderCategoryOptions, 'renderCategoryOptions');
  safeRun(renderCategoryList, 'renderCategoryList');
  safeRun(renderModuleSelect, 'renderModuleSelect');
  safeRun(renderModuleLibrary, 'renderModuleLibrary');
  safeRun(renderProductModulesEditor, 'renderProductModulesEditor');
  safeRun(renderProductsTable, 'renderProductsTable');
  safeRun(renderPendingMenuList, 'renderPendingMenuList');
  persistAll();
};

function setupPWA(){
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installBtn')?.classList.remove('hidden');
  });
  document.getElementById('installBtn')?.addEventListener('click', async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBtn')?.classList.add('hidden');
  });
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=> navigator.serviceWorker.register('./service-worker.js'));
  }
}

async function autoStartRealtimeListener(){
  try{
    const user = await waitForAuthReady();
    if(!user) return;
    await startPOSRealtimeListener(()=> window.refreshAllViews());
  }catch(err){
    console.error('Auto start realtime listener failed:', err);
  }
}

setupNavigation();
safeRun(initPOSPage, 'initPOSPage');
safeRun(initOrdersPage, 'initOrdersPage');
safeRun(initReportsPage, 'initReportsPage');
safeRun(initProductsPage, 'initProductsPage');
safeRun(initSettingsPage, 'initSettingsPage');
window.refreshAllViews();
startGoogleAutoBackup();
autoStartRealtimeListener();
setupPWA();
