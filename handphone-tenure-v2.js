(function () {
  const tenureFields = [
    ['month12', 'Monthly 1 year (RM)'],
    ['month24', 'Monthly 2 years (RM)'],
    ['month36', 'Monthly 3 years (RM)'],
    ['month48', 'Monthly 4 years (RM)'],
    ['month60', 'Monthly 5 years (RM)']
  ];

  const relabel = (input, label) => {
    const wrapper = input?.closest('label');
    if (!wrapper) return;
    const text = [...wrapper.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (text) text.nodeValue = label;
  };

  const matchingPricing = form => {
    const catalogId = form.elements.catalogId?.value;
    const zone = form.elements.zone?.value;
    const pricing = typeof state !== 'undefined' ? state.data?.pricing || [] : [];
    return pricing.find(item =>
      String(item.businessUnit).toUpperCase() === 'HANDPHONE' &&
      item.catalogId === catalogId &&
      (!zone || item.zone === zone)
    );
  };

  const preparePricingForm = form => {
    if (form.dataset.tenureYearsReady === 'TRUE') return;
    form.dataset.tenureYearsReady = 'TRUE';
    const existing48 = form.elements.month48;
    if (!form.elements.month60 && existing48) {
      const label = document.createElement('label');
      label.textContent = 'Monthly 5 years (RM)';
      const input = document.createElement('input');
      input.name = 'month60';
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.value = matchingPricing(form)?.month60 || '';
      label.appendChild(input);
      existing48.closest('label').insertAdjacentElement('afterend', label);
    }
    tenureFields.forEach(([name, label]) => {
      const input = form.elements[name];
      if (!input) return;
      input.required = false;
      relabel(input, label);
    });
    const message = form.querySelector('#formMessage');
    if (message) message.textContent = 'Fill only the years offered for this phone. Blank years are not quoted by AI. Product price, deposit and internal figures stay hidden from customers.';
  };

  const prepareApplicationTenure = select => {
    if (!select || select.querySelector('option[value="60"]')) return;
    const option = document.createElement('option');
    option.value = '60';
    option.textContent = '5 years';
    select.appendChild(option);
    [['12', '1 year'], ['24', '2 years'], ['36', '3 years'], ['48', '4 years']].forEach(([value, label]) => {
      const existing = select.querySelector(`option[value="${value}"]`);
      if (existing) existing.textContent = label;
    });
  };

  const prepare = root => {
    const pricingForm = root.querySelector?.('#productPricingForm');
    if (pricingForm && String(pricingForm.elements.businessUnit?.value).toUpperCase() === 'HANDPHONE') preparePricingForm(pricingForm);
    prepareApplicationTenure(root.querySelector?.('select[name="tenureMonths"]'));
    prepareApplicationTenure(root.querySelector?.('select[name="loanTenureMonths"]'));
  };

  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) prepare(node);
  }))).observe(document.body, { childList: true, subtree: true });
  prepare(document);
})();
