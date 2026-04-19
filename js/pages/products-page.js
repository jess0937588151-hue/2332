/*
 * ====================================================================
 * 中文備註：商品管理頁程式（products-page.js）
 * ====================================================================
 * 目錄：
 *   1. 匯入模組
 *   2. 工具函式（模組摘要、圖片壓縮裁切、表單驗證）
 *   3. Excel 匯入工具
 *   4. 分類列表 / 模組列表 / 模組選擇器
 *   5. 商品表單圖片預覽
 *   6. 商品模組編輯器
 *   7. 商品列表（多欄網格卡片 + 縮圖）
 *   8. 待處理菜單
 *   9. 商品表單操作
 *  10. initProductsPage() 初始化
 * ====================================================================
 */

/* ============================
 * 1. 匯入模組
 * ============================ */
import { state, persistAll } from '../core/store.js';
import { escapeHtml, escapeAttr, money, id, deepCopy } from '../core/utils.js';
import { openCategoryManage, closeCategoryManage, renderCategoryManage, saveCategoryManage } from '../modules/product-category-manager.js';
import { openModuleManage, closeModuleManage, renderModuleManage, saveModuleManage } from '../modules/product-module-manager.js';

/* ============================
 * 2. 工具函式
 * ============================ */

/* 取得模組摘要文字 */
function getModuleSummary(mod, usedCount){
  return `${mod.selection === 'multi' ? '多選' : '單選'} ・ ${mod.required ? '必選' : '非必選'} ・ 已套用 ${usedCount} 商品`;
}

/* 取得商品已套用的模組名稱陣列 */
function getProductModuleNames(product){
  return (product.modules||[]).map(a=> state.modules.find(m=>m.id===a.moduleId)?.name).filter(Boolean);
}

/* 讀取檔案為 DataURL */
function readImageFileAsDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* 從 DataURL 載入 Image 物件 */
function loadImageFromDataURL(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/*
 * 圖片最佳化：自動裁切為正方形 + 壓縮至 900x900 JPEG
 * - 取圖片短邊為正方形邊長，置中裁切
 * - 縮小到 900px，品質 0.82
 * - 適用於 iPad 拍照或選取相簿
 */
async function optimizeProductImage(file){
  const rawDataUrl = await readImageFileAsDataURL(file);
  const image = await loadImageFromDataURL(rawDataUrl);

  /* 置中裁切為正方形 */
  const sourceSize = Math.min(image.width, image.height);
  const sx = Math.max(0, Math.floor((image.width - sourceSize) / 2));
  const sy = Math.max(0, Math.floor((image.height - sourceSize) / 2));

  /* 壓縮到 900x900 */
  const targetSize = 900;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, targetSize, targetSize);

  return canvas.toDataURL('image/jpeg', 0.82);
}

/* 表單元素快速存取 */
function getProductFormElements(){
  return {
    nameInput: document.getElementById('productName'),
    priceInput: document.getElementById('productPrice'),
    nameError: document.getElementById('productNameError'),
    priceError: document.getElementById('productPriceError'),
    saveBtn: document.querySelector('#productForm button[type="submit"]')
  };
}

/* 表單驗證 */
function validateProductForm(showMessage = false){
  const { nameInput, priceInput, nameError, priceError, saveBtn } = getProductFormElements();
  const name = nameInput.value.trim();
  const rawPrice = priceInput.value;
  const price = Number(rawPrice);
  const nameOk = !!name;
  const priceOk = rawPrice !== '' && !Number.isNaN(price) && price > 0;
  nameInput.classList.toggle('input-error', !nameOk && showMessage);
  priceInput.classList.toggle('input-error', !priceOk && showMessage);
  nameError.classList.toggle('hidden', nameOk || !showMessage);
  priceError.classList.toggle('hidden', priceOk || !showMessage);
  if(saveBtn){
    saveBtn.disabled = !(nameOk && priceOk);
    saveBtn.style.opacity = nameOk && priceOk ? '1' : '0.5';
  }
  return { valid: nameOk && priceOk, nameOk, priceOk };
}

function focusFirstInvalidField(result){
  const { nameInput, priceInput } = getProductFormElements();
  if(!result.nameOk) return nameInput.focus();
  if(!result.priceOk) return priceInput.focus();
}

/* ============================
 * 3. Excel 匯入工具
 * ============================ */
