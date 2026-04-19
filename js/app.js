import { persistAll } from './core/store.js';
import { renderTabs, renderProducts, renderCart, initPOSPage } from './pages/pos-page.js';
import { renderOrders, initOrdersPage } from './pages/orders-page.js';
import { renderReports, initReportsPage } from './pages/reports-page.js';
import { renderCategoryOptions, renderCategoryList, renderModuleSelect, renderModuleLibrary, renderProductModulesEditor, renderProductsTable, renderPendingMenuList, initProductsPage } from './pages/products-page.js';
import { initSettingsPage } from './pages/settings-page.js';
import { startPOSRealtimeListener, waitForAuthReady } from './modules/realtime-order-service.js';
import { startGoogleAutoBackup } from './modules/google-backup-service.js';

function safeRun(fn, name){
  try { fn(); }
  catch (err) {
    console.error('Init error in ' + name + ':', err);
    alert('ERROR in ' + name + ': ' + err.message);
  }
}

function setupNavigation(){
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      var target = document.getElementById(btn.dataset.view);
      if(target) target.classList.add('active');
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

setupNavigation();
safeRun(initPOSPage, 'initPOSPage');
safeRun(initOrdersPage, 'initOrdersPage');
safeRun(initReportsPage, 'initReportsPage');
safeRun(initProductsPage, 'initProductsPage');
safeRun(initSettingsPage, 'initSettingsPage');
window.refreshAllViews();
startGoogleAutoBackup();

waitForAuthReady().then(function(user){
  if(!user) return;
  return startPOSRealtimeListener(function(){ window.refreshAllViews(); });
}).catch(function(err){
  console.error('Auto start realtime listener failed:', err);
});
