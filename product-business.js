(function () {
  const unitOf = record => String(record?.businessUnit || '').toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
  const allowedUnits = () => {
    const access = String(state.user?.businessAccess || 'BOTH').toUpperCase();
    return access === 'BOTH' ? ['MOTOR', 'HANDPHONE'] : [access];
  };
  const unitLabel = unit => unit === 'HANDPHONE' ? 'Handphone' : 'Motor';
  const unitOptions = selected => allowedUnits().map(unit => `<option value="${unit}" ${unit === selected ? 'selected' : ''}>${unitLabel(unit)}</option>`).join('');
  const productCatalogOptions = (unit, selected = '') => state.data.catalog.filter(item => item.active && unitOf(item) === unit).map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc([item.brand, item.model, item.variant].filter(Boolean).join(' '))} · ${esc(item.id)}</option>`).join('');
  const isHandphoneCatalogView = () => state.view === 'handphoneCatalog';
  const isHandphonePricingView = () => state.view === 'handphonePricing';
  const optionParts = variant => String(variant || '').split('·').map(part => part.trim()).filter(Boolean);
  const pendingMoney = value => Number(value) > 0 ? money(value) : '<span class="pricing-pending">Pending</span>';
  const colourTone = colour => ({
    'Black': '#24262b', 'White': '#f6f3eb', 'Soft Pink': '#efd2d0', 'Mist Blue': '#b9ccd8',
    'Sage': '#aeb9a4', 'Lavender': '#c9bfd7', 'Space Black': '#303033', 'Cloud White': '#f4f1e9',
    'Light Gold': '#e3d2ad', 'Sky Blue': '#b9cbd8', 'Silver': '#d6d8da', 'Cosmic Orange': '#c7653c',
    'Deep Blue': '#334c66'
  }[colour] || '#dce5e8');

  function handphoneCatalogShowcase(rows) {
    const activeRows = rows.filter(item => item.active);
    const families = [...activeRows.reduce((map, item) => {
      const entry = map.get(item.model) || { model: item.model, brand: item.brand, image: item.image, productPageUrl: item.productPageUrl, storage: new Set(), colours: new Set() };
      const [storage, colour] = optionParts(item.variant);
      if (storage) entry.storage.add(storage);
      if (colour) entry.colours.add(colour);
      if (!entry.image && item.image) entry.image = item.image;
      if (!entry.productPageUrl && item.productPageUrl) entry.productPageUrl = item.productPageUrl;
      map.set(item.model, entry);
      return map;
    }, new Map()).values()];
    const capacities = new Set(activeRows.map(item => optionParts(item.variant)[0]).filter(Boolean));
    const colours = new Set(activeRows.map(item => optionParts(item.variant)[1]).filter(Boolean));
    return `<section class="handphone-catalog-overview"><div class="handphone-overview-copy"><span class="catalog-family-badge">APPLE · IPHONE 17 FAMILY</span><h2>All current models, storage and colours</h2><p>Choose the exact option below. Stock is confirmed with the warehouse before the customer receives a final quote.</p><div class="handphone-summary-stats"><span><strong>${families.length}</strong> models</span><span><strong>${capacities.size}</strong> storage sizes</span><span><strong>${colours.size}</strong> colours</span><span><strong>${activeRows.length}</strong> selectable options</span></div></div></section><section class="handphone-family-grid">${families.map(family => `<article class="handphone-family-card"><div class="handphone-family-image">${family.image ? `<img src="${esc(family.image)}" alt="${esc(`${family.brand} ${family.model}`)}">` : '<span>No approved image</span>'}</div><div class="handphone-family-body"><span class="product-brand">${esc(family.brand)}</span><h3>${esc(family.model)}</h3><p class="option-label">Storage</p><div class="option-chip-row">${[...family.storage].map(storage => `<span class="product-option-chip">${esc(storage)}</span>`).join('')}</div><p class="option-label">Colours</p><div class="colour-option-list">${[...family.colours].map(colour => `<span class="colour-option"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('')}</div>${family.productPageUrl ? `<a class="official-product-link" href="${esc(family.productPageUrl)}" target="_blank" rel="noopener">Official Apple product page</a>` : ''}</div></article>`).join('')}</section>`;
  }

  function productCatalogTable(rows) {
    const admin = state.user?.role === 'ADMIN';
    return `<div class="table-card"><table class="data-table"><thead><tr><th>Product & admin actions</th><th>Business</th><th>Category</th><th>Image</th><th>Stock check</th><th>Status</th></tr></thead><tbody>${rows.map(item => { const [storage, colour] = optionParts(item.variant); return `<tr><td><strong>${esc(`${item.brand} ${item.model}`)}</strong><div class="catalog-option-line">${storage ? `<span class="product-option-chip">${esc(storage)}</span>` : ''}${colour ? `<span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>` : ''}</div><small>${esc(item.id)}</small>${admin ? `<div class="inline-admin-actions"><button class="row-action" data-product-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-toggle="${esc(item.id)}">${item.active ? 'Disable' : 'Restore'}</button></div>` : ''}</td><td><span class="business-pill ${unitOf(item) === 'HANDPHONE' ? 'handphone' : ''}">${unitLabel(unitOf(item))}</span><small>${esc(item.operatingSystem || item.fuel || '')}</small></td><td>${pretty(item.category)}<small>${pretty(item.tier)}</small></td><td>${item.image ? `<img src="${esc(item.image)}" alt="${esc(`${item.brand} ${item.model}`)}" class="catalog-thumb">` : item.imageUrl ? 'Waiting for approval' : 'No image'}</td><td>${pretty(item.stock)}<small>${esc(item.regionAvailability || item.branchAvailability || item.warehouseAvailability || 'Confirm availability')}</small></td><td>${pill(item.active ? 'Active' : 'Inactive', item.active)}<small>${item.imageApproved ? 'Image approved' : 'Image not approved'}</small></td></tr>`; }).join('') || empty(6)}</tbody></table></div>`;
  }

  function bindProductCatalog() {
    document.querySelectorAll('[data-product-edit]').forEach(button => button.onclick = () => editProductCatalog(state.data.catalog.find(item => item.id === button.dataset.productEdit)));
    document.querySelectorAll('[data-product-toggle]').forEach(button => button.onclick = async () => {
      const item = state.data.catalog.find(record => record.id === button.dataset.productToggle);
      const enabled = !item.active;
      if (!confirm(`${enabled ? 'Restore' : 'Disable'} ${item.brand} ${item.model}?`)) return;
      try {
        await post('setCatalogItemEnabled', { catalogId: item.id, businessUnit: unitOf(item), enabled });
        await refreshProductCatalog();
      } catch (error) { alert(error.message); }
    });
  }

  async function refreshProductCatalog() {
    const returnView = state.view === 'handphoneCatalog' ? 'handphoneCatalog' : 'catalog';
    const response = await get('catalog');
    state.data.catalog = response.records || [];
    loadedResources.add('catalog');
    state.view = returnView;
    render();
  }

  function editProductCatalog(item = {}) {
    const editing = Boolean(item.id), selectedUnit = editing ? unitOf(item) : (state.catalogBusiness || allowedUnits()[0]);
    formModal(`${editing ? 'Edit' : 'Add'} ${unitLabel(selectedUnit)} product`, `<form id="productCatalogForm" class="crm-form"><label>Business unit<select name="businessUnit" ${editing ? 'disabled' : ''}>${unitOptions(selectedUnit)}</select></label><label>Brand<input name="brand" value="${esc(item.brand || '')}" required></label><label>Model<input name="model" value="${esc(item.model || '')}" required></label><label>Variant / storage / colour<input name="variant" value="${esc(item.variant || 'Standard')}"></label><label>Category<input name="category" value="${esc(item.category || (selectedUnit === 'HANDPHONE' ? 'SMARTPHONE' : 'MOPED'))}" required></label><label class="motor-only">Fuel type<select name="fuel"><option value="PETROL">Petrol</option></select></label><label class="handphone-only">Operating system<select name="operatingSystem"><option value="IOS">iOS</option><option value="ANDROID">Android</option><option value="OTHER">Other</option></select></label><label>Popularity tier<select name="tier"><option value="PRIMARY">Primary</option><option value="SECONDARY">Secondary</option><option value="ON_REQUEST">On request</option></select></label><label>Stock check mode<select name="stock"><option value="CHECK_BRANCH">Check branch</option><option value="CHECK_WAREHOUSE">Check warehouse</option><option value="CONFIRMED_AVAILABLE">Confirmed available</option><option value="UNAVAILABLE">Unavailable</option></select></label><label>Catalog status<select name="active"><option value="TRUE">Active</option><option value="FALSE">Inactive</option></select></label><label class="form-wide">Product page URL<input name="productPageUrl" type="url" value="${esc(item.productPageUrl || '')}"></label><label class="form-wide">Image URL<input name="imageUrl" type="url" value="${esc(item.imageUrl || '')}"></label><label>Image approval<select name="imageApproved"><option value="FALSE">Not approved</option><option value="TRUE">Approved</option></select></label><label>Search keywords<input name="searchKeywords" value="${esc(item.searchKeywords || '')}"></label><label class="form-wide">Malay image caption<textarea name="imageCaption" rows="3">${esc(item.imageCaption || '')}</textarea></label><label class="motor-only">Branch availability<input name="branchAvailability" value="${esc(item.branchAvailability || '')}"></label><label class="handphone-only">Region availability<input name="regionAvailability" value="${esc(item.regionAvailability || '')}" placeholder="EAST_MALAYSIA, WEST_MALAYSIA or ALL"></label><label>Warehouse availability<input name="warehouseAvailability" value="${esc(item.warehouseAvailability || '')}"></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? 'Save product' : 'Add product'}</button></div><p class="form-wide notice" id="formMessage">Motor and Handphone use separate catalogs. Disabled records stay in the audit trail but cannot be selected for new applications.</p></form>`);
    const form = document.getElementById('productCatalogForm');
    const sync = () => { const unit = editing ? selectedUnit : form.businessUnit.value; form.querySelectorAll('.motor-only').forEach(element => element.hidden = unit !== 'MOTOR'); form.querySelectorAll('.handphone-only').forEach(element => element.hidden = unit !== 'HANDPHONE'); };
    form.businessUnit.value = selectedUnit; form.tier.value = item.tier || 'PRIMARY'; form.stock.value = item.stock || 'CHECK_BRANCH'; form.active.value = item.id ? (item.active ? 'TRUE' : 'FALSE') : 'TRUE'; form.imageApproved.value = item.imageApproved ? 'TRUE' : 'FALSE'; if (form.operatingSystem) form.operatingSystem.value = item.operatingSystem || 'IOS'; sync(); form.businessUnit.onchange = sync;
    form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove();
    form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'), values = Object.fromEntries(new FormData(form)); values.businessUnit = selectedUnit && editing ? selectedUnit : form.businessUnit.value; button.disabled = true; try { await post('saveCatalogItem', { catalogId: item.id || '', ...values }); document.querySelector('.drawer-backdrop').remove(); await refreshProductCatalog(); } catch (error) { message.textContent = error.message; button.disabled = false; } };
  }

  catalog = function () {
    const selected = isHandphoneCatalogView() ? 'HANDPHONE' : 'MOTOR';
    state.catalogBusiness = selected;
    const rows = state.data.catalog.filter(item => unitOf(item) === selected && !/TEMPLATE/i.test(String(item.id || ''))), admin = state.user?.role === 'ADMIN';
    const heading = selected === 'HANDPHONE' ? 'Handphone Catalog' : 'Motor Catalog';
    const description = admin ? `Manage ${unitLabel(selected)} models, options, images and availability in this dedicated catalog.` : `Approved active ${unitLabel(selected)} products.`;
    app.innerHTML = head(heading, description) + (selected === 'HANDPHONE' ? handphoneCatalogShowcase(rows) : '') + `<div class="smart-toolbar catalog-toolbar"><input id="catalogSearch" placeholder="Search brand, model, colour, storage or Catalog ID"><span class="locked-business-pill ${selected === 'HANDPHONE' ? 'handphone' : ''}">${unitLabel(selected)} only</span><div class="toolbar-spacer"></div>${admin ? `<button class="primary" data-new-product>+ Add ${unitLabel(selected)} product</button>` : ''}</div><section class="panel"><div class="panel-heading"><div><span class="eyebrow">ADMIN OPTIONS</span><h2>${unitLabel(selected)} option records</h2></div><span>${rows.length} records</span></div><div id="catalogResults">${productCatalogTable(rows)}</div></section>`;
    document.getElementById('catalogSearch').oninput = event => { const query = event.target.value.toLowerCase(); document.getElementById('catalogResults').innerHTML = productCatalogTable(rows.filter(item => Object.values(item).join(' ').toLowerCase().includes(query))); bindProductCatalog(); };
    document.querySelector('[data-new-product]')?.addEventListener('click', () => editProductCatalog({ businessUnit: selected }));
    bindProductCatalog();
  };

  function productPricingTable(rows) {
    const admin = state.user?.role === 'ADMIN';
    return `<div class="table-card"><table class="data-table"><thead><tr><th>Product & admin actions</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Validity</th><th>Status</th></tr></thead><tbody>${rows.map(item => { const handphone = unitOf(item) === 'HANDPHONE'; const instalments = handphone ? `${pendingMoney(item.month12)} / ${pendingMoney(item.month24)} / ${pendingMoney(item.month36)} for 12 / 24 / 36 months${item.month48 ? ` · ${money(item.month48)} for 48 months` : ' · 48 months Pending'}` : `${pendingMoney(item.year3)} / ${pendingMoney(item.year4)} / ${pendingMoney(item.year5)} for 3 / 4 / 5 years`; return `<tr><td><strong>${esc(`${item.brand} ${item.model}`)}</strong><small>${unitLabel(unitOf(item))} · ${esc(item.variant)} · ${esc(item.id)}</small>${admin ? `<div class="inline-admin-actions"><button class="row-action" data-product-price-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-price-toggle="${esc(item.id)}">${item.active ? 'Disable price' : 'Enable price'}</button>${item.promotion ? `<button class="row-action secondary" data-product-promotion-toggle="${esc(item.id)}">${item.promotionActive ? 'Disable promotion' : 'Enable promotion'}</button>` : ''}</div>` : ''}</td><td>${pretty(item.zone)}</td><td>${handphone ? `<strong>${pendingMoney(item.productPrice)}</strong> product price<br>` : ''}${pendingMoney(item.baseDeposit || item.deposit)} deposit<small>${instalments}</small></td><td><strong>${esc(item.promotion || 'No promotion')}</strong><small>${item.promotionDeposit ? `${money(item.promotionDeposit)} deposit` : 'No active offer'}</small></td><td>${esc(item.effective || 'No start')}<small>to ${esc(item.effectiveTo || 'No end')}</small></td><td>${pill(item.active ? item.status : 'Draft / disabled', item.active && item.status === 'APPROVED')}<small>${item.promotion ? `Promotion: ${pretty(item.promotionStatus)} · ${item.promotionActive ? 'Enabled' : 'Disabled'}` : 'Standard pricing'}</small></td></tr>`; }).join('') || empty(6)}</tbody></table></div>`;
  }

  async function refreshProductPricing() { const returnView = state.view === 'handphonePricing' ? 'handphonePricing' : 'pricing'; const [pricingResponse, catalogResponse] = await Promise.all([get('pricing'), get('catalog')]); state.data.pricing = pricingResponse.records || []; state.data.catalog = catalogResponse.records || []; loadedResources.add('pricing'); loadedResources.add('catalog'); state.view = returnView; render(); }

  function bindProductPricing() {
    document.querySelectorAll('[data-product-price-edit]').forEach(button => button.onclick = () => editProductPricing(state.data.pricing.find(item => item.id === button.dataset.productPriceEdit)));
    document.querySelectorAll('[data-product-price-toggle]').forEach(button => button.onclick = () => toggleProductPricing(button.dataset.productPriceToggle, 'price'));
    document.querySelectorAll('[data-product-promotion-toggle]').forEach(button => button.onclick = () => toggleProductPricing(button.dataset.productPromotionToggle, 'promotion'));
  }

  async function toggleProductPricing(id, type) {
    const item = state.data.pricing.find(record => record.id === id), enabled = type === 'price' ? !item.active : !item.promotionActive;
    if (!confirm(`${enabled ? 'Enable' : 'Disable'} ${item.brand} ${item.model} ${type}?`)) return;
    try { await post(type === 'price' ? 'setPricingEnabled' : 'setPromotionEnabled', { pricingId: item.id, businessUnit: unitOf(item), enabled }); await refreshProductPricing(); } catch (error) { alert(error.message); }
  }

  function editProductPricing(item = {}) {
    const editing = Boolean(item.id), selectedUnit = editing ? unitOf(item) : (state.pricingBusiness || allowedUnits()[0]), handphone = selectedUnit === 'HANDPHONE';
    formModal(`${editing ? 'Edit' : 'Add'} ${unitLabel(selectedUnit)} price and promotion`, `<form id="productPricingForm" class="crm-form"><input type="hidden" name="businessUnit" value="${selectedUnit}"><h3 class="form-wide">${unitLabel(selectedUnit)} and standard financing</h3><label class="form-wide">Catalog product<select name="catalogId" required><option value="">Select a ${unitLabel(selectedUnit).toLowerCase()} product</option>${productCatalogOptions(selectedUnit, item.catalogId)}</select></label><label>Price zone<input name="zone" value="${esc(item.zone || 'EAST_MALAYSIA')}" list="businessPriceZones" required><datalist id="businessPriceZones"><option value="ALL_BRANCHES"><option value="EAST_MALAYSIA"><option value="WEST_MALAYSIA"><option value="SARAWAK"></datalist></label>${handphone ? `<label>Product price (RM)<input name="productPrice" type="number" min="0" step="0.01" value="${esc(item.productPrice || '')}" required></label>` : ''}<label>Standard deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.baseDeposit ?? item.deposit ?? '')}" required></label>${handphone ? `<label>Monthly 12 months (RM)<input name="month12" type="number" min="0" step="0.01" value="${esc(item.month12 || '')}" required></label><label>Monthly 24 months (RM)<input name="month24" type="number" min="0" step="0.01" value="${esc(item.month24 || '')}" required></label><label>Monthly 36 months (RM)<input name="month36" type="number" min="0" step="0.01" value="${esc(item.month36 || '')}" required></label><label>Monthly 48 months (RM)<input name="month48" type="number" min="0" step="0.01" value="${esc(item.month48 || '')}"></label>` : `<label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3 || '')}" required></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4 || '')}" required></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5 || '')}" required></label>`}<label>Pricing enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective || '')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo || '')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes || '')}</textarea></label><h3 class="form-wide">Promotion</h3><label>Promotion name<input name="promotionName" value="${esc(item.promotion || '')}"></label><label>Promotion deposit (RM)<input name="promotionDeposit" type="number" min="0" step="0.01" value="${esc(item.promotionDeposit || '')}"></label><label>Promotion start<input name="promotionStart" type="date" value="${esc(item.promotionStart || '')}"></label><label>Promotion end<input name="promotionEnd" type="date" value="${esc(item.promotionEnd || '')}"></label><label>Promotion enabled<select name="promotionActive"><option value="FALSE">Disabled</option><option value="TRUE">Enabled</option></select></label><label>Promotion approval<select name="promotionStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label class="form-wide">Promotion notes<textarea name="promotionNotes" rows="3">${esc(item.promotionNotes || '')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? 'Save price / promotion' : 'Add price / promotion'}</button></div><p class="form-wide notice" id="formMessage">Handphone uses monthly tenures; Motor uses yearly tenures. Only approved, enabled and date-valid prices are customer-visible.</p></form>`);
    const form = document.getElementById('productPricingForm'); form.active.value = item.id ? (item.active ? 'TRUE' : 'FALSE') : 'FALSE'; form.quoteStatus.value = item.status || 'DRAFT'; form.promotionActive.value = item.promotionActive ? 'TRUE' : 'FALSE'; form.promotionStatus.value = item.promotionStatus || 'DRAFT'; form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove(); form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'); button.disabled = true; try { await post('savePricingPromotion', { pricingId: item.id || '', ...Object.fromEntries(new FormData(form)) }); document.querySelector('.drawer-backdrop').remove(); await refreshProductPricing(); } catch (error) { message.textContent = error.message; button.disabled = false; } };
  }

  pricing = function () {
    const selected = isHandphonePricingView() ? 'HANDPHONE' : 'MOTOR';
    state.pricingBusiness = selected;
    const rows = state.data.pricing.filter(item => unitOf(item) === selected && !/TEMPLATE/i.test(String(item.id || ''))), admin = state.user?.role === 'ADMIN';
    const heading = selected === 'HANDPHONE' ? 'Handphone Pricing' : 'Motor Pricing & Promotions';
    const description = selected === 'HANDPHONE' ? 'Apple Malaysia retail prices are references only. Deposit and monthly instalments remain Draft until Admin approves JomKaki terms.' : (admin ? 'Manage Motor prices, financing and promotions without leaving CRM.' : 'Approved Motor customer pricing.');
    app.innerHTML = head(heading, description) + (selected === 'HANDPHONE' ? `<div class="pricing-safety-banner"><strong>Draft pricing safeguard</strong><span>These iPhone 17 prices are official Apple Malaysia retail references. They cannot be quoted to customers until Admin enters the approved deposit and monthly instalments, changes the status to Approved and enables the row.</span></div>` : '') + `<div class="smart-toolbar"><input id="pricingSearch" placeholder="Search product, colour, storage, zone, promotion or Pricing ID"><span class="locked-business-pill ${selected === 'HANDPHONE' ? 'handphone' : ''}">${unitLabel(selected)} only</span><div class="toolbar-spacer"></div>${admin ? `<button class="primary" data-new-product-price>+ Add ${unitLabel(selected)} price</button>` : ''}</div><section class="panel" id="pricingResults">${productPricingTable(rows)}</section>`;
    document.getElementById('pricingSearch').oninput = event => { const query = event.target.value.toLowerCase(); document.getElementById('pricingResults').innerHTML = productPricingTable(rows.filter(item => Object.values(item).join(' ').toLowerCase().includes(query))); bindProductPricing(); };
    document.querySelector('[data-new-product-price]')?.addEventListener('click', () => editProductPricing({ businessUnit: selected }));
    bindProductPricing();
  };
})();