function createExcelTemplateRows(){
  return [
    { 商品名稱:'紅茶', 價格:30, 分類:'飲料', 狀態:'啟用', 商品別名:'古早味紅茶' },
    { 商品名稱:'奶茶', 價格:45, 分類:'飲料', 狀態:'啟用', 商品別名:'招牌奶茶' },
    { 商品名稱:'雞排', 價格:80, 分類:'炸物', 狀態:'啟用', 商品別名:'大雞排' }
  ];
}
function buildWorkbookFromRows(rows){
  if(!window.XLSX) throw new Error('XLSX library not loaded');
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(rows), '菜單');
  return wb;
}
function workbookToBlob(wb){
  return new Blob([window.XLSX.write(wb,{bookType:'xlsx',type:'array'})],
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200);
}
function normalizeImportedRow(row){
  const name=String(row['商品名稱']??row['名稱']??row['name']??row['Name']??'').trim();
  const price=Number(row['價格']??row['售價']??row['price']??row['Price']??0);
  const category=String(row['分類']??row['category']??row['Category']??'未分類').trim()||'未分類';
  const enabledText=String(row['狀態']??row['啟用']??row['enabled']??'啟用').trim();
  const aliases=String(row['商品別名']??row['別名']??row['aliases']??'').split(',').map(s=>s.trim()).filter(Boolean);
  const enabled=!['false','停用','0','關閉'].includes(enabledText);
  return {name,price,category,aliases,enabled};
}
function importExcelRowsToPending(rows){
  const imported=[];
  rows.forEach(raw=>{
    const item=normalizeImportedRow(raw); if(!item.name||!(item.price>0)) return;
    const exists=state.pendingProducts.some(p=>p.name===item.name&&Number(p.price)===Number(item.price))
      ||state.products.some(p=>p.name===item.name&&Number(p.price)===Number(item.price));
    if(exists) return;
    imported.push({id:id(),name:item.name,price:item.price,category:item.category||'未分類',
      enabled:item.enabled,aliases:item.aliases,modules:[],image:'',
      sortOrder:state.products.length+imported.length,status:'pending'});
  });
  if(!imported.length){alert('Excel 沒有可匯入的新資料');return;}
  state.pendingProducts.unshift(...imported);
  persistAll();window.refreshAllViews();alert(`已匯入 ${imported.length} 筆到待處理菜單`);
}
async function importExcelFile(file){
  if(!window.XLSX){alert('Excel 套件尚未載入');return;}
  const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  if(!ws){alert('Excel 內沒有工作表');return;}
  importExcelRowsToPending(window.XLSX.utils.sheet_to_json(ws,{defval:''}));
}

/* ============================
 * 4. 分類列表 / 模組列表 / 模組選擇器
 * ============================ */
export function renderCategoryOptions(){
  const sel=document.getElementById('productCategory'); const cur=sel.value;
  sel.innerHTML=state.categories.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if(state.categories.includes(cur)) sel.value=cur;
}

export function renderCategoryList(){
  const wrap=document.getElementById('categoryList');
  const uncat=state.products.filter(p=>!p.category||p.category==='未分類');
  wrap.innerHTML='';
  const ur=document.createElement('div'); ur.className='entity-row warning';
  ur.innerHTML=`<div><strong>未分類</strong><div class="meta">${uncat.length?uncat.map(p=>escapeHtml(p.name)).join('、'):'目前沒有未分類商品'}</div></div><div><span class="badge pending">${uncat.length} 筆</span></div>`;
  wrap.appendChild(ur);
  state.categories.filter(c=>c!=='未分類').forEach(cat=>{
    const cnt=state.products.filter(p=>p.category===cat).length;
    const row=document.createElement('div'); row.className='entity-row';
    row.innerHTML=`<div><strong>${escapeHtml(cat)}</strong><div class="meta">商品數：${cnt}</div></div><div class="action-stack"><button class="secondary-btn small-btn">管理商品</button><button class="secondary-btn small-btn">改名</button><button class="danger-btn small-btn">刪除</button></div>`;
    const [mb,rb,db]=row.querySelectorAll('button');
    mb.onclick=()=>openCategoryManage(cat);
    rb.onclick=()=>{const nv=prompt('輸入新分類名稱',cat);if(!nv||nv.trim()===cat)return;if(state.categories.includes(nv.trim()))return alert('分類已存在');state.categories=state.categories.map(c=>c===cat?nv.trim():c);state.products.forEach(p=>{if(p.category===cat)p.category=nv.trim()});persistAll();window.refreshAllViews();};
    db.onclick=()=>{if(!confirm(`確定刪除分類「${cat}」？`))return;state.categories=state.categories.filter(c=>c!==cat);state.products.forEach(p=>{if(p.category===cat)p.category='未分類'});if(state.settings.selectedCategory===cat)state.settings.selectedCategory='全部';persistAll();window.refreshAllViews();};
    wrap.appendChild(row);
  });
}

