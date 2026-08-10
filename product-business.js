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
  const optionParts = variant => String(variant || '').split(/(?:Â·|·)/).map(part => part.trim()).filter(Boolean);
  const handphonePricingCatalogOptions = (selected = '') => {
    const seen = new Set(), selectedItem = state.data.catalog.find(item => item.id === selected), selectedStorage = selectedItem ? optionParts(selectedItem.variant)[0] || 'Standard' : '', selectedKey = selectedItem ? `${selectedItem.brand}|${selectedItem.model}|${selectedStorage}` : '';
    return state.data.catalog.filter(item => item.active && unitOf(item) === 'HANDPHONE').map(item => {
      const storage = optionParts(item.variant)[0] || 'Standard', key = `${item.brand}|${item.model}|${storage}`;
      if (seen.has(key)) return '';
      seen.add(key);
      return `<option value="${esc(item.id)}" ${key === selectedKey ? 'selected' : ''}>${esc(`${item.brand} ${item.model} · ${storage}`)}</option>`;
    }).join('');
  };
  const pendingMoney = value => Number(value) > 0 ? money(value) : '<span class="pricing-pending">Pending</span>';
  const colourTone = colour => ({
    'Black': '#24262b', 'White': '#f6f3eb', 'Soft Pink': '#efd2d0', 'Mist Blue': '#b9ccd8',
    'Sage': '#aeb9a4', 'Lavender': '#c9bfd7', 'Space Black': '#303033', 'Cloud White': '#f4f1e9',
    'Light Gold': '#e3d2ad', 'Sky Blue': '#b9cbd8', 'Silver': '#d6d8da', 'Cosmic Orange': '#c7653c',
    'Deep Blue': '#334c66'
  }[colour] || '#dce5e8');

  function handphoneCatalogShowcase(rows) {
    const admin = state.user?.role === 'ADMIN';
    const activeRows = rows.filter(item => item.active);
    const families = [...activeRows.reduce((map, item) => {
      const entry = map.get(item.model) || { model: item.model, brand: item.brand, image: item.image, productPageUrl: item.productPageUrl, storage: new Set(), colours: new Set(), variants: [] };
      const [storage, colour] = optionParts(item.variant);
      if (storage) entry.storage.add(storage);
      if (colour) entry.colours.add(colour);
      entry.variants.push(item);
      if (!entry.image && item.image) entry.image = item.image;
      if (!entry.productPageUrl && item.productPageUrl) entry.productPageUrl = item.productPageUrl;
      map.set(item.model, entry);
      return map;
    }, new Map()).values()];
    const capacities = new Set(activeRows.map(item => optionParts(item.variant)[0]).filter(Boolean));
    const colours = new Set(activeRows.map(item => optionParts(item.variant)[1]).filter(Boolean));
    return `<section class="handphone-catalog-overview"><div class="handphone-overview-copy"><span class="catalog-family-badge">APPLE · IPHONE 17 FAMILY</span><h2>One catalog card per phone model</h2><p>Storage and colour are options inside each model, not separate products. The exact combination is selected only when creating an application.</p><div class="handphone-summary-stats"><span><strong>${families.length}</strong> catalog cards</span><span><strong>${capacities.size}</strong> storage sizes</span><span><strong>${colours.size}</strong> colours</span><span><strong>${activeRows.length}</strong> exact combinations</span></div></div></section><section class="handphone-family-grid">${families.map(family => `<article class="handphone-family-card"><div class="handphone-family-image">${family.image ? `<img src="${esc(family.image)}" alt="${esc(`${family.brand} ${family.model}`)}">` : '<span>No approved image</span>'}</div><div class="handphone-family-body"><span class="product-brand">${esc(family.brand)}</span><h3>${esc(family.model)}</h3><p class="option-label">Storage options</p><div class="option-chip-row">${[...family.storage].map(storage => `<span class="product-option-chip">${esc(storage)}</span>`).join('')}</div><p class="option-label">Colour options</p><div class="colour-option-list">${[...family.colours].map(colour => `<span class="colour-option"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('')}</div><div class="handphone-card-actions">${family.productPageUrl ? `<a class="official-product-link" href="${esc(family.productPageUrl)}" target="_blank" rel="noopener">Official Apple page</a>` : ''}${admin ? `<button class="row-action" data-manage-phone-model="${esc(family.model)}">Manage ${family.variants.length} options</button>` : ''}</div></div></article>`).join('')}</section>`;
  }

  function openHandphoneModelOptions(model, rows) {
    const options = rows.filter(item => item.model === model);
    drawer(`${esc(model)} options`, 'Storage and colour combinations are kept behind one catalog card.', `<div class="handphone-option-note"><strong>Why these records are separate underneath</strong><span>Each exact storage and colour combination needs its own SKU for stock, AI selection and loan applications. Customers and staff still see one phone model card.</span></div><div class="table-card handphone-option-table"><table class="data-table"><thead><tr><th>Storage</th><th>Colour</th><th>Availability</th><th>Status</th><th>Admin</th></tr></thead><tbody>${options.map(item => { const [storage, colour] = optionParts(item.variant); return `<tr><td><strong>${esc(storage || 'Standard')}</strong></td><td><span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour || 'Default')}</span></td><td>${pretty(item.stock)}<small>${esc(item.regionAvailability || item.warehouseAvailability || 'Check warehouse')}</small></td><td>${pill(item.active ? 'Active' : 'Inactive', item.active)}</td><td><div class="inline-admin-actions"><button class="row-action" data-product-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-toggle="${esc(item.id)}">${item.active ? 'Disable' : 'Restore'}</button></div></td></tr>`; }).join('')}</tbody></table></div>`);
    bindProductCatalog();
  }

  function bindHandphoneCatalog(rows) {
    document.querySelectorAll('[data-manage-phone-model]').forEach(button => button.onclick = () => openHandphoneModelOptions(button.dataset.managePhoneModel, rows));
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
        document.querySelector('.drawer-backdrop')?.remove();
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
    const phoneView = selected === 'HANDPHONE';
    app.innerHTML = head(heading, description) + `<div class="smart-toolbar catalog-toolbar"><input id="catalogSearch" placeholder="Search brand, model, colour or storage"><span class="locked-business-pill ${phoneView ? 'handphone' : ''}">${unitLabel(selected)} only</span><div class="toolbar-spacer"></div>${admin ? `<button class="primary" data-new-product>+ Add ${unitLabel(selected)} product</button>` : ''}</div><div id="catalogResults">${phoneView ? handphoneCatalogShowcase(rows) : `<section class="panel">${productCatalogTable(rows)}</section>`}</div>${phoneView ? '<p class="notice catalog-structure-note"><strong>Clean catalog view:</strong> five iPhone models are shown as five cards. Exact storage and colour SKUs stay available under Manage options for Admin.</p>' : ''}`;
    document.getElementById('catalogSearch').oninput = event => { const query = event.target.value.toLowerCase(), filtered = rows.filter(item => Object.values(item).join(' ').toLowerCase().includes(query)); document.getElementById('catalogResults').innerHTML = phoneView ? handphoneCatalogShowcase(filtered) : `<section class="panel">${productCatalogTable(filtered)}</section>`; phoneView ? bindHandphoneCatalog(filtered) : bindProductCatalog(); };
    document.querySelector('[data-new-product]')?.addEventListener('click', () => editProductCatalog({ businessUnit: selected }));
    phoneView ? bindHandphoneCatalog(rows) : bindProductCatalog();
  };

  function productPricingTable(rows) {
    const admin = state.user?.role === 'ADMIN';
    return `<div class="table-card"><table class="data-table"><thead><tr><th>Product & admin actions</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Validity</th><th>Status</th></tr></thead><tbody>${rows.map(item => { const handphone = unitOf(item) === 'HANDPHONE'; const instalments = handphone ? `${pendingMoney(item.month12)} / ${pendingMoney(item.month24)} / ${pendingMoney(item.month36)} for 12 / 24 / 36 months${item.month48 ? ` · ${money(item.month48)} for 48 months` : ' · 48 months Pending'}` : `${pendingMoney(item.year3)} / ${pendingMoney(item.year4)} / ${pendingMoney(item.year5)} for 3 / 4 / 5 years`; return `<tr><td><strong>${esc(`${item.brand} ${item.model}`)}</strong><small>${unitLabel(unitOf(item))} · ${esc(item.variant)} · ${esc(item.id)}</small>${admin ? `<div class="inline-admin-actions"><button class="row-action" data-product-price-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-price-toggle="${esc(item.id)}">${item.active ? 'Disable price' : 'Enable price'}</button>${item.promotion ? `<button class="row-action secondary" data-product-promotion-toggle="${esc(item.id)}">${item.promotionActive ? 'Disable promotion' : 'Enable promotion'}</button>` : ''}</div>` : ''}</td><td>${pretty(item.zone)}</td><td>${handphone ? `<strong>${pendingMoney(item.productPrice)}</strong> product price<br>` : ''}${pendingMoney(item.baseDeposit || item.deposit)} deposit<small>${instalments}</small></td><td><strong>${esc(item.promotion || 'No promotion')}</strong><small>${item.promotionDeposit ? `${money(item.promotionDeposit)} deposit` : 'No active offer'}</small></td><td>${esc(item.effective || 'No start')}<small>to ${esc(item.effectiveTo || 'No end')}</small></td><td>${pill(item.active ? item.status : 'Draft / disabled', item.active && item.status === 'APPROVED')}<small>${item.promotion ? `Promotion: ${pretty(item.promotionStatus)} · ${item.promotionActive ? 'Enabled' : 'Disabled'}` : 'Standard pricing'}</small></td></tr>`; }).join('') || empty(6)}</tbody></table></div>`;
  }

  function groupHandphonePricing(rows) {
    return [...rows.reduce((groups, item) => {
      const [storage, colour] = optionParts(item.variant), key = [item.brand, item.model, storage || 'Standard', item.zone].join('|||');
      const group = groups.get(key) || { key, brand: item.brand, model: item.model, storage: storage || 'Standard', zone: item.zone, colours: new Set(), records: [], representative: item };
      if (colour) group.colours.add(colour);
      group.records.push(item);
      groups.set(key, group);
      return groups;
    }, new Map()).values()];
  }

  function handphonePricingTable(rows, query = '') {
    const admin = state.user?.role === 'ADMIN', normalizedQuery = String(query || '').trim().toLowerCase();
    const groups = groupHandphonePricing(rows).filter(group => !normalizedQuery || [group.brand, group.model, group.storage, group.zone, ...group.colours, ...group.records.flatMap(item => [item.promotion, item.status])].join(' ').toLowerCase().includes(normalizedQuery));
    return `<div class="handphone-pricing-summary"><div><span class="catalog-family-badge">ONE PRICE PER STORAGE</span><h2>Model and storage determine the price</h2><p>Colour never changes the phone price. One update below is synchronized to every colour SKU for the same model, storage and zone.</p></div><div class="handphone-summary-stats"><span><strong>${groups.length}</strong> price groups</span><span><strong>${rows.length}</strong> colour SKUs covered</span></div></div><div class="table-card"><table class="data-table"><thead><tr><th>Model & storage</th><th>Included colours</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Status</th></tr></thead><tbody>${groups.map(group => { const item = group.representative, colours = [...group.colours], instalments = `${pendingMoney(item.month12)} / ${pendingMoney(item.month24)} / ${pendingMoney(item.month36)} for 12 / 24 / 36 months${item.month48 ? ` · ${money(item.month48)} for 48 months` : ' · 48 months Pending'}`; return `<tr><td><strong>${esc(`${group.brand} ${group.model}`)}</strong><div class="catalog-option-line"><span class="product-option-chip">${esc(group.storage)}</span></div><small>${group.records.length} colour SKU${group.records.length === 1 ? '' : 's'} use this price</small>${admin ? `<div class="inline-admin-actions"><button class="row-action" data-handphone-price-edit="${esc(group.key)}">Edit shared price</button><button class="row-action secondary" data-handphone-price-toggle="${esc(group.key)}">${item.active ? 'Disable price' : 'Enable price'}</button>${item.promotion ? `<button class="row-action secondary" data-handphone-promotion-toggle="${esc(group.key)}">${item.promotionActive ? 'Disable promotion' : 'Enable promotion'}</button>` : ''}</div>` : ''}</td><td><div class="colour-option-list compact-list">${colours.map(colour => `<span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('') || '<span class="pricing-muted">All available colours</span>'}</div></td><td>${pretty(group.zone)}</td><td><strong>${pendingMoney(item.productPrice)}</strong> product price<br>${pendingMoney(item.baseDeposit || item.deposit)} deposit<small>${instalments}</small></td><td><strong>${esc(item.promotion || 'No promotion')}</strong><small>${item.promotionDeposit ? `${money(item.promotionDeposit)} deposit` : 'No active offer'}</small></td><td>${pill(item.active ? item.status : 'Draft / disabled', item.active && item.status === 'APPROVED')}<small>${item.promotion ? `Promotion: ${pretty(item.promotionStatus)} · ${item.promotionActive ? 'Enabled' : 'Disabled'}` : 'Standard pricing'}</small></td></tr>`; }).join('') || empty(6)}</tbody></table></div><p class="notice pricing-structure-note"><strong>Pricing structure:</strong> model + storage + zone controls the price. Colour remains a stock choice and never creates another price.</p>`;
  }

  async function refreshProductPricing() { const returnView = state.view === 'handphonePricing' ? 'handphonePricing' : 'pricing'; const [pricingResponse, catalogResponse] = await Promise.all([get('pricing'), get('catalog')]); state.data.pricing = pricingResponse.records || []; state.data.catalog = catalogResponse.records || []; loadedResources.add('pricing'); loadedResources.add('catalog'); state.view = returnView; render(); }

  function bindProductPricing() {
    document.querySelectorAll('[data-product-price-edit]').forEach(button => button.onclick = () => editProductPricing(state.data.pricing.find(item => item.id === button.dataset.productPriceEdit)));
    document.querySelectorAll('[data-product-price-toggle]').forEach(button => button.onclick = () => toggleProductPricing(button.dataset.productPriceToggle, 'price'));
    document.querySelectorAll('[data-product-promotion-toggle]').forEach(button => button.onclick = () => toggleProductPricing(button.dataset.productPromotionToggle, 'promotion'));
  }

  function bindHandphonePricing(rows) {
    const groups = groupHandphonePricing(rows), findGroup = key => groups.find(group => group.key === key);
    document.querySelectorAll('[data-handphone-price-edit]').forEach(button => button.onclick = () => { const group = findGroup(button.dataset.handphonePriceEdit); if (group) editProductPricing(group.representative, group.records); });
    document.querySelectorAll('[data-handphone-price-toggle]').forEach(button => button.onclick = () => { const group = findGroup(button.dataset.handphonePriceToggle); if (group) toggleProductPricing(group.representative.id, 'price', group.records); });
    document.querySelectorAll('[data-handphone-promotion-toggle]').forEach(button => button.onclick = () => { const group = findGroup(button.dataset.handphonePromotionToggle); if (group) toggleProductPricing(group.representative.id, 'promotion', group.records); });
  }

  async function toggleProductPricing(id, type, group = []) {
    const item = state.data.pricing.find(record => record.id === id), enabled = type === 'price' ? !item.active : !item.promotionActive, pricingIds = group.map(record => record.id);
    const [storage] = optionParts(item.variant), scope = pricingIds.length > 1 ? ` ${storage} across ${pricingIds.length} colour SKUs` : '';
    if (!confirm(`${enabled ? 'Enable' : 'Disable'} ${item.brand} ${item.model}${scope} ${type}?`)) return;
    try { await post(type === 'price' ? 'setPricingEnabled' : 'setPromotionEnabled', { pricingId: item.id, pricingIds, businessUnit: unitOf(item), enabled }); await refreshProductPricing(); } catch (error) { alert(error.message); }
  }

  function editProductPricing(item = {}, pricingGroup = []) {
    const editing = Boolean(item.id), selectedUnit = editing ? unitOf(item) : (state.pricingBusiness || allowedUnits()[0]), handphone = selectedUnit === 'HANDPHONE', [storage] = optionParts(item.variant), groupCount = pricingGroup.length;
    formModal(`${editing ? 'Edit' : 'Add'} ${unitLabel(selectedUnit)} price and promotion`, `<form id="productPricingForm" class="crm-form"><input type="hidden" name="businessUnit" value="${selectedUnit}">${handphone ? `<div class="form-wide handphone-shared-price-note"><strong>One shared price for every colour</strong><span>${editing ? `${esc(`${item.brand} ${item.model} · ${storage || 'Standard'}`)} covers ${groupCount || 1} colour SKU${groupCount === 1 ? '' : 's'}. Saving here updates them together.` : 'Select a model and storage. The CRM will create the same price for every available colour.'}</span></div>` : ''}<h3 class="form-wide">${unitLabel(selectedUnit)} and standard financing</h3><label class="form-wide">${handphone ? 'Phone model and storage' : 'Catalog product'}<select name="catalogId" required><option value="">Select a ${unitLabel(selectedUnit).toLowerCase()} product</option>${handphone ? handphonePricingCatalogOptions(item.catalogId) : productCatalogOptions(selectedUnit, item.catalogId)}</select></label><label>Price zone<input name="zone" value="${esc(item.zone || 'EAST_MALAYSIA')}" list="businessPriceZones" required><datalist id="businessPriceZones"><option value="ALL_BRANCHES"><option value="EAST_MALAYSIA"><option value="WEST_MALAYSIA"><option value="SARAWAK"></datalist></label>${handphone ? `<label>Product price (RM)<input name="productPrice" type="number" min="0" step="0.01" value="${esc(item.productPrice || '')}" required></label>` : ''}<label>Standard deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.baseDeposit ?? item.deposit ?? '')}" required></label>${handphone ? `<label>Monthly 12 months (RM)<input name="month12" type="number" min="0" step="0.01" value="${esc(item.month12 || '')}" required></label><label>Monthly 24 months (RM)<input name="month24" type="number" min="0" step="0.01" value="${esc(item.month24 || '')}" required></label><label>Monthly 36 months (RM)<input name="month36" type="number" min="0" step="0.01" value="${esc(item.month36 || '')}" required></label><label>Monthly 48 months (RM)<input name="month48" type="number" min="0" step="0.01" value="${esc(item.month48 || '')}"></label>` : `<label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3 || '')}" required></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4 || '')}" required></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5 || '')}" required></label>`}<label>Pricing enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective || '')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo || '')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes || '')}</textarea></label><h3 class="form-wide">Promotion</h3><label>Promotion name<input name="promotionName" value="${esc(item.promotion || '')}"></label><label>Promotion deposit (RM)<input name="promotionDeposit" type="number" min="0" step="0.01" value="${esc(item.promotionDeposit || '')}"></label><label>Promotion start<input name="promotionStart" type="date" value="${esc(item.promotionStart || '')}"></label><label>Promotion end<input name="promotionEnd" type="date" value="${esc(item.promotionEnd || '')}"></label><label>Promotion enabled<select name="promotionActive"><option value="FALSE">Disabled</option><option value="TRUE">Enabled</option></select></label><label>Promotion approval<select name="promotionStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label class="form-wide">Promotion notes<textarea name="promotionNotes" rows="3">${esc(item.promotionNotes || '')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? (handphone ? 'Save shared price / promotion' : 'Save price / promotion') : (handphone ? 'Add shared price / promotion' : 'Add price / promotion')}</button></div><p class="form-wide notice" id="formMessage">${handphone ? 'Colour does not affect pricing. The same approved terms apply to every colour under this model and storage.' : 'Only approved, enabled and date-valid prices are customer-visible.'}</p></form>`);
    const form = document.getElementById('productPricingForm'); form.active.value = item.id ? (item.active ? 'TRUE' : 'FALSE') : 'FALSE'; form.quoteStatus.value = item.status || 'DRAFT'; form.promotionActive.value = item.promotionActive ? 'TRUE' : 'FALSE'; form.promotionStatus.value = item.promotionStatus || 'DRAFT'; form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove(); form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'); button.disabled = true; try { await post('savePricingPromotion', { pricingId: item.id || '', pricingIds: pricingGroup.map(record => record.id), pricingScope: handphone ? 'MODEL_STORAGE_ZONE' : '', ...Object.fromEntries(new FormData(form)) }); document.querySelector('.drawer-backdrop').remove(); await refreshProductPricing(); } catch (error) { message.textContent = error.message; button.disabled = false; } };
  }

  pricing = function () {
    const selected = isHandphonePricingView() ? 'HANDPHONE' : 'MOTOR';
    state.pricingBusiness = selected;
    const rows = state.data.pricing.filter(item => unitOf(item) === selected && !/TEMPLATE/i.test(String(item.id || ''))), admin = state.user?.role === 'ADMIN';
    const heading = selected === 'HANDPHONE' ? 'Handphone Pricing' : 'Motor Pricing & Promotions';
    const description = selected === 'HANDPHONE' ? 'Apple Malaysia retail prices are references only. Deposit and monthly instalments remain Draft until Admin approves JomKaki terms.' : (admin ? 'Manage Motor prices, financing and promotions without leaving CRM.' : 'Approved Motor customer pricing.');
    app.innerHTML = head(heading, description) + (selected === 'HANDPHONE' ? `<div class="pricing-safety-banner"><strong>Draft pricing safeguard</strong><span>These iPhone 17 prices are official Apple Malaysia retail references. They cannot be quoted to customers until Admin enters the approved deposit and monthly instalments, changes the status to Approved and enables the price group.</span></div>` : '') + `<div class="smart-toolbar"><input id="pricingSearch" placeholder="Search product, storage, zone or promotion"><span class="locked-business-pill ${selected === 'HANDPHONE' ? 'handphone' : ''}">${unitLabel(selected)} only</span><div class="toolbar-spacer"></div>${admin ? `<button class="primary" data-new-product-price>+ Add ${unitLabel(selected)} price</button>` : ''}</div><section class="panel" id="pricingResults">${selected === 'HANDPHONE' ? handphonePricingTable(rows) : productPricingTable(rows)}</section>`;
    document.getElementById('pricingSearch').oninput = event => { const query = event.target.value.toLowerCase(); document.getElementById('pricingResults').innerHTML = selected === 'HANDPHONE' ? handphonePricingTable(rows, query) : productPricingTable(rows.filter(item => Object.values(item).join(' ').toLowerCase().includes(query))); selected === 'HANDPHONE' ? bindHandphonePricing(rows) : bindProductPricing(); };
    document.querySelector('[data-new-product-price]')?.addEventListener('click', () => editProductPricing({ businessUnit: selected }));
    selected === 'HANDPHONE' ? bindHandphonePricing(rows) : bindProductPricing();
  };
})();
