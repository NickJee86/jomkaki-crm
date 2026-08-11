(function () {
  state.data.usedMotors = state.data.usedMotors || [];

  const baseEnsureViewData = ensureViewData;
  ensureViewData = async function (view) {
    if (view !== 'usedMotorInventory') return baseEnsureViewData(view);
    if (loadedResources.has('secondHandMotors')) return;
    app.innerHTML = '<div class="v2-loading"><div class="spinner"></div><p>Loading second-hand motor inventory...</p></div>';
    const response = await get('secondHandMotors');
    state.data.usedMotors = response.records || [];
    loadedResources.add('secondHandMotors');
  };

  const baseRender = render;
  render = function () {
    baseRender();
    if (state.view === 'usedMotorInventory') renderSecondHandInventory();
  };

  const amountLabel = value => value !== '' && value !== null && value !== undefined ? `RM ${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'Pending';
  const motorTitle = motor => [motor.brand, motor.model, motor.variant].filter(Boolean).join(' ');
  const approvalStatus = motor => String(motor.approvalStatus || 'PENDING_APPROVAL').toUpperCase();
  const customerStatus = motor => approvalStatus(motor) === 'REJECTED' ? 'Approval rejected' : approvalStatus(motor) !== 'APPROVED' ? 'Pending approval' : motor.status === 'AVAILABLE' && motor.customerVisible ? 'Visible to customer & AI' : motor.status === 'AVAILABLE' ? 'Approved - internal only' : pretty(motor.status);
  const branchChoices = selected => {
    const pairs = new Map();
    (state.data.team || []).forEach(item => item.branchId && pairs.set(item.branchId, item.branch || item.branchId));
    (state.data.usedMotors || []).forEach(item => item.branchId && pairs.set(item.branchId, item.branch || item.branchId));
    if (selected?.branchId) pairs.set(selected.branchId, selected.branch || selected.branchId);
    return [...pairs.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${esc(id)}">${esc(name)} - ${esc(id)}</option>`).join('');
  };

  function motorPhoto(motor) {
    const photo = motor.photos?.[0];
    return photo ? `<a class="second-hand-photo" href="${esc(photo)}" target="_blank" rel="noopener"><img src="${esc(photo)}" alt="${esc(motorTitle(motor))}" loading="lazy"><span class="photo-fallback">Open motor photo</span></a>` : '<div class="second-hand-photo empty-photo"><strong>Photo pending</strong><span>Admin can take a photo from phone</span></div>';
  }

  function motorCard(motor, recommendation = false) {
    const canEdit = Boolean(motor.canEdit), canReview = Boolean(motor.canReview), approval = approvalStatus(motor);
    const match = recommendation ? `<div class="recommendation-reason">${motor.matchType === 'EXACT_MODEL' ? 'Exact requested model' : motor.matchType === 'SIMILAR_PRICE' ? 'Similar price alternative' : motor.matchType === 'SAME_BRAND_ALTERNATIVE' ? 'Same brand alternative' : 'Closest available alternative'}${motor.sameRegion ? ' - same region' : ' - different region'}</div>` : '';
    const approvalDetail = !recommendation && approval !== 'APPROVED' ? `<div class="approval-strip ${approval === 'REJECTED' ? 'approval-rejected' : ''}"><strong>${approval === 'REJECTED' ? 'Changes required' : 'Waiting for approval'}</strong><span>${esc(motor.approvalNotes || (approval === 'REJECTED' ? 'Regional Manager or Admin has returned this listing.' : `Submitted by ${motor.submittedBy || 'branch'}${motor.submittedAt ? ` on ${when(motor.submittedAt)}` : ''}.`))}</span></div>` : '';
    const actions = !recommendation && (canEdit || canReview) ? `<div class="inventory-actions">${canEdit ? `<button class="row-action" data-edit-used-motor="${esc(motor.id)}">Edit / photos / pricing</button><button class="row-action secondary" data-used-status="${esc(motor.id)}" data-status="${motor.status === 'AVAILABLE' ? 'HOLD' : 'AVAILABLE'}">${motor.status === 'AVAILABLE' ? 'Put on hold' : 'Make available'}</button>${motor.status !== 'SOLD' ? `<button class="row-action danger" data-used-status="${esc(motor.id)}" data-status="SOLD">Mark sold</button>` : ''}` : ''}${canReview && approval !== 'APPROVED' ? `<button class="row-action approve" data-review-used-motor="${esc(motor.id)}" data-decision="APPROVED">Approve & publish</button><button class="row-action danger" data-review-used-motor="${esc(motor.id)}" data-decision="REJECTED">Reject</button>` : ''}</div>` : '';
    return `<article class="second-hand-card ${motor.status !== 'AVAILABLE' ? 'stock-unavailable' : ''} approval-${approval.toLowerCase()}">${motorPhoto(motor)}<div class="second-hand-card-body">${match}<div class="inventory-card-head"><div><span class="inventory-id">${esc(motor.id)}</span><h3>${esc(motorTitle(motor))}</h3></div>${pill(customerStatus(motor), approval === 'APPROVED' && motor.status === 'AVAILABLE' && motor.customerVisible)}</div>${approvalDetail}<div class="motor-spec-grid"><span><b>${esc(motor.year || 'Pending')}</b>Year</span><span><b>${esc(motor.mileageKm ? Number(motor.mileageKm).toLocaleString('en-MY') + ' km' : 'Pending')}</b>Mileage</span><span><b>${esc(motor.engineCc ? motor.engineCc + ' cc' : 'Pending')}</b>Engine</span><span><b>${esc(motor.conditionGrade || 'Pending')}</b>Condition</span></div><div class="motor-location"><strong>${esc(motor.location || motor.branch || 'Location pending')}</strong><span>${pretty(motor.region)}${motor.viewingNotes ? ` - ${esc(motor.viewingNotes)}` : ''}</span></div><div class="motor-price"><div><span>Selling price</span><strong>${amountLabel(motor.price)}</strong></div><div><span>Deposit</span><b>${amountLabel(motor.deposit)}</b></div></div><div class="motor-financing"><span>3 years: <b>${amountLabel(motor.year3)}</b></span><span>4 years: <b>${amountLabel(motor.year4)}</b></span><span>5 years: <b>${amountLabel(motor.year5)}</b></span></div>${motor.conditionNotes ? `<p class="condition-note">${esc(motor.conditionNotes)}</p>` : ''}${actions}</div></article>`;
  }

  function renderSecondHandInventory() {
    const role = state.user?.role, canSubmit = ['ADMIN', 'REGION_MANAGER', 'BRANCH_SUPERVISOR', 'BRANCH_MANAGER'].includes(role), rows = state.data.usedMotors || [];
    const available = rows.filter(item => item.status === 'AVAILABLE').length, customerVisible = rows.filter(item => item.status === 'AVAILABLE' && item.customerVisible && approvalStatus(item) === 'APPROVED').length, pending = rows.filter(item => approvalStatus(item) === 'PENDING_APPROVAL').length;
    app.innerHTML = head('2nd Hand Motor Inventory', 'Branch Supervisors submit each physical motor, photos and pricing. Regional Managers approve their region; Admin can approve company-wide. Only approved records can be shown to customers or used by AI.') + `<div class="approval-workflow"><strong>Branch submission → Regional/Admin approval → Customer & AI publication</strong><span>Any edit to photos, price, condition or location automatically returns the listing to Pending Approval.</span></div><div class="metric-grid compact-metrics">${metric('Total units', rows.length, role === 'ADMIN' ? 'All statuses' : 'Within your access')}${metric('Pending approval', pending, 'Hidden from customers and AI')}${metric('Available', available, 'Can still be reserved')}${metric('AI customer-visible', customerVisible, 'Approved recommendations only')}</div><section class="panel second-hand-ai-panel"><div class="panel-head"><div><span class="eyebrow">AI RECOMMENDATION PREVIEW</span><h3>Test what AI will offer a customer</h3><p>Only approved, available and customer-visible units are eligible. Exact models appear first, followed by similar-price motors in the same region.</p></div></div><form id="usedMotorAiForm" class="ai-motor-search"><input name="query" placeholder="Example: Yamaha Y15ZR" required><input name="budget" type="number" min="0" step="100" placeholder="Budget RM (optional)"><select name="region"><option value="">Any permitted region</option><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select><button type="submit">Find for customer</button></form><div id="usedMotorRecommendations" class="recommendation-empty">Enter a model to preview the AI result.</div></section><div class="smart-toolbar second-hand-toolbar"><input id="usedMotorSearch" placeholder="Search model, year, price, condition or location"><select id="usedMotorStatus"><option value="">All stock statuses</option><option value="AVAILABLE">Available</option><option value="RESERVED">Reserved</option><option value="HOLD">Hold</option><option value="SOLD">Sold</option><option value="INACTIVE">Inactive</option></select><select id="usedMotorApproval"><option value="">All approval statuses</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select><div class="toolbar-spacer"></div>${canSubmit ? '<button class="primary" data-add-used-motor>+ Submit 2nd hand motor</button>' : ''}</div><div id="usedMotorResults" class="second-hand-grid">${rows.map(item => motorCard(item)).join('') || '<div class="customer-360-empty"><strong>No second-hand motors yet</strong><p>A Branch Supervisor, Regional Manager or Admin can submit the first unit with photos and pricing.</p></div>'}</div>`;
    bindSecondHandInventory(rows);
  }

  function bindPhotoFallbacks() {
    document.querySelectorAll('.second-hand-photo img').forEach(image => image.addEventListener('error', () => image.closest('.second-hand-photo')?.classList.add('photo-error'), { once: true }));
  }

  function bindSecondHandInventory(rows) {
    bindPhotoFallbacks();
    const filter = () => {
      const query = document.getElementById('usedMotorSearch').value.toLowerCase(), status = document.getElementById('usedMotorStatus').value, approval = document.getElementById('usedMotorApproval').value;
      const filtered = rows.filter(item => (!status || item.status === status) && (!approval || approvalStatus(item) === approval) && Object.values(item).flat().join(' ').toLowerCase().includes(query));
      document.getElementById('usedMotorResults').innerHTML = filtered.map(item => motorCard(item)).join('') || '<div class="customer-360-empty"><strong>No matching motor</strong><p>Try another model, price, condition or location.</p></div>';
      bindSecondHandActions();
    };
    document.getElementById('usedMotorSearch').oninput = filter;
    document.getElementById('usedMotorStatus').onchange = filter;
    document.getElementById('usedMotorApproval').onchange = filter;
    document.querySelector('[data-add-used-motor]')?.addEventListener('click', () => editSecondHandMotor());
    document.getElementById('usedMotorAiForm').onsubmit = runSecondHandRecommendation;
    bindSecondHandActions();
  }

  function bindSecondHandActions() {
    bindPhotoFallbacks();
    document.querySelectorAll('[data-edit-used-motor]').forEach(button => button.onclick = () => editSecondHandMotor(state.data.usedMotors.find(item => item.id === button.dataset.editUsedMotor)));
    document.querySelectorAll('[data-review-used-motor]').forEach(button => button.onclick = async () => {
      const motor = state.data.usedMotors.find(item => item.id === button.dataset.reviewUsedMotor), decision = button.dataset.decision;
      if (!motor) return;
      const notes = decision === 'REJECTED' ? prompt(`Why is ${motorTitle(motor)} being rejected? The branch will see this reason.`) : prompt(`Approval notes for ${motorTitle(motor)} (optional):`, 'Checked photos, price, condition and location.');
      if (notes === null || (decision === 'REJECTED' && !String(notes).trim())) return;
      if (decision === 'APPROVED' && !confirm(`Approve ${motorTitle(motor)}? If publication was requested and stock is Available, it will become visible to customers and AI.`)) return;
      try { await post('reviewSecondHandMotor', { inventoryId: motor.id, decision, notes }); await refreshSecondHandMotors(); } catch (error) { alert(error.message); }
    });
    document.querySelectorAll('[data-used-status]').forEach(button => button.onclick = async () => {
      const motor = state.data.usedMotors.find(item => item.id === button.dataset.usedStatus), status = button.dataset.status;
      if (!motor || !confirm(`Change ${motorTitle(motor)} to ${pretty(status)}?`)) return;
      try { await post('setSecondHandMotorStatus', { inventoryId: motor.id, status }); await refreshSecondHandMotors(); } catch (error) { alert(error.message); }
    });
  }

  async function runSecondHandRecommendation(event) {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button'), target = document.getElementById('usedMotorRecommendations'), values = new FormData(form);
    button.disabled = true; target.innerHTML = '<div class="v2-loading"><div class="spinner"></div><p>Checking live inventory...</p></div>';
    try {
      const params = new URLSearchParams({ resource: 'secondHandMotorRecommendations', q: values.get('query'), budget: values.get('budget'), region: values.get('region'), limit: '3', _: Date.now() });
      const response = await fetch(`/api/crm?${params}`, { cache: 'no-store' }), payload = await response.json();
      if (!response.ok || !payload.live) throw new Error(payload.error || 'Unable to check inventory');
      target.innerHTML = payload.records?.length ? `<div class="recommendation-grid">${payload.records.map(item => motorCard(item, true)).join('')}</div>` : '<div class="recommendation-empty"><strong>No suitable live stock</strong><span>AI should record the requested model and ask Admin to source it, not promise unavailable stock.</span></div>';
      bindPhotoFallbacks();
    } catch (error) { target.innerHTML = `<div class="recommendation-empty"><strong>Unable to check inventory</strong><span>${esc(error.message)}</span></div>`; }
    finally { button.disabled = false; }
  }

  async function refreshSecondHandMotors() {
    const response = await get('secondHandMotors');
    state.data.usedMotors = response.records || [];
    loadedResources.add('secondHandMotors');
    state.view = 'usedMotorInventory'; render();
  }

  function editSecondHandMotor(item = {}) {
    const editing = Boolean(item.id), photos = item.photos || [];
    formModal(`${editing ? 'Edit' : 'Add'} 2nd hand motor`, `<form id="secondHandMotorForm" class="crm-form second-hand-form"><div class="form-wide inventory-form-note"><strong>One physical motor = one inventory record</strong><span>Photos, mileage, condition, price and location belong to this exact unit. Up to three new photos can be taken or selected below.</span></div><h3 class="form-wide">Motor identity & condition</h3><label>Brand<input name="brand" value="${esc(item.brand || '')}" required></label><label>Model<input name="model" value="${esc(item.model || '')}" required></label><label>Variant<input name="variant" value="${esc(item.variant || 'Standard')}"></label><label>Year<input name="year" type="number" min="1980" max="${new Date().getFullYear() + 1}" value="${esc(item.year || '')}" required></label><label>Registration number<input name="registrationNumber" value="${esc(item.registrationNumber || '')}"></label><label>Engine CC<input name="engineCc" type="number" min="0" step="1" value="${esc(item.engineCc || '')}"></label><label>Mileage KM<input name="mileageKm" type="number" min="0" step="1" value="${esc(item.mileageKm || '')}"></label><label>Condition grade<select name="conditionGrade"><option value="A">A - Excellent</option><option value="B">B - Good</option><option value="C">C - Fair</option><option value="AS_IS">As-is</option></select></label><label class="form-wide">Condition notes<textarea name="conditionNotes" rows="2">${esc(item.conditionNotes || '')}</textarea></label><h3 class="form-wide">Price & financing</h3><label>Selling price (RM)<input name="price" type="number" min="0" step="0.01" value="${esc(item.price || '')}" required></label><label>Deposit (RM)<input name="deposit" type="number" min="0" step="0.01" value="${esc(item.deposit || '')}"></label><label>Monthly 3 years (RM)<input name="year3" type="number" min="0" step="0.01" value="${esc(item.year3 || '')}"></label><label>Monthly 4 years (RM)<input name="year4" type="number" min="0" step="0.01" value="${esc(item.year4 || '')}"></label><label>Monthly 5 years (RM)<input name="year5" type="number" min="0" step="0.01" value="${esc(item.year5 || '')}"></label><label>Similar-price range (RM)<input name="similarPriceTolerance" type="number" min="0" step="100" value="${esc(item.similarPriceTolerance || 1500)}"></label><h3 class="form-wide">Location & viewing</h3><label>Region<select name="region"><option value="EAST_MALAYSIA">East Malaysia</option><option value="WEST_MALAYSIA">West Malaysia</option></select></label><label>Branch<select name="branchId" required><option value="">Select viewing branch</option>${branchChoices(item)}</select></label><label class="form-wide">Customer location label<input name="location" value="${esc(item.location || item.branch || '')}" placeholder="Example: Kuching - JomKaki Pending Branch" required></label><label class="form-wide">Viewing notes<textarea name="viewingNotes" rows="2" placeholder="Appointment required, transfer possible, opening hours...">${esc(item.viewingNotes || '')}</textarea></label><h3 class="form-wide">Photos & AI search</h3><label class="form-wide">Take or choose up to 3 photos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple></label><label class="form-wide">Photo 1 URL<input name="photo1Url" type="url" value="${esc(photos[0] || '')}"></label><label class="form-wide">Photo 2 URL<input name="photo2Url" type="url" value="${esc(photos[1] || '')}"></label><label class="form-wide">Photo 3 URL<input name="photo3Url" type="url" value="${esc(photos[2] || '')}"></label><label>Photo approval<select name="imageApproved"><option value="FALSE">Pending approval</option><option value="TRUE">Approved</option></select></label><label>Stock status<select name="stockStatus"><option value="AVAILABLE">Available</option><option value="RESERVED">Reserved</option><option value="HOLD">Hold</option><option value="SOLD">Sold</option><option value="INACTIVE">Inactive</option></select></label><label>Customer & AI visibility<select name="customerVisible"><option value="FALSE">Internal only</option><option value="TRUE">Visible and recommendable</option></select></label><label>Last verified<input name="lastVerified" type="date" value="${esc(item.lastVerified || new Date().toISOString().slice(0, 10))}"></label><label class="form-wide">AI search keywords<input name="searchKeywords" value="${esc(item.searchKeywords || '')}" placeholder="y15 y15zr yamaha 150cc kapcai"></label><label class="form-wide">Internal notes<textarea name="internalNotes" rows="2">${esc(item.internalNotes || '')}</textarea></label><div class="form-wide form-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit">${editing ? 'Save motor' : 'Create motor'}</button></div><p class="form-wide notice" id="formMessage">To recommend this motor, set it to Available, approve at least one photo, add a location and turn on customer visibility.</p></form>`);
    const form = document.getElementById('secondHandMotorForm');
    form.conditionGrade.value = item.conditionGrade || 'B'; form.region.value = item.region || (state.user?.region === 'WEST_MALAYSIA' ? 'WEST_MALAYSIA' : 'EAST_MALAYSIA'); form.branchId.value = item.branchId || ''; form.stockStatus.value = item.status || 'AVAILABLE';
    form.imageApproved.closest('label').remove();
    const publishSelect = form.customerVisible, publishLabel = publishSelect.closest('label');
    publishSelect.name = 'publishRequested'; publishSelect.options[0].textContent = 'Keep internal after approval'; publishSelect.options[1].textContent = 'Publish after approval'; publishSelect.value = item.publishRequested || item.customerVisible ? 'TRUE' : 'FALSE';
    publishLabel.childNodes[0].textContent = 'Publication request';
    form.querySelector('[type=submit]').textContent = 'Submit for approval';
    document.getElementById('formMessage').textContent = approvalStatus(item) === 'REJECTED' && item.approvalNotes ? `Changes required: ${item.approvalNotes}` : 'Submitting any new listing or change sends it to Regional Manager or Admin for approval. It stays hidden from customers and AI until approved.';
    form.querySelector('[data-cancel]').onclick = () => document.querySelector('.drawer-backdrop').remove();
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]'), message = document.getElementById('formMessage'), values = Object.fromEntries(new FormData(form)), files = [...form.photos.files].slice(0, 3);
      if (form.photos.files.length > 3) { message.textContent = 'Choose a maximum of three photos.'; return; }
      try { files.forEach(file => validateBrowserFile(file, { imageOnly: true })); }
      catch (error) { message.textContent = error.message; return; }
      button.disabled = true;
      try {
        let inventoryId = item.id || '';
        if (!inventoryId && files.length) {
          const created = await post('saveSecondHandMotor', { ...values, publishRequested: 'FALSE' });
          inventoryId = created.inventoryId;
        }
        if (inventoryId && files.length) {
          for (let index = 0; index < files.length; index += 1) await post('uploadSecondHandMotorPhoto', { inventoryId, slot: index + 1, file: { name: files[index].name, type: files[index].type, data: await fileData(files[index]) } });
        }
        if (inventoryId) await post('saveSecondHandMotor', { ...values, inventoryId, photo1Url: files.length ? undefined : values.photo1Url, photo2Url: files.length ? undefined : values.photo2Url, photo3Url: files.length ? undefined : values.photo3Url });
        else await post('saveSecondHandMotor', values);
        document.querySelector('.drawer-backdrop').remove(); await refreshSecondHandMotors();
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    };
  }
})();