export function renderModuleSelect(){
  const sel=document.getElementById('moduleSelect');
  sel.innerHTML=state.modules.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
}

function renderModuleEditorOptions(optWrap, mod, expandModuleId){
  optWrap.innerHTML='';
  mod.options.forEach((opt,index)=>{
    const row=document.createElement('div'); row.className='option-edit-row';
    row.innerHTML=`<input value="${escapeAttr(opt.name)}" placeholder="選項名稱"><input type="number" min="0" value="${Number(opt.price||0)}" placeholder="加價"><button type="button" class="secondary-btn small-btn">${opt.enabled!==false?'啟用中':'已停用'}</button><button type="button" class="danger-btn small-btn">刪除</button>`;
    const [n,p,t,d]=row.querySelectorAll('input,button');
    n.oninput=()=>opt.name=n.value; p.oninput=()=>opt.price=Number(p.value||0);
    t.onclick=()=>{opt.enabled=!(opt.enabled!==false);renderModuleLibrary(expandModuleId);};
    d.onclick=()=>{mod.options.splice(index,1);renderModuleLibrary(expandModuleId);};
    optWrap.appendChild(row);
  });
}

export function renderModuleLibrary(expandModuleId=''){
  const wrap=document.getElementById('moduleLibraryList'); wrap.innerHTML='';
  state.modules.forEach(mod=>{
    const usedCount=state.products.filter(p=>(p.modules||[]).some(a=>a.moduleId===mod.id)).length;
    const isOpen=expandModuleId===mod.id;
    const block=document.createElement('div'); block.className='module-editor';
    block.innerHTML=`<div class="row between wrap"><div><strong>${escapeHtml(mod.name)}</strong><div class="meta module-summary">${escapeHtml(getModuleSummary(mod,usedCount))}</div></div><div class="action-stack"><button type="button" class="secondary-btn small-btn">套用商品</button><button type="button" class="secondary-btn small-btn">${isOpen?'收合':'編輯模組'}</button><button type="button" class="danger-btn small-btn">刪除模組</button></div></div><div class="module-options ${isOpen?'':'hidden'}"></div><div class="row gap wrap ${isOpen?'':'hidden'} footer-tools" style="margin-top:10px"><button type="button" class="secondary-btn small-btn add-option-btn">新增子選項</button></div>`;
    const btns=block.querySelectorAll('button');
    const optWrap=block.querySelector('.module-options');
    btns[0].onclick=()=>openModuleManage(mod.id);
    btns[1].onclick=()=>renderModuleLibrary(isOpen?'':mod.id);
    btns[2].onclick=()=>{if(!confirm(`確定刪除模組「${mod.name}」？`))return;state.modules=state.modules.filter(m=>m.id!==mod.id);state.products.forEach(p=>p.modules=(p.modules||[]).filter(a=>a.moduleId!==mod.id));persistAll();window.refreshAllViews();};
    if(isOpen){
      optWrap.innerHTML=`<div class="grid2"><div><label>模組名稱</label><input class="module-name" value="${escapeAttr(mod.name)}"></div><div><label>規則</label><select class="module-selection"><option value="single" ${mod.selection==='single'?'selected':''}>單選</option><option value="multi" ${mod.selection==='multi'?'selected':''}>多選</option></select></div></div><div class="switch-row"><span>必選</span><button type="button" class="switch ${mod.required?'on':''}">${mod.required?'開':'關'}</button></div><div class="module-options-list"></div>`;
      const ni=optWrap.querySelector('.module-name'),ss=optWrap.querySelector('.module-selection'),sw=optWrap.querySelector('.switch');
      ni.oninput=()=>{mod.name=ni.value;renderModuleSelect();const s=block.querySelector('.module-summary');if(s)s.textContent=getModuleSummary(mod,usedCount);};
      ss.onchange=()=>{mod.selection=ss.value;renderModuleLibrary(mod.id);};
      sw.onclick=()=>{mod.required=!mod.required;renderModuleLibrary(mod.id);};
      renderModuleEditorOptions(optWrap.querySelector('.module-options-list'),mod,mod.id);
      block.querySelector('.add-option-btn').onclick=()=>{mod.options.push({id:id(),name:'',price:0,enabled:true});renderModuleLibrary(mod.id);};
    }
    wrap.appendChild(block);
  });
}

