(function () {
  const unitOf = record => String(record?.businessUnit || '').toUpperCase() === 'HANDPHONE' ? 'HANDPHONE' : 'MOTOR';
  const allowedUnits = () => {
    const role = String(state.user?.role || '').toUpperCase(), fallback = ['ADMIN', 'STAFF'].includes(role) ? 'BOTH' : role === 'BUSINESS_MANAGER' ? 'HANDPHONE' : 'MOTOR';
    const access = String(state.user?.businessAccess || fallback).toUpperCase();
    return access === 'BOTH' ? ['MOTOR', 'HANDPHONE'] : [access];
  };
  const unitLabel = unit => unit === 'HANDPHONE' ? 'Handphone' : 'Motor';
  const productRole = () => String(state.user?.role || '').toUpperCase().replace('BRANCH_MANAGER', 'BRANCH_SUPERVISOR');
  const canSubmitHandphone = () => ['ADMIN', 'REGION_MANAGER', 'BRANCH_SUPERVISOR', 'BUSINESS_MANAGER'].includes(productRole()) && allowedUnits().includes('HANDPHONE');
  const canDirectPublish = () => productRole() === 'ADMIN';
  const approvalLabel = item => pretty(item.approvalStatus || (item.active ? 'APPROVED' : 'PENDING_APPROVAL'));
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
    const admin = canDirectPublish(), manageable = canSubmitHandphone();
    const activeRows = rows.filter(item => String(item.approvalStatus).toUpperCase() !== 'MERGED' && (item.active || admin || (manageable && ['PENDING_APPROVAL', 'REJECTED'].includes(String(item.approvalStatus).toUpperCase()))));
    const families = [...activeRows.reduce((map, item) => {
      const entry = map.get(item.model) || { model: item.model, brand: item.brand, image: item.image || item.imageUrl, productPageUrl: item.productPageUrl, storage: new Set(), colours: new Set(), approval: new Set(), variants: [] };
      const [storage, colour] = optionParts(item.variant);
      if (storage) entry.storage.add(storage);
      if (colour) entry.colours.add(colour);
      entry.approval.add(String(item.approvalStatus || 'APPROVED').toUpperCase());
      entry.variants.push(item);
      if (!entry.image && item.image) entry.image = item.image;
      if (!entry.productPageUrl && item.productPageUrl) entry.productPageUrl = item.productPageUrl;
      map.set(item.model, entry);
      return map;
    }, new Map()).values()];
    const capacities = new Set(activeRows.map(item => optionParts(item.variant)[0]).filter(Boolean));
    const colours = new Set(activeRows.map(item => optionParts(item.variant)[1]).filter(Boolean));
    const pending = activeRows.filter(item => String(item.approvalStatus).toUpperCase() === 'PENDING_APPROVAL').length;
    if (manageable) return `<section class="handphone-catalog-overview"><div class="handphone-overview-copy"><span class="catalog-family-badge">APPLE · IPHONE 17 FAMILY</span><h2>One catalog card per phone model</h2><p>The five iPhone models are shown as five cards; storage and colour stay grouped inside each model. New models, images and structural changes require Regional Manager or Admin approval.</p><div class="handphone-summary-stats"><span><strong>${families.length}</strong> catalog cards</span><span><strong>${capacities.size}</strong> storage sizes</span><span><strong>${colours.size}</strong> colours</span><span><strong>${pending}</strong> pending approval</span></div></div></section><section class="handphone-family-grid">${families.map(family => `<article class="handphone-family-card"><div class="handphone-family-image">${family.image ? `<img src="${esc(family.image)}" alt="${esc(`${family.brand} ${family.model}`)}">` : '<span>No approved image</span>'}</div><div class="handphone-family-body"><span class="product-brand">${esc(family.brand)}</span><h3>${esc(family.model)}</h3>${family.approval.has('PENDING_APPROVAL') ? '<span class="pricing-pending">Pending approval</span>' : family.approval.has('REJECTED') ? '<span class="pricing-pending">Correction required</span>' : ''}<p class="option-label">Storage options</p><div class="option-chip-row">${[...family.storage].map(storage => `<span class="product-option-chip">${esc(storage)}</span>`).join('')}</div><p class="option-label">Colour options</p><div class="colour-option-list">${[...family.colours].map(colour => `<span class="colour-option"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('')}</div><div class="handphone-card-actions">${family.productPageUrl ? `<a class="official-product-link" href="${esc(family.productPageUrl)}" target="_blank" rel="noopener">Official Apple page</a>` : ''}<button class="row-action" data-manage-phone-model="${esc(family.model)}">Manage ${family.variants.length} options</button></div></div></article>`).join('')}</section>`;
    return `<section class="handphone-catalog-overview"><div class="handphone-overview-copy"><span class="catalog-family-badge">APPLE · IPHONE 17 FAMILY</span><h2>One catalog card per phone model</h2><p>Storage and colour are options inside each model, not separate products. The exact combination is selected only when creating an application.</p><div class="handphone-summary-stats"><span><strong>${families.length}</strong> catalog cards</span><span><strong>${capacities.size}</strong> storage sizes</span><span><strong>${colours.size}</strong> colours</span><span><strong>${activeRows.length}</strong> exact combinations</span></div></div></section><section class="handphone-family-grid">${families.map(family => `<article class="handphone-family-card"><div class="handphone-family-image">${family.image ? `<img src="${esc(family.image)}" alt="${esc(`${family.brand} ${family.model}`)}">` : '<span>No approved image</span>'}</div><div class="handphone-family-body"><span class="product-brand">${esc(family.brand)}</span><h3>${esc(family.model)}</h3><p class="option-label">Storage options</p><div class="option-chip-row">${[...family.storage].map(storage => `<span class="product-option-chip">${esc(storage)}</span>`).join('')}</div><p class="option-label">Colour options</p><div class="colour-option-list">${[...family.colours].map(colour => `<span class="colour-option"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('')}</div><div class="handphone-card-actions">${family.productPageUrl ? `<a class="official-product-link" href="${esc(family.productPageUrl)}" target="_blank" rel="noopener">Official Apple page</a>` : ''}${admin ? `<button class="row-action" data-manage-phone-model="${esc(family.model)}">Manage ${family.variants.length} options</button>` : ''}</div></div></article>`).join('')}</section>`;
  }

  function openHandphoneModelOptions(model, rows) {
    const options = rows.filter(item => item.model === model && String(item.approvalStatus).toUpperCase() !== 'MERGED');
    if (canSubmitHandphone()) {
      drawer(`${esc(model)} options`, 'Branch stock is immediate. Catalog and image changes require approval.', `<div class="handphone-option-note"><strong>Controlled Handphone workflow</strong><span>Branch stock can be updated immediately. New models, images and structural changes stay hidden until a Regional Manager or Admin approves them.</span></div><div class="table-card handphone-option-table"><table class="data-table"><thead><tr><th>Storage</th><th>Colour</th><th>Branch stock</th><th>Approval</th><th>Actions</th></tr></thead><tbody>${options.map(item => { const [storage, colour] = optionParts(item.variant), pending = String(item.approvalStatus).toUpperCase() === 'PENDING_APPROVAL', approved = String(item.approvalStatus).toUpperCase() === 'APPROVED'; return `<tr><td><strong>${esc(storage || 'Standard')}</strong></td><td><span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour || 'Default')}</span></td><td>${esc(item.branchAvailability || 'No branch update yet')}<small>${pretty(item.stock)}</small></td><td>${pill(approvalLabel(item), approved)}<small>${esc(item.approvalNotes || (pending ? `Submitted by ${item.submittedBy || 'branch'}` : ''))}</small></td><td><div class="inline-admin-actions">${item.canEdit && (!canDirectPublish() || approved) ? `<button class="row-action" data-product-edit="${esc(item.id)}">Edit / submit</button>` : ''}${item.canEdit && approved ? `<button class="row-action secondary" data-phone-stock="${esc(item.id)}">Update stock</button>` : ''}${item.canReview && pending ? `<button class="row-action" data-phone-catalog-approve="${esc(item.id)}">Approve</button><button class="row-action secondary" data-phone-catalog-reject="${esc(item.id)}">Reject</button>` : ''}${canDirectPublish() && approved ? `<button class="row-action secondary" data-product-toggle="${esc(item.id)}">${item.active ? 'Disable' : 'Restore'}</button>` : ''}</div></td></tr>`; }).join('')}</tbody></table></div>`);
      bindProductCatalog();
      bindHandphoneApprovalActions(options);
      return;
    }
    drawer(`${esc(model)} options`, 'Storage and colour combinations are kept behind one catalog card.', `<div class="handphone-option-note"><strong>Why these records are separate underneath</strong><span>Each exact storage and colour combination needs its own SKU for stock, AI selection and loan applications. Customers and staff still see one phone model card.</span></div><div class="table-card handphone-option-table"><table class="data-table"><thead><tr><th>Storage</th><th>Colour</th><th>Availability</th><th>Status</th><th>Admin</th></tr></thead><tbody>${options.map(item => { const [storage, colour] = optionParts(item.variant); return `<tr><td><strong>${esc(storage || 'Standard')}</strong></td><td><span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour || 'Default')}</span></td><td>${pretty(item.stock)}<small>${esc(item.regionAvailability || item.warehouseAvailability || 'Check warehouse')}</small></td><td>${pill(item.active ? 'Active' : 'Inactive', item.active)}</td><td><div class="inline-admin-actions"><button class="row-action" data-product-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-toggle="${esc(item.id)}">${item.active ? 'Disable' : 'Restore'}</button></div></td></tr>`; }).join('')}</tbody></table></div>`);
    bindProductCatalog();
  }

  function bindHandphoneApprovalActions(rows) {
    const find = id => rows.find(item => item.id === id);
    document.querySelectorAll('[data-phone-catalog-approve]').forEach(button => button.onclick = () => reviewHandphoneCatalog(find(button.dataset.phoneCatalogApprove), 'APPROVED'));
    document.querySelectorAll('[data-phone-catalog-reject]').forEach(button => button.onclick = () => reviewHandphoneCatalog(find(button.dataset.phoneCatalogReject), 'REJECTED'));
    document.querySelectorAll('[data-phone-stock]').forEach(button => button.onclick = () => editHandphoneBranchStock(find(button.dataset.phoneStock)));
  }

  async function reviewHandphoneCatalog(item, decision) {
    if (!item) return;
    const notes = decision === 'REJECTED' ? prompt('Reason for rejection (required):') : prompt('Approval notes (optional):', '') || '';
    if (decision === 'REJECTED' && !String(notes || '').trim()) return;
    if (!confirm(`${decision === 'APPROVED' ? 'Approve and publish' : 'Reject'} ${item.brand} ${item.model} ${item.variant}?`)) return;
    try { await post('reviewHandphoneCatalog', { businessUnit: 'HANDPHONE', catalogId: item.id, decision, notes }); document.querySelector('.drawer-backdrop')?.remove(); await refreshProductCatalog(); } catch (error) { alert(error.message); }
  }

  function editHandphoneBranchStock(item) {
    if (!item) return;
    const branchMap = new Map(state.data.team.filter(member => member.branchId).map(member => [member.branchId, member.branch || member.branchId]));
    if (state.user?.branchId && !branchMap.has(state.user.branchId)) branchMap.set(state.user.branchId, state.user.branchId);
    const branches = [...branchMap.entries()].map(([id, name]) => `<option value="${esc(id)}">${esc(name)} · ${esc(id)}</option>`).join(''), fixedBranch = productRole() === 'BRANCH_SUPERVISOR';
    const current = (item.branchStock || []).find(stock => stock.branchId === state.user?.branchId) || {};
    formModal('Update Handphone branch stock', `<form id="handphoneStockForm" class="crm-form"><div class="form-wide handphone-option-note"><strong>${esc(`${item.brand} ${item.model} ${item.variant}`)}</strong><span>Stock updates take effect immediately and do not change approved catalog photos or prices.</span></div><label>Branch<select name="branchId" ${fixedBranch ? 'disabled' : ''} required><option value="">Select branch</option>${branches}</select></label><label>Status<select name="status"><option value="IN_STOCK">In stock</option><option value="LOW_STOCK">Low stock</option><option value="OUT_OF_STOCK">Out of stock</option></select></label><label>Quantity<input name="quantity" type="number" min="0" step="1" value="${esc(current.quantity ?? 0)}" required></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">Update stock now</button></div><p class="form-wide notice" id="formMessage">Every stock update is written to Activity & Audit.</p></form>`);
    const form = document.getElementById('handphoneStockForm'); form.branchId.value = fixedBranch ? state.user.branchId : (current.branchId || ''); form.status.value = current.status || 'IN_STOCK'; form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove();
    form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'), values = Object.fromEntries(new FormData(form)); values.branchId = fixedBranch ? state.user.branchId : form.branchId.value; button.disabled = true; try { await post('setHandphoneStockAvailability', { businessUnit: 'HANDPHONE', catalogId: item.id, ...values }); document.querySelector('.drawer-backdrop').remove(); await refreshProductCatalog(); } catch (error) { message.textContent = error.message; button.disabled = false; } };
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
    formModal(`${editing ? 'Edit' : 'Add'} ${unitLabel(selectedUnit)} product`, `<form id="productCatalogForm" class="crm-form"><label>Business unit<select name="businessUnit" ${editing ? 'disabled' : ''}>${unitOptions(selectedUnit)}</select></label><label>Brand<input name="brand" value="${esc(item.brand || '')}" required></label><label>Model<input name="model" value="${esc(item.model || '')}" required></label><label>Variant / storage / colour<input name="variant" value="${esc(item.variant || 'Standard')}"></label><label>Category<input name="category" value="${esc(item.category || (selectedUnit === 'HANDPHONE' ? 'SMARTPHONE' : 'MOPED'))}" required></label><label class="motor-only">Fuel type<select name="fuel"><option value="PETR…5604 tokens truncated…ption value="EAST_MALAYSIA"><option value="WEST_MALAYSIA"><option value="SARAWAK"></datalist></label>${handphone ? `<label>Product price (RM)<input name="productPrice" type="number" min="0" step="0.01" value="${esc(item.productPrice || '')}" required></label>` : ''}<label>Standard deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.baseDeposit ?? item.deposit ?? '')}" required></label>${handphone ? `<label>Monthly 12 months (RM)<input name="month12" type="number" min="0" step="0.01" value="${esc(item.month12 || '')}" required></label><label>Monthly 24 months (RM)<input name="month24" type="number" min="0" step="0.01" value="${esc(item.month24 || '')}" required></label><label>Monthly 36 months (RM)<input name="month36" type="number" min="0" step="0.01" value="${esc(item.month36 || '')}" required></label><label>Monthly 48 months (RM)<input name="month48" type="number" min="0" step="0.01" value="${esc(item.month48 || '')}"></label>` : `<label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3 || '')}" required></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4 || '')}" required></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5 || '')}" required></label>`}<label>Pricing enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective || '')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo || '')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes || '')}</textarea></label><h3 class="form-wide">Promotion</h3><label>Promotion name<input name="promotionName" value="${esc(item.promotion || '')}"></label><label>Promotion deposit (RM)<input name="promotionDeposit" type="number" min="0" step="0.01" value="${esc(item.promotionDeposit || '')}"></label><label>Promotion start<input name="promotionStart" type="date" value="${esc(item.promotionStart || '')}"></label><label>Promotion end<input name="promotionEnd" type="date" value="${esc(item.promotionEnd || '')}"></label><label>Promotion enabled<select name="promotionActive"><option value="FALSE">Disabled</option><option value="TRUE">Enabled</option></select></label><label>Promotion approval<select name="promotionStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label class="form-wide">Promotion notes<textarea name="promotionNotes" rows="3">${esc(item.promotionNotes || '')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? (handphone ? 'Save shared price / promotion' : 'Save price / promotion') : (handphone ? 'Add shared price / promotion' : 'Add price / promotion')}</button></div><p class="form-wide notice" id="formMessage">${handphone ? 'Colour does not affect pricing. The same approved terms apply to every colour under this model and storage.' : 'Only approved, enabled and date-valid prices are customer-visible.'}</p></form>`);
    const form = document.getElementById('productPricingForm'); form.active.value = item.id ? (item.active ? 'TRUE' : 'FALSE') : 'FALSE'; form.quoteStatus.value = item.status || 'DRAFT'; form.promotionActive.value = item.promotionActive ? 'TRUE' : 'FALSE'; form.promotionStatus.value = item.promotionStatus || 'DRAFT'; form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove(); form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'); button.disabled = true; try { await post('savePricingPromotion', { pricingId: item.id || '', pricingIds: pricingGroup.map(record => record.id), pricingScope: handphone ? 'MODEL_STORAGE_ZONE' : '', ...Object.fromEntries(new FormData(form)) }); document.querySelector('.drawer-backdrop').remove(); await refreshProductPricing(); } catch (error) { message.textContent = error.message; button.disabled = false; } };
    if (handphone && canDirectPublish()) {
      form.productPrice.closest('label').insertAdjacentHTML('afterend', `<label>Minimum product price (RM)<input name="minimumProductPrice" type="number" min="0" step="0.01" value="${esc(item.minimumProductPrice || item.productPrice || '')}"></label>`);
    }
    if (handphone && !canDirectPublish()) {
      form.quoteStatus.closest('label').remove(); form.promotionStatus.closest('label').remove();
      const publish = form.active, publishLabel = publish.closest('label'); publish.name = 'publishRequested'; publishLabel.firstChild.textContent = 'Price publication request'; publish.innerHTML = '<option value="FALSE">Keep internal after approval</option><option value="TRUE">Publish after approval</option>'; publish.value = item.publishRequested ? 'TRUE' : 'FALSE';
      const promotionPublish = form.promotionActive, promotionLabel = promotionPublish.closest('label'); promotionPublish.name = 'promotionPublishRequested'; promotionLabel.firstChild.textContent = 'Promotion publication request'; promotionPublish.innerHTML = '<option value="FALSE">Keep promotion disabled</option><option value="TRUE">Publish promotion after approval</option>'; promotionPublish.value = item.promotionPublishRequested ? 'TRUE' : 'FALSE';
      form.zone.value = state.user?.region || item.submittedRegion || item.zone; form.zone.readOnly = true; form.querySelector('[type=submit]').textContent = 'Submit pricing for approval';
      document.getElementById('formMessage').textContent = item.approvalStatus === 'REJECTED' && item.approvalNotes ? `Rejected: ${item.approvalNotes}. Correct and resubmit.` : 'The current approved price remains controlled. This submission is hidden until Regional Manager or Admin approval; price-floor exceptions require Admin.';
    }
  }

  const originalProductPricingEditor = editProductPricing;

  const motorMonthlySummary = item => {
    const terms = [[item.year3, '3 years'], [item.year4, '4 years'], [item.year5, '5 years']]
      .filter(([value]) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0);
    return terms.length ? terms.map(([value, label]) => `${money(value)}/month - ${label}`).join('<br>') : '<span class="pricing-muted">No approved monthly payment</span>';
  };

  productPricingTable = function (rows) {
    const admin = state.user?.role === 'ADMIN';
    return `<div class="table-card"><table class="data-table"><thead><tr><th>Product & admin actions</th><th>Zone</th><th>Standard financing</th><th>Promotion</th><th>Validity</th><th>Status</th></tr></thead><tbody>${rows.map(item => `<tr><td><strong>${esc(`${item.brand} ${item.model}`)}</strong><small>${unitLabel(unitOf(item))} · ${esc(item.variant)} · ${esc(item.id)}</small>${admin ? `<div class="inline-admin-actions"><button class="row-action" data-product-price-edit="${esc(item.id)}">Edit</button><button class="row-action secondary" data-product-price-toggle="${esc(item.id)}">${item.active ? 'Disable price' : 'Enable price'}</button>${item.promotion ? `<button class="row-action secondary" data-product-promotion-toggle="${esc(item.id)}">${item.promotionActive ? 'Disable promotion' : 'Enable promotion'}</button>` : ''}</div>` : ''}</td><td>${pretty(item.zone)}</td><td>${pendingMoney(item.baseDeposit || item.deposit)} deposit<small>${motorMonthlySummary(item)}</small></td><td><strong>${esc(item.promotion || 'No promotion')}</strong><small>${item.promotionDeposit ? `${money(item.promotionDeposit)} deposit` : 'No active offer'}</small></td><td>${esc(item.effective || 'No start')}<small>to ${esc(item.effectiveTo || 'No end')}</small></td><td>${pill(item.active ? item.status : 'Draft / disabled', item.active && item.status === 'APPROVED')}<small>${item.promotion ? `Promotion: ${pretty(item.promotionStatus)} · ${item.promotionActive ? 'Enabled' : 'Disabled'}` : 'Standard pricing'}</small></td></tr>`).join('') || empty(6)}</tbody></table></div>`;
  };

  const phoneMonthlySummary = item => {
    const terms = [
      [item.month12, '1 year'],
      [item.month24, '2 years'],
      [item.month36, '3 years'],
      [item.month48, '4 years'],
      [item.month60, '5 years']
    ].filter(([value]) => value !== '' && value !== null && value !== undefined);
    return terms.length ? terms.map(([value, label]) => `${money(value)}/month - ${label}`).join('<br>') : '<span class="pricing-muted">No approved monthly payment</span>';
  };

  handphonePricingTable = function (rows, query = '') {
    const admin = canDirectPublish(), normalizedQuery = String(query || '').trim().toLowerCase();
    const groups = groupHandphonePricing(rows).filter(group => !normalizedQuery || [group.brand, group.model, group.storage, group.zone, ...group.colours, ...group.records.flatMap(item => [item.status])].join(' ').toLowerCase().includes(normalizedQuery));
    const pending = groups.filter(group => String(group.representative.approvalStatus).toUpperCase() === 'PENDING_APPROVAL').length;
    return `<div class="handphone-pricing-summary"><div><span class="catalog-family-badge">MONTHLY PAYMENT ONLY</span><h2>One monthly-payment set per model, storage and region</h2><p>Every colour under the same model and storage uses the same approved monthly payment. Selling price and deposit are not stored, displayed or provided to AI.</p></div><div class="handphone-summary-stats"><span><strong>${groups.length}</strong> payment groups</span><span><strong>${pending}</strong> pending approval</span></div></div><div class="table-card"><table class="data-table"><thead><tr><th>Model & storage</th><th>Included colours</th><th>Region</th><th>Available monthly payments</th><th>Approval</th><th>Actions</th></tr></thead><tbody>${groups.map(group => { const item = group.representative, colours = [...group.colours], pendingStatus = String(item.approvalStatus).toUpperCase() === 'PENDING_APPROVAL', ids = handphonePricingWorkflowRecords(group).map(record => record.id).join(','); return `<tr><td><strong>${esc(`${group.brand} ${group.model}`)}</strong><div class="catalog-option-line"><span class="product-option-chip">${esc(group.storage)}</span></div><small>${group.records.length} colour SKU${group.records.length === 1 ? '' : 's'} share these monthly payments</small></td><td><div class="colour-option-list compact-list">${colours.map(colour => `<span class="colour-option compact"><i style="--colour:${colourTone(colour)}"></i>${esc(colour)}</span>`).join('') || '<span class="pricing-muted">All available colours</span>'}</div></td><td>${pretty(group.zone)}</td><td>${phoneMonthlySummary(item)}</td><td>${pill(approvalLabel(item), item.approvalStatus === 'APPROVED')}<small>${esc(item.approvalNotes || 'Monthly-payment approval')}</small></td><td><div class="inline-admin-actions">${item.canEdit ? `<button class="row-action" data-handphone-price-edit="${esc(group.key)}">Edit monthly payments</button>` : ''}${item.canReview && pendingStatus ? `<button class="row-action" data-phone-price-approve="${esc(ids)}">Approve</button><button class="row-action secondary" data-phone-price-reject="${esc(ids)}">Reject</button>` : ''}${admin && item.approvalStatus === 'APPROVED' ? `<button class="row-action secondary" data-handphone-price-toggle="${esc(group.key)}">${item.active ? 'Disable payments' : 'Enable payments'}</button>` : ''}</div></td></tr>`; }).join('') || empty(6)}</tbody></table></div><p class="notice pricing-structure-note"><strong>AI safeguard:</strong> only approved, enabled and date-valid monthly payments can be quoted. Phone selling price and deposit are never returned by the CRM API.</p>`;
  };

  editProductPricing = function (item = {}, pricingGroup = []) {
    const selectedUnit = item.id ? unitOf(item) : (state.pricingBusiness || allowedUnits()[0]);
    if (selectedUnit !== 'HANDPHONE') {
      originalProductPricingEditor(item, pricingGroup);
      const motorForm = document.getElementById('productPricingForm');
      ['year3', 'year4', 'year5'].forEach(name => motorForm?.elements[name]?.removeAttribute('required'));
      motorForm?.elements.year5?.closest('label')?.insertAdjacentHTML('afterend', '<p class="form-wide notice">Fill only the tenures offered for this motor. Leave unavailable tenures blank; at least one monthly instalment is required.</p>');
      return;
    }
    const editing = Boolean(item.id), [storage] = optionParts(item.variant), groupCount = pricingGroup.length;
    formModal(`${editing ? 'Edit' : 'Add'} Handphone monthly payments`, `<form id="productPricingForm" class="crm-form"><input type="hidden" name="businessUnit" value="HANDPHONE"><input type="hidden" name="promotionStatus" value="DRAFT"><input type="hidden" name="promotionActive" value="FALSE"><div class="form-wide handphone-shared-price-note"><strong>Monthly payment only - one set for every colour</strong><span>${editing ? `${esc(`${item.brand} ${item.model} - ${storage || 'Standard'}`)} covers ${groupCount || 1} colour SKU${groupCount === 1 ? '' : 's'}. Saving updates them together.` : 'Select a model and storage. The CRM applies the same monthly payments to every available colour.'}</span></div><h3 class="form-wide">Phone model and monthly payments</h3><label class="form-wide">Phone model and storage<select name="catalogId" required><option value="">Select a handphone product</option>${handphonePricingCatalogOptions(item.catalogId)}</select></label><label>Price zone<input name="zone" value="${esc(item.zone || 'EAST_MALAYSIA')}" list="businessPriceZones" required><datalist id="businessPriceZones"><option value="ALL_BRANCHES"><option value="EAST_MALAYSIA"><option value="WEST_MALAYSIA"><option value="SARAWAK"></datalist></label><label>Monthly 1 year (RM)<input name="month12" type="number" min="0" step="0.01" value="${esc(item.month12 || '')}"></label><label>Monthly 2 years (RM)<input name="month24" type="number" min="0" step="0.01" value="${esc(item.month24 || '')}"></label><label>Monthly 3 years (RM)<input name="month36" type="number" min="0" step="0.01" value="${esc(item.month36 || '')}"></label><label>Monthly 4 years (RM)<input name="month48" type="number" min="0" step="0.01" value="${esc(item.month48 || '')}"></label><label>Monthly 5 years (RM)<input name="month60" type="number" min="0" step="0.01" value="${esc(item.month60 || '')}"></label><label>Monthly payments enabled<select name="active"><option value="TRUE">Enabled</option><option value="FALSE">Disabled</option></select></label><label>Quote approval<select name="quoteStatus"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAUSED">Paused</option></select></label><label>Effective from<input name="effectiveFrom" type="date" value="${esc(item.effective || '')}"></label><label>Effective to<input name="effectiveTo" type="date" value="${esc(item.effectiveTo || '')}"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes || '')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? 'Save shared monthly payments' : 'Add shared monthly payments'}</button></div><p class="form-wide notice" id="formMessage">Fill only the years offered. Blank years are not quoted by AI. Selling price and deposit are neither collected nor stored.</p></form>`);
    const form = document.getElementById('productPricingForm');
    form.active.value = item.id ? (item.active ? 'TRUE' : 'FALSE') : 'FALSE';
    form.quoteStatus.value = item.status || 'DRAFT';
    form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove();
    if (!canDirectPublish()) {
      form.quoteStatus.closest('label').remove();
      const publish = form.active, publishLabel = publish.closest('label');
      publish.name = 'publishRequested';
      publishLabel.firstChild.textContent = 'Monthly-payment publication request';
      publish.innerHTML = '<option value="FALSE">Keep internal after approval</option><option value="TRUE">Publish after approval</option>';
      publish.value = item.publishRequested ? 'TRUE' : 'FALSE';
      form.zone.value = state.user?.region || item.submittedRegion || item.zone;
      form.zone.readOnly = true;
      form.querySelector('[type=submit]').textContent = 'Submit monthly payments for approval';
    }
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage');
      button.disabled = true;
      try {
        await post('savePricingPromotion', { pricingId: item.id || '', pricingIds: pricingGroup.map(record => record.id), pricingScope: 'MODEL_STORAGE_ZONE', productPrice: '', deposit: '', promotionName: '', promotionDeposit: '', promotionStart: '', promotionEnd: '', promotionNotes: '', ...Object.fromEntries(new FormData(form)) });
        document.querySelector('.drawer-backdrop').remove();
        await refreshProductPricing();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    };
  };

  pricing = function () {
    const selected = isHandphonePricingView() ? 'HANDPHONE' : 'MOTOR';
    state.pricingBusiness = selected;
    const rows = state.data.pricing.filter(item => unitOf(item) === selected && !/TEMPLATE/i.test(String(item.id || ''))), admin = canDirectPublish(), phoneSubmitter = selected === 'HANDPHONE' && canSubmitHandphone();
    const heading = selected === 'HANDPHONE' ? 'Handphone Pricing' : 'Motor Pricing & Promotions';
    const description = selected === 'HANDPHONE' ? 'Manage approved monthly payments by model, storage and region. Selling price and deposit are intentionally excluded.' : (admin ? 'Manage Motor prices, financing and promotions without leaving CRM.' : 'Approved Motor customer pricing.');
    app.innerHTML = head(heading, description) + (selected === 'HANDPHONE' ? `<div class="pricing-safety-banner"><strong>Monthly-payment-only safeguard</strong><span>AI can quote only approved, enabled and date-valid monthly payments. Phone selling price and deposit are never collected or exposed.</span></div>` : '') + `<div class="smart-toolbar"><input id="pricingSearch" placeholder="Search product, storage or zone"><span class="locked-business-pill ${selected === 'HANDPHONE' ? 'handphone' : ''}">${unitLabel(selected)} only</span><div class="toolbar-spacer"></div>${admin || phoneSubmitter ? `<button class="primary" data-new-product-price>+ Submit ${selected === 'HANDPHONE' ? 'monthly payments' : `${unitLabel(selected)} price`}</button>` : ''}</div><section class="panel" id="pricingResults">${selected === 'HANDPHONE' ? handphonePricingTable(rows) : productPricingTable(rows)}</section>`;
    document.getElementById('pricingSearch').oninput = event => { const query = event.target.value.toLowerCase(); document.getElementById('pricingResults').innerHTML = selected === 'HANDPHONE' ? handphonePricingTable(rows, query) : productPricingTable(rows.filter(item => Object.values(item).join(' ').toLowerCase().includes(query))); selected === 'HANDPHONE' ? bindHandphonePricing(rows) : bindProductPricing(); };
    document.querySelector('[data-new-product-price]')?.addEventListener('click', () => editProductPricing({ businessUnit: selected }));
    selected === 'HANDPHONE' ? bindHandphonePricing(rows) : bindProductPricing();
  };
})();