/* ============================
 * 5. 商品表單圖片預覽
 * ============================ */
function renderProductImagePreview(imageData){
  const preview=document.getElementById('productImagePreview'); if(!preview) return;
  if(imageData){
    preview.innerHTML=`<img src="${escapeAttr(imageData)}" alt="商品圖片預覽" class="product-form-image">`;
    preview.classList.remove('muted');
  }else{
    preview.textContent='尚未上傳圖片（支援拍照或選取相簿，自動裁成正方形並壓縮）';
    preview.classList.add('muted');
  }
}

/* ============================
 * 6. 商品模組編輯器
 * ============================ */
export function renderProductModulesEditor(){
  const wrap=document.getElementById('productModulesEditor'); wrap.innerHTML='';
  if(!state.editModules.length) return wrap.innerHTML='<div class="muted">尚未套用口味模組</div>';
  state.editModules.forEach((att,index)=>{
    const mod=state.modules.find(m=>m.id===att.moduleId); if(!mod) return;
    const req=att.requiredOverride===null?mod.required:att.requiredOverride;
    const block=document.createElement('div'); block.className='attached-module';
    block.innerHTML=`<div class="row between wrap"><div><strong>${escapeHtml(mod.name)}</strong><div class="muted">${mod.selection==='multi'?'多選':'單選'} ・ 目前${req?'必選':'非必選'}</div></div><div class="row gap wrap"><select><option value="">沿用模組預設</option><option value="true" ${att.requiredOverride===true?'selected':''}>強制必選</option><option value="false" ${att.requiredOverride===false?'selected':''}>改為非必選</option></select><button type="button" class="danger-btn small-btn">移除</button></div></div>`;
    const [sel,btn]=block.querySelectorAll('select,button');
    sel.onchange=()=>{att.requiredOverride=sel.value===''?null:sel.value==='true';renderProductModulesEditor();};
    btn.onclick=()=>{state.editModules.splice(index,1);renderProductModulesEditor();};
    wrap.appendChild(block);
  });
}

/* ============================
 * 7. 商品列表（多欄網格卡片 + 縮圖）
 * ============================ */
function moveProduct(productId, direction){
  const list=[...state.products].sort((a,b)=>a.sortOrder-b.sortOrder);
  const idx=list.findIndex(p=>p.id===productId); if(idx<0)return;
  const si=direction==='up'?idx-1:idx+1; if(si<0||si>=list.length)return;
  const tmp=list[idx].sortOrder; list[idx].sortOrder=list[si].sortOrder; list[si].sortOrder=tmp;
  state.products.sort((x,y)=>x.sortOrder-y.sortOrder);
  persistAll();renderProductsTable();if(window.refreshPublicProducts)window.refreshPublicProducts();
}

export function renderProductsTable(){
  state.products.sort((a,b)=>a.sortOrder-b.sortOrder);
  const wrap=document.getElementById('productsTable'); wrap.innerHTML='';
  if(!state.products.length) return wrap.innerHTML='<div class="muted">尚無商品</div>';
  const total=state.products.length;
  const expandedId=wrap.dataset.expandedProductId||'';

  state.products.forEach((p,index)=>{
    const modNames=getProductModuleNames(p);
    const expanded=expandedId===p.id;
    const card=document.createElement('div');
    card.className=`product-grid-card${p.enabled===false?' disabled':''}`;

    /* 圖片區 */
    const thumbWrap=document.createElement('div');
    thumbWrap.className='product-card-thumb-wrap';
    if(p.image){
      thumbWrap.innerHTML=`<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}">`;
    }else{
      thumbWrap.innerHTML='<span class="no-image">無圖片</span>';
    }
    card.appendChild(thumbWrap);

    /* 內容區 */
    const body=document.createElement('div');
    body.className='product-card-body';
    body.innerHTML=`
      <div class="card-title">
        ${escapeHtml(p.name)}
        <span class="status ${p.enabled!==false?'on':'off'}">${p.enabled!==false?'啟用':'停用'}</span>
      </div>
      <div class="card-price">${money(p.price)}</div>
      <div class="card-category">${escapeHtml(p.category||'未分類')}</div>
      <div class="card-modules">${modNames.length?modNames.map(n=>`<span class="chip">${escapeHtml(n)}</span>`).join(''):'<span class="muted" style="font-size:11px">無模組</span>'}</div>
    `;
    card.appendChild(body);

    /* 按鈕區 */
    const actions=document.createElement('div');
    actions.className='product-card-actions';
    actions.innerHTML=`
      <button class="act-up" ${index===0?'disabled':''} title="上移">⬆</button>
      <button class="act-down" ${index===total-1?'disabled':''} title="下移">⬇</button>
      <button class="act-edit" title="編輯">編輯</button>
      <button class="act-toggle ${p.enabled!==false?'':'off'}" title="${p.enabled!==false?'停用':'啟用'}">${p.enabled!==false?'停用':'啟用'}</button>
      <button class="act-delete" title="刪除">刪除</button>
    `;
    card.appendChild(actions);

    /* 模組切換面板（展開時顯示） */
    const modulePanel=document.createElement('div');
    modulePanel.className=`inline-module-panel${expanded?'':' hidden'}`;
    modulePanel.innerHTML=`<div class="inline-module-grid">${state.modules.map(mod=>`<label class="inline-module-item"><input type="checkbox" data-module-id="${mod.id}" ${(p.modules||[]).some(m=>m.moduleId===mod.id)?'checked':''}><span>${escapeHtml(mod.name)}</span></label>`).join('')}</div>`;
    card.appendChild(modulePanel);

    /* 事件綁定 */
    const btns=actions.querySelectorAll('button');
    btns[0].onclick=()=>moveProduct(p.id,'up');    /* 上移 */
    btns[1].onclick=()=>moveProduct(p.id,'down');   /* 下移 */
    btns[2].onclick=()=>openProductForm(p);         /* 編輯 */
    btns[3].onclick=()=>{p.enabled=!(p.enabled!==false);persistAll();window.refreshAllViews();}; /* 啟用/停用 */
    btns[4].onclick=()=>{if(!confirm(`確定刪除商品「${p.name}」？`))return;state.products=state.products.filter(x=>x.id!==p.id);state.products.forEach((item,i)=>item.sortOrder=i);persistAll();window.refreshAllViews();if(document.getElementById('productId').value===p.id)resetProductForm();}; /* 刪除 */

    /* 模組勾選事件 */
    modulePanel.querySelectorAll('input[type="checkbox"]').forEach(chk=>{
      chk.addEventListener('change',()=>{
        const mid=chk.dataset.moduleId;
        const has=(p.modules||[]).some(m=>m.moduleId===mid);
        if(chk.checked&&!has) p.modules=[...(p.modules||[]),{moduleId:mid,requiredOverride:null}];
        if(!chk.checked&&has) p.modules=(p.modules||[]).filter(m=>m.moduleId!==mid);
        persistAll();if(window.refreshPublicProducts)window.refreshPublicProducts();
        wrap.dataset.expandedProductId=p.id;renderProductsTable();
      });
    });

    /* 點圖片或內容區可展開模組面板 */
    body.style.cursor='pointer';
    body.onclick=()=>{wrap.dataset.expandedProductId=expanded?'':p.id;renderProductsTable();};

    wrap.appendChild(card);
  });
}

/* ============================
 * 8. 待處理菜單
 * ============================ */
export function renderPendingMenuList(){
  const wrap=document.getElementById('pendingMenuList'); wrap.innerHTML='';
  if(!state.pendingProducts.length) return wrap.innerHTML='<div class="muted">目前沒有待處理菜單</div>';
  state.pendingProducts.forEach(item=>{
    const row=document.createElement('div'); row.className='pending-card';
    row.innerHTML=`<div class="pending-main"><div class="row between wrap"><div><strong>${escapeHtml(item.name||'')}</strong><span class="tag">${escapeHtml(item.category||'未分類')}</span></div><span class="badge pending">待處理</span></div><div class="grid2" style="margin-top:10px"><div><label>品項名稱</label><input class="pending-name" value="${escapeAttr(item.name||'')}"></div><div><label>價格</label><input class="pending-price" type="number" min="0" value="${Number(item.price||0)}"></div></div></div><div class="row gap wrap" style="margin-top:12px"><button type="button" class="primary-btn small-btn approve-btn">確認加入菜單</button><button type="button" class="danger-btn small-btn delete-btn">刪除</button></div>`;
    const ni=row.querySelector('.pending-name'),pi=row.querySelector('.pending-price');
    ni.addEventListener('input',()=>{item.name=ni.value;persistAll();});
    pi.addEventListener('input',()=>{item.price=Number(pi.value||0);persistAll();});
    row.querySelector('.approve-btn').onclick=()=>{
      const n=(item.name||'').trim(),pr=Number(item.price||0);
      if(!n)return alert('請先輸入品項名稱');if(!pr||pr<=0)return alert('請先輸入正確價格');
      state.products.push({id:item.id||id(),name:n,price:pr,category:item.category||'未分類',enabled:true,aliases:item.aliases||[],image:item.image||'',modules:item.modules||[],sortOrder:state.products.length});
      state.pendingProducts=state.pendingProducts.filter(x=>x.id!==item.id);
      state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((p,i)=>p.sortOrder=i);
      persistAll();window.refreshAllViews();
    };
    row.querySelector('.delete-btn').onclick=()=>{state.pendingProducts=state.pendingProducts.filter(x=>x.id!==item.id);persistAll();renderPendingMenuList();};
    wrap.appendChild(row);
  });
}

/* ============================
 * 9. 商品表單操作
 * ============================ */
export function resetProductForm(){
  document.getElementById('productId').value='';
  document.getElementById('productName').value='';
  document.getElementById('productPrice').value='';
  document.getElementById('productAliases').value='';
  document.getElementById('productImageData').value='';
  const imgInput=document.getElementById('productImageInput'); if(imgInput) imgInput.value='';
  document.getElementById('productEnabled').value='true';
  renderCategoryOptions();
  document.getElementById('productCategory').value='未分類';
  state.editModules=[];
  renderProductImagePreview('');
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
}

function bindFormButtonsState(){
  const hasId=!!document.getElementById('productId').value;
  const btn=document.getElementById('deleteProductBtn');
  btn.disabled=!hasId; btn.style.opacity=hasId?'1':'0.5';
}

function openProductForm(product){
  document.getElementById('productId').value=product.id;
  document.getElementById('productName').value=product.name;
  document.getElementById('productPrice').value=product.price;
  document.getElementById('productAliases').value=(product.aliases||[]).join(', ');
  document.getElementById('productImageData').value=product.image||'';
  const imgInput=document.getElementById('productImageInput'); if(imgInput) imgInput.value='';
  renderProductImagePreview(product.image||'');
  document.getElementById('productEnabled').value=String(product.enabled!==false);
  renderCategoryOptions();
  document.getElementById('productCategory').value=product.category||'未分類';
  state.editModules=deepCopy(product.modules||[]);
  renderProductModulesEditor();
  validateProductForm(false);
  bindFormButtonsState();
  /* 捲動到表單位置 */
  document.getElementById('productForm')?.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ============================
 * 10. initProductsPage() 初始化
 * ============================ */
export function initProductsPage(){

  /* Excel 匯入按鈕 */
  document.getElementById('excelTemplateBtn').onclick=()=>{
    downloadBlob(workbookToBlob(buildWorkbookFromRows(createExcelTemplateRows())),'菜單匯入範本.xlsx');
  };
  document.getElementById('excelImportBtn').onclick=()=>{
    document.getElementById('excelImportInput').click();
  };
  document.getElementById('excelImportInput').onchange=async(e)=>{
    const file=e.target.files&&e.target.files[0]; if(!file)return;
    await importExcelFile(file); e.target.value='';
  };

  /* 分類管理 */
  document.getElementById('addCategoryBtn').onclick=()=>{
    const input=document.getElementById('newCategoryInput');const name=input.value.trim();
    if(!name)return;if(state.categories.includes(name))return alert('分類已存在');
    state.categories.push(name);input.value='';persistAll();window.refreshAllViews();
  };

  /* 模組管理 */
  document.getElementById('addModuleBtn').onclick=()=>{
    const input=document.getElementById('newModuleInput');const name=input.value.trim();
    if(!name)return;state.modules.push({id:id(),name,selection:'single',required:true,options:[]});
    input.value='';persistAll();window.refreshAllViews();
  };

  document.getElementById('attachModuleBtn').onclick=()=>{
    const mid=document.getElementById('moduleSelect').value;if(!mid)return;
    if(state.editModules.some(m=>m.moduleId===mid))return alert('此模組已加入');
    state.editModules.push({moduleId:mid,requiredOverride:null});renderProductModulesEditor();
  };

  document.getElementById('resetProductBtn').onclick=resetProductForm;

  /* 移除圖片按鈕 */
  document.getElementById('removeProductImageBtn').onclick=()=>{
    document.getElementById('productImageData').value='';
    const imgInput=document.getElementById('productImageInput');if(imgInput)imgInput.value='';
    renderProductImagePreview('');
  };

  /* 圖片上傳（支援 iPad 拍照 + 相簿選取，自動壓縮裁切） */
  document.getElementById('productImageInput').onchange=async(e)=>{
    const file=e.target.files&&e.target.files[0]; if(!file)return;
    try{
      const dataUrl=await optimizeProductImage(file);
      document.getElementById('productImageData').value=dataUrl;
      renderProductImagePreview(dataUrl);
    }catch(err){
      alert('圖片處理失敗，請換一張圖片再試');
    }
  };

  /* 刪除商品 */
  document.getElementById('deleteProductBtn').onclick=()=>{
    const pid=document.getElementById('productId').value;if(!pid)return;
    const product=state.products.find(p=>p.id===pid);if(!product)return;
    if(!confirm(`確定刪除商品「${product.name}」？`))return;
    state.products=state.products.filter(p=>p.id!==pid);
    state.products.forEach((item,i)=>item.sortOrder=i);
    persistAll();window.refreshAllViews();resetProductForm();
  };

  /* 表單驗證 */
  const {nameInput,priceInput}=getProductFormElements();
  nameInput.addEventListener('input',()=>validateProductForm(false));
  priceInput.addEventListener('input',()=>validateProductForm(false));

  /* 商品表單送出 */
  document.getElementById('productForm').onsubmit=(e)=>{
    e.preventDefault();
    const validation=validateProductForm(true);
    if(!validation.valid){focusFirstInvalidField(validation);return;}
    const product={
      id:document.getElementById('productId').value||id(),
      name:document.getElementById('productName').value.trim(),
      price:Number(document.getElementById('productPrice').value||0),
      category:document.getElementById('productCategory').value||'未分類',
      enabled:document.getElementById('productEnabled').value==='true',
      aliases:document.getElementById('productAliases').value.split(',').map(s=>s.trim()).filter(Boolean),
      image:document.getElementById('productImageData').value||'',
      modules:deepCopy(state.editModules),
      sortOrder:document.getElementById('productId').value?(state.products.find(p=>p.id===document.getElementById('productId').value)?.sortOrder??state.products.length):state.products.length,
    };
    const idx=state.products.findIndex(p=>p.id===product.id);
    if(idx>=0)state.products[idx]=product; else state.products.push(product);
    state.products.sort((a,b)=>a.sortOrder-b.sortOrder).forEach((item,i)=>item.sortOrder=i);
    persistAll();window.refreshAllViews();resetProductForm();alert('商品已保存');
  };

  /* 儲存按鈕 */
  document.getElementById('saveAllBtn').onclick=()=>{persistAll();alert('已保存');};

  /* 分類管理 Modal */
  document.getElementById('closeCategoryManageModal').onclick=closeCategoryManage;
  document.getElementById('cancelCategoryManageBtn').onclick=closeCategoryManage;
  document.querySelector('#categoryManageModal .modal-backdrop').onclick=closeCategoryManage;
  document.getElementById('categoryManageSearch').addEventListener('input',renderCategoryManage);
  document.getElementById('saveCategoryManageBtn').onclick=()=>{saveCategoryManage();persistAll();window.refreshAllViews();};

  /* 模組管理 Modal */
  document.getElementById('closeModuleManageModal').onclick=closeModuleManage;
  document.getElementById('cancelModuleManageBtn').onclick=closeModuleManage;
  document.querySelector('#moduleManageModal .modal-backdrop').onclick=closeModuleManage;
  document.getElementById('moduleManageSearch').addEventListener('input',renderModuleManage);
  document.getElementById('saveModuleManageBtn').onclick=()=>{saveModuleManage();persistAll();window.refreshAllViews();};

  resetProductForm();
}
