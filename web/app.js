/* Hungrly checkout leaks: renders every chart from data/dashboard.json
   (exported by src/export_web_data.py). Vanilla JS + D3 v7. */
(() => {
  'use strict';

  // Set this to your GitHub repo URL to show a "source code" link in the footer.
  const REPO_URL = 'https://github.com/Harnoor001/cart-abandonment-analysis';

  const $ = (s) => document.querySelector(s);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const int = d3.format(',');
  const pct = (v, d = 1) => (+v).toFixed(d) + '%';
  const share = (v, d = 1) => (v * 100).toFixed(d) + '%';
  const eur = (v) => {
    const a = Math.abs(v);
    if (a >= 1e6) return '€' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '€' + Math.round(v / 1e3) + 'K';
    return '€' + Math.round(v);
  };
  const strip = (s) => String(s).replace(/^\d+\.\s*/, '');
  const ANNUAL = 365 / 183;
  const STEP_COLS = ['Add to Cart', 'Cart View', 'Checkout Start', 'Delivery Details', 'Order Review', 'Payment'];
  const DIMS = ['Platform', 'Device', 'Category', 'Time of Day', 'Customer Type'];
  const PLATFORM_ORDER = ['iOS App', 'Android App', 'Tablet App', 'Desktop Web', 'Mobile Web'];

  let D = null;
  const state = { funnel: 'all', exitMode: 'value', dim: 'Platform', gap: 0.3 };
  let firstDraw = true;

  // ---------- theme ----------
  const toggle = $('#theme-toggle');
  toggle.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hx-theme', next); } catch (e) { /* storage blocked */ }
    drawAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawAll());

  // ---------- tooltip ----------
  const tip = $('#tip');
  function showTip(event, title, rows) {
    tip.replaceChildren();
    const t = document.createElement('div'); t.className = 't'; t.textContent = title; tip.appendChild(t);
    rows.forEach(([k, v]) => {
      const r = document.createElement('div'); r.className = 'r';
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('b'); b.textContent = v;
      r.append(a, b); tip.appendChild(r);
    });
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = event.clientX + 14, y = event.clientY + 14;
    if (x + w > innerWidth - 8) x = event.clientX - w - 14;
    if (y + h > innerHeight - 8) y = event.clientY - h - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  const hover = (sel, fn) => sel
    .on('mousemove', (e, d) => { const [t, r] = fn(d); showTip(e, t, r); })
    .on('mouseleave', hideTip);

  // ---------- helpers ----------
  const svgIn = (el, H) => {
    const W = Math.max(280, el.clientWidth);
    const svg = d3.create('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
    return { svg, W };
  };
  const textWidth = (svg, strings, size = 12) => {
    const g = svg.append('g').attr('opacity', 0);
    const w = d3.max(strings, (s) => g.append('text').attr('font-size', size).text(s).node().getComputedTextLength()) || 0;
    g.remove();
    return w;
  };
  const anim = (cls) => (firstDraw ? cls : null);

  // ---------- hero ----------
  function drawHero() {
    const k = D.kpis;
    const review = D.funnel.find((r) => r.step_label === 'Payment');
    const exitReview = D.exits.find((r) => r.exit_step === 'Order Review');
    const reviewAnnual = exitReview.abandoned_gmv_eur * ANNUAL;
    const top2 = D.opportunity.filter((o) => o.step === 'Order Review');
    const lo = d3.sum(top2, (o) => o.gmv_annual_30pct_closure_eur), hi = d3.sum(top2, (o) => o.gmv_annual_full_closure_eur);
    const lead = $('#lead');
    lead.innerHTML = '';
    const add = (txt, cls) => { const s = document.createElement(cls ? 'span' : 'span'); if (cls) s.className = cls; s.textContent = txt; lead.appendChild(s); };
    add('Customers leave at '); add('Order Review', 'hl'); add(', the first screen that shows the real price. ');
    const b1 = document.createElement('b'); b1.textContent = pct(review.step_dropoff_pct) + ' of everyone who reaches it walks away'; lead.appendChild(b1);
    add(', which is ' + eur(reviewAnnual) + ' of baskets a year. Showing fees and promo eligibility earlier is worth ');
    const b2 = document.createElement('b'); b2.textContent = eur(lo) + '–' + eur(hi) + ' of GMV a year'; lead.appendChild(b2);
    add('.');

    const tiles = [
      { l: 'Exit rate at Order Review', v: pct(review.step_dropoff_pct), s: 'Worst step in checkout', lead: true },
      { l: 'Baskets abandoned there / year', v: eur(reviewAnnual), s: int(exitReview.abandoned_carts) + ' carts in 6 months' },
      { l: 'Recoverable by the top 2 fixes', v: eur(lo), s: 'GMV / year, planning case (ceiling ' + eur(hi) + ')' },
      { l: 'Cart abandonment', v: pct(k.cart_abandonment_pct), s: int(k.orders) + ' orders from ' + int(k.sessions_with_cart) + ' carts' },
    ];
    $('#kpis').replaceChildren(...tiles.map((t) => {
      const d = document.createElement('div'); d.className = 'kpi' + (t.lead ? ' lead-kpi' : '');
      [['l', t.l], ['v', t.v], ['s', t.s]].forEach(([c, txt]) => { const e = document.createElement('div'); e.className = c; e.textContent = txt; d.appendChild(e); });
      return d;
    }));
  }

  // ---------- 01 funnel ----------
  function funnelRows() {
    if (state.funnel === 'all') return D.funnel.map((r) => ({ label: r.step_label, reached: r.sessions_reached }));
    const [dim, seg] = state.funnel.split('||');
    const rows = D.segments.filter((r) => r.dimension === dim && r.segment === seg);
    const by = Object.fromEntries(rows.map((r) => [r.step_label, r]));
    const out = STEP_COLS.map((s) => ({ label: s, reached: by[s].reached }));
    out.push({ label: 'Order Placed', reached: by['Payment'].reached - by['Payment'].exited });
    return out;
  }
  function buildFunnelFilter() {
    const sel = $('#funnel-filter');
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    sel.appendChild(opt('all', 'All sessions'));
    DIMS.forEach((dim) => {
      const g = document.createElement('optgroup'); g.label = dim;
      let segs = [...new Set(D.segments.filter((r) => r.dimension === dim).map((r) => r.segment))];
      if (dim === 'Platform') segs = PLATFORM_ORDER.filter((s) => segs.includes(s));
      segs.forEach((s) => g.appendChild(opt(dim + '||' + s, strip(s))));
      sel.appendChild(g);
    });
    sel.addEventListener('change', () => { state.funnel = sel.value; drawFunnel(); });
  }
  function drawFunnel() {
    const el = $('#funnel-chart');
    const rows = funnelRows().map((r, i, a) => ({ ...r, drop: i ? 1 - r.reached / a[i - 1].reached : null }));
    const cand = rows.filter((r, i) => i > 0 && rows[i - 1].label !== 'Store / Menu View');
    const worst = d3.greatest(cand, (r) => r.drop);
    const wi = rows.indexOf(worst);
    const rowH = 36, H = rows.length * rowH;
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const labW = textWidth(svg, rows.map((r) => r.label)) + 12;
    const dropW = textWidth(svg, ['−00.0%'], 12.5) + 6;
    const valW = textWidth(svg, ['000,000']) + 10;
    const x = d3.scaleLinear([0, rows[0].reached], [0, Math.max(40, W - labW - dropW - valW)]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH})`);
    g.append('text').attr('x', labW - 12).attr('y', rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'ink').text((d) => d.label);
    hover(g.append('rect').attr('class', anim('grow')).attr('x', labW).attr('y', 7).attr('height', rowH - 14).attr('rx', 4)
      .attr('width', (d) => Math.max(2, x(d.reached)))
      .attr('fill', (d, i) => (i === wi - 1 ? css('--orange') : css('--blue'))),
      (d) => [d.label, [['Sessions', int(d.reached)], ['Of first step', share(d.reached / rows[0].reached)]]
        .concat(d.drop == null ? [] : [['Lost since previous step', share(d.drop)]])]);
    g.append('text').attr('x', (d) => labW + x(d.reached) + 6).attr('y', rowH / 2).attr('dy', '.35em').attr('class', 'muted').text((d) => int(d.reached));
    g.filter((d) => d.drop != null).append('text').attr('x', W).attr('y', 0).attr('dy', '.35em').attr('text-anchor', 'end')
      .attr('font-size', 12.5).attr('font-weight', (d) => (d === worst ? 700 : 400))
      .style('fill', (d) => (d === worst ? css('--orange') : css('--muted')))
      .text((d) => '−' + share(d.drop));
  }

  function drawExits() {
    const el = $('#exit-chart');
    const rows = D.exits.map((r) => ({ ...r, value: r.abandoned_gmv_eur * ANNUAL }));
    const key = state.exitMode === 'value' ? 'value' : 'abandoned_carts';
    const fmt = state.exitMode === 'value' ? eur : int;
    const top = d3.greatest(rows, (r) => r[key]);
    const rowH = 40, H = rows.length * rowH;
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const labW = textWidth(svg, rows.map((r) => r.exit_step)) + 12;
    const valW = textWidth(svg, ['€1.20M  (31%)']) + 10;
    const x = d3.scaleLinear([0, top[key]], [0, Math.max(40, W - labW - valW)]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH})`);
    g.append('text').attr('x', labW - 12).attr('y', rowH / 2).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'ink').text((d) => d.exit_step);
    hover(g.append('rect').attr('class', anim('grow')).attr('x', labW).attr('y', 9).attr('height', rowH - 18).attr('rx', 4)
      .attr('width', (d) => Math.max(2, x(d[key])))
      .attr('fill', (d) => (d === top ? css('--orange') : css('--blue-soft'))),
      (d) => [d.exit_step, [['Abandoned carts (6 mo)', int(d.abandoned_carts)], ['Share of abandonments', pct(d.share_of_all_abandonments_pct)],
        ['Basket value / year', eur(d.value)], ['Avg basket', '€' + d.avg_basket_total_eur.toFixed(2)]]]);
    g.append('text').attr('x', (d) => labW + x(d[key]) + 6).attr('y', rowH / 2).attr('dy', '.35em').attr('class', 'ink')
      .text((d) => fmt(d[key]) + (key === 'abandoned_carts' ? '  (' + Math.round(d.share_of_all_abandonments_pct) + '%)' : ''));
  }
  $('#exit-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.exitMode = b.dataset.v;
    $('#exit-toggle').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawExits();
  });

  // ---------- 02 segments ----------
  function buildDimTabs() {
    const box = $('#dim-tabs');
    DIMS.forEach((dim) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = dim;
      b.setAttribute('aria-pressed', String(dim === state.dim));
      b.addEventListener('click', () => {
        state.dim = dim;
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        drawHeat();
      });
      box.appendChild(b);
    });
  }
  function drawHeat() {
    const el = $('#heat');
    const rows = D.segments.filter((r) => r.dimension === state.dim);
    let segs = [...new Set(rows.map((r) => r.segment))];
    if (state.dim === 'Platform') segs = PLATFORM_ORDER.filter((s) => segs.includes(s));
    if (state.dim === 'Category') {
      const rv = (s) => rows.find((r) => r.segment === s && r.step_label === 'Order Review').exit_rate_pct;
      segs.sort((a, b) => rv(b) - rv(a));
    }
    const lo = css('--panel'), hi = css('--blue');
    const vmax = Math.max(40, d3.max(rows, (r) => r.exit_rate_pct));
    const col = (v) => d3.interpolateRgb(lo, hi)(0.1 + 0.9 * Math.min(1, v / vmax));
    // flag the cell that is furthest above its column's average (the segment-specific leak)
    const colAvg = Object.fromEntries(STEP_COLS.map((s) => [s, d3.mean(rows.filter((r) => r.step_label === s), (r) => r.exit_rate_pct)]));
    const hot = d3.greatest(rows.filter((r) => STEP_COLS.includes(r.step_label)), (r) => r.exit_rate_pct / colAvg[r.step_label]);
    el.style.gridTemplateColumns = `minmax(130px, 1.3fr) repeat(${STEP_COLS.length}, minmax(70px, 1fr))`;
    const nodes = [document.createElement('div')];
    STEP_COLS.forEach((s) => { const h = document.createElement('div'); h.className = 'h'; h.textContent = s; nodes.push(h); });
    segs.forEach((seg) => {
      const r = document.createElement('div'); r.className = 'r'; r.textContent = strip(seg); nodes.push(r);
      STEP_COLS.forEach((step) => {
        const row = rows.find((x) => x.segment === seg && x.step_label === step);
        const c = document.createElement('div'); c.className = 'c' + (row === hot && hot.exit_rate_pct / colAvg[step] > 1.4 ? ' hot' : '');
        const v = row.exit_rate_pct;
        c.textContent = v.toFixed(1) + '%';
        c.style.background = col(v);
        c.style.color = v / vmax > 0.55 ? '#fff' : css('--ink');
        c.addEventListener('mousemove', (e) => showTip(e, strip(seg) + ' · ' + step, [['Reached', int(row.reached)], ['Left here', int(row.exited)], ['Exit rate', pct(v)], ['Column average', pct(colAvg[step])]]));
        c.addEventListener('mouseleave', hideTip);
        nodes.push(c);
      });
    });
    el.replaceChildren(...nodes);

    const plat = Object.fromEntries(D.segment_summary.filter((r) => r.dimension === 'Platform').map((r) => [r.segment, r]));
    const dev = Object.fromEntries(D.segment_summary.filter((r) => r.dimension === 'Device').map((r) => [r.segment, r]));
    $('#seg-sub').textContent = `By device, abandonment barely differs (Mobile ${pct(dev.Mobile.cart_abandonment_pct)} vs Desktop ${pct(dev.Desktop.cart_abandonment_pct)}). ` +
      `By platform it does: Mobile Web abandons ${pct(plat['Mobile Web'].cart_abandonment_pct)} of carts vs ${pct(plat['iOS App'].cart_abandonment_pct)} on iOS, ` +
      `leaking at Payment and at the forced sign-up on Checkout Start. The orange outline marks each view's most unusual cell.`;
  }

  function drawHourly() {
    const el = $('#hour-chart');
    const rows = D.hourly;
    const H = 310, top = 18, mid = 104, gapY = 34, bottom = 26, left = 40;
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const x = d3.scaleBand(rows.map((r) => r.session_hour), [left, W]).padding(0.25);
    const y1 = d3.scaleLinear([0, d3.max(rows, (r) => r.carts)], [mid, top]).nice();
    const y2 = d3.scaleLinear([50, 72], [H - bottom, mid + gapY]);
    // late-night band
    [[0, 4], [23, 23]].forEach(([a, b]) => svg.append('rect').attr('x', x(a) - x.step() * x.padding() / 2).attr('width', x(b) - x(a) + x.step())
      .attr('y', top).attr('height', H - bottom - top).attr('fill', css('--orange-soft')).attr('opacity', 0.6));
    [y1.ticks(3), y2.ticks(4)].forEach((ticks, i) => {
      const y = i ? y2 : y1;
      ticks.forEach((t) => {
        svg.append('line').attr('class', 'gridline').attr('x1', left).attr('x2', W).attr('y1', y(t)).attr('y2', y(t));
        svg.append('text').attr('x', left - 6).attr('y', y(t)).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'muted').attr('font-size', 11)
          .text(i ? t + '%' : d3.format('~s')(t));
      });
    });
    hover(svg.append('g').selectAll('rect').data(rows).join('rect').attr('class', anim('rise'))
      .attr('x', (r) => x(r.session_hour)).attr('width', x.bandwidth()).attr('y', (r) => y1(r.carts)).attr('height', (r) => mid - y1(r.carts))
      .attr('rx', 2).attr('fill', css('--muted')).attr('opacity', 0.55),
      (r) => [String(r.session_hour).padStart(2, '0') + ':00', [['Carts', int(r.carts)], ['Abandoned', pct(r.cart_abandonment_pct)], ['Avg ETA', r.avg_eta_min.toFixed(0) + ' min']]]);
    const line = d3.line().x((r) => x(r.session_hour) + x.bandwidth() / 2).y((r) => y2(r.cart_abandonment_pct));
    svg.append('path').datum(rows).attr('d', line).attr('fill', 'none').attr('stroke', css('--blue')).attr('stroke-width', 2).attr('stroke-linejoin', 'round');
    hover(svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (r) => x(r.session_hour) + x.bandwidth() / 2).attr('cy', (r) => y2(r.cart_abandonment_pct)).attr('r', 4)
      .attr('fill', css('--blue')).attr('stroke', css('--panel')).attr('stroke-width', 2),
      (r) => [String(r.session_hour).padStart(2, '0') + ':00', [['Abandoned', pct(r.cart_abandonment_pct)], ['Carts', int(r.carts)], ['Avg ETA', r.avg_eta_min.toFixed(0) + ' min'], ['Exit at Delivery Details', pct(r.delivery_details_exit_pct)]]]);
    svg.append('text').attr('x', W).attr('y', top - 6).attr('text-anchor', 'end').attr('class', 'muted').attr('font-size', 11).text('Carts per hour');
    svg.append('text').attr('x', W).attr('y', mid + gapY - 8).attr('text-anchor', 'end').attr('class', 'muted').attr('font-size', 11).text('% of carts abandoned');
    rows.filter((r) => r.session_hour % 3 === 0).forEach((r) => svg.append('text').attr('x', x(r.session_hour) + x.bandwidth() / 2).attr('y', H - 6)
      .attr('text-anchor', 'middle').attr('class', 'muted').attr('font-size', 11).text(String(r.session_hour).padStart(2, '0') + ':00'));
  }

  function drawPayTable() {
    const rows = D.payment.slice(0, 8);
    const max = d3.max(rows, (r) => r.payment_exit_pct);
    const t = $('#pay-table');
    t.innerHTML = '<thead><tr><th>Platform</th><th>Method</th><th class="n">First-try errors</th><th class="n">Exit at Payment</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      [r.platform, r.payment_method, pct(r.payment_error_pct)].forEach((v, j) => { const td = document.createElement('td'); td.textContent = v; if (j === 2) td.className = 'n'; tr.appendChild(td); });
      const td = document.createElement('td'); td.className = 'n';
      const wrap = document.createElement('div'); wrap.className = 'bar-cell';
      const s = document.createElement('span'); s.textContent = pct(r.payment_exit_pct);
      const bar = document.createElement('i'); bar.style.width = (r.payment_exit_pct / max * 60) + 'px'; if (i === 0) bar.className = 'hot';
      wrap.append(s, bar); td.appendChild(wrap); tr.appendChild(td);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  // ---------- 03 root cause ----------
  function drawBasket() {
    const el = $('#basket-chart');
    const rows = D.basket_curve;
    const H = 280, m = { t: 14, r: 12, b: 34, l: 40 };
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const x = d3.scaleLinear([5, 45], [m.l, W - m.r]);
    const y = d3.scaleLinear([0, 0.85], [H - m.b, m.t]);
    y.ticks(4).forEach((t) => {
      svg.append('line').attr('class', 'gridline').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
      svg.append('text').attr('x', m.l - 6).attr('y', y(t)).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'muted').attr('font-size', 11).text(Math.round(t * 100) + '%');
    });
    [5, 10, 15, 20, 25, 30, 35, 40, 45].forEach((t) => svg.append('text').attr('x', x(t)).attr('y', H - m.b + 18).attr('text-anchor', 'middle')
      .attr('class', 'muted').attr('font-size', 11).text(t === 45 ? '€45+' : '€' + t));
    svg.append('path').datum(rows).attr('d', d3.area().x((r) => x(r.bin)).y0((r) => y(r.lo)).y1((r) => y(r.hi))).attr('fill', css('--blue')).attr('opacity', 0.14);
    svg.append('line').attr('x1', x(15)).attr('x2', x(15)).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', css('--orange')).attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3');
    svg.append('text').attr('x', x(15) + 6).attr('y', m.t + 4).attr('dy', '.7em').attr('class', 'ink').attr('font-size', 12).text('€15 small-order fee threshold');
    svg.append('path').datum(rows).attr('d', d3.line().x((r) => x(r.bin)).y((r) => y(r.rate))).attr('fill', 'none').attr('stroke', css('--blue')).attr('stroke-width', 2).attr('stroke-linejoin', 'round');
    hover(svg.append('g').selectAll('circle').data(rows).join('circle').attr('cx', (r) => x(r.bin)).attr('cy', (r) => y(r.rate)).attr('r', 3.5)
      .attr('fill', (r) => (r.bin < 15 ? css('--orange') : css('--blue'))).attr('stroke', css('--panel')).attr('stroke-width', 1.5),
      (r) => [(r.bin === 45 ? '€45+' : '€' + r.bin + '–' + (r.bin + 1)) + ' basket', [['Exit at Order Review', share(r.rate)], ['95% CI', share(r.lo, 0) + '–' + share(r.hi, 0)], ['Users', int(r.n)]]]);
  }

  function columns(el, rows, label, value, accent, tipFn, H = 280) {
    const m = { t: 22, b: 40 };
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const x = d3.scaleBand(rows.map(label), [0, W]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(rows, value) * 1.1], [H - m.b, m.t]);
    svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--line'));
    const bw = Math.min(44, x.bandwidth());
    const g = svg.selectAll('g.c').data(rows).join('g').attr('transform', (d) => `translate(${x(label(d)) + (x.bandwidth() - bw) / 2},0)`);
    hover(g.append('rect').attr('class', anim('rise')).attr('y', (d) => y(value(d))).attr('width', bw).attr('height', (d) => y(0) - y(value(d))).attr('rx', 4)
      .attr('fill', (d) => (accent(d) ? css('--orange') : css('--blue'))), tipFn);
    g.append('text').attr('x', bw / 2).attr('y', (d) => y(value(d)) - 6).attr('text-anchor', 'middle').attr('class', 'ink').text((d) => Math.round(value(d)) + '%');
    rows.forEach((d) => {
      const words = label(d).split(' ');
      const lines = words.length > 1 && x.bandwidth() < 96 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [label(d)];
      const t = svg.append('text').attr('y', H - m.b + 16).attr('text-anchor', 'middle').attr('class', 'muted').attr('font-size', 11.5);
      lines.forEach((ln, i) => t.append('tspan').attr('x', x(label(d)) + x.bandwidth() / 2).attr('dy', i ? 13 : 0).text(ln));
    });
  }
  function drawFee() {
    columns($('#fee-chart'), D.fee_ratio, (r) => strip(r.fee_ratio_band), (r) => r.review_exit_pct, (r) => r.review_exit_pct >= 40,
      (r) => ['Fees ' + strip(r.fee_ratio_band) + ' of basket', [['Exit at Order Review', pct(r.review_exit_pct)], ['Users', int(r.reached_review)],
        ['Avg basket', '€' + r.avg_subtotal_eur.toFixed(2)], ['Avg fees', '€' + r.avg_fees_eur.toFixed(2)]]]);
  }
  function drawPromo() {
    const order = ['Applied', 'No Promo', 'Failed - Category Excluded', 'Failed - Expired', 'Failed - Min Spend Not Met'];
    const rows = order.map((o) => D.promo.find((r) => r.promo_status === o)).filter(Boolean);
    columns($('#promo-chart'), rows, (r) => r.promo_status.replace('Failed - ', 'Failed: ').replace('No Promo', 'No promo'), (r) => r.review_exit_pct,
      (r) => r.promo_status.startsWith('Failed'),
      (r) => [r.promo_status, [['Exit at Order Review', pct(r.review_exit_pct)], ['Users', int(r.reached_review)], ['Basket value lost (6 mo)', eur(r.abandoned_gmv_eur)]]], 260);
  }
  function drawDrivers() {
    const el = $('#driver-chart');
    const rows = D.drivers;
    const rowH = 38, H = rows.length * rowH + 26;
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const labW = textWidth(svg, rows.map((r) => r.driver)) + 14;
    const x = d3.scaleLog([0.5, 8], [labW, W - 48]);
    [0.5, 1, 2, 4, 8].forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', 0).attr('y2', H - 22).attr('stroke', t === 1 ? css('--ink-2') : css('--grid'));
      svg.append('text').attr('x', x(t)).attr('y', H - 6).attr('text-anchor', 'middle').attr('class', 'muted').attr('font-size', 11).text(t + '×');
    });
    const g = svg.selectAll('g.r').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH + rowH / 2})`);
    const colr = (d) => (d.odds_ratio > 1.5 ? css('--orange') : d.odds_ratio < 1 ? css('--blue') : css('--muted'));
    g.append('text').attr('x', labW - 14).attr('dy', '.35em').attr('text-anchor', 'end').attr('class', 'ink').text((d) => d.driver);
    g.append('line').attr('x1', (d) => x(d.ci_low)).attr('x2', (d) => x(d.ci_high)).attr('stroke', colr).attr('stroke-width', 3).attr('stroke-linecap', 'round');
    hover(g.append('circle').attr('cx', (d) => x(d.odds_ratio)).attr('r', 6).attr('fill', colr).attr('stroke', css('--panel')).attr('stroke-width', 2),
      (d) => [d.driver, [['Odds ratio', d.odds_ratio.toFixed(2) + '×'], ['95% CI', d.ci_low.toFixed(2) + '–' + d.ci_high.toFixed(2)], ['p-value', d.p_value < 0.001 ? '< 0.001' : d.p_value.toFixed(3)]]]);
    g.append('text').attr('x', (d) => x(d.ci_high) + 8).attr('dy', '.35em').attr('class', 'ink').attr('font-weight', 600).text((d) => d.odds_ratio.toFixed(2) + '×');
  }
  function drawConfound() {
    const c = D.confounding;
    const box = $('#confound');
    box.replaceChildren();
    const big = document.createElement('div'); big.className = 'big';
    big.append(c.odds_ratio_category_only.toFixed(1) + '× → ' + c.odds_ratio_with_controls.toFixed(2) + '×');
    const p = document.createElement('p');
    p.textContent = `On its own, ${c.category} looks like the riskiest category (odds of leaving at Order Review ${c.odds_ratio_category_only.toFixed(1)}× Groceries). ` +
      `Once fees and promo outcome are controlled for, the effect disappears (${c.odds_ratio_with_controls.toFixed(2)}×, n = ${int(c.n)}). Small baskets are the problem, not the menu, so the fix is how fees are shown, not the category.`;
    box.append(big, p);
  }

  // ---------- 04 impact ----------
  const gap = $('#gap');
  gap.addEventListener('input', () => { state.gap = gap.value / 100; drawImpact(); });
  function drawImpact() {
    const rows = [...D.opportunity].sort((a, b) => b.gmv_annual_full_closure_eur - a.gmv_annual_full_closure_eur);
    const g0 = state.gap;
    $('#gap-out').textContent = Math.round(g0 * 100) + '%';
    $('#gap-total').textContent = eur(d3.sum(rows, (r) => r.gmv_annual_full_closure_eur) * g0);
    $('#gap-orders').textContent = int(Math.round(d3.sum(rows, (r) => r.orders_recoverable_6m_full) * ANNUAL * g0)) + ' extra orders / year';
    const el = $('#opp-chart');
    const rowH = 50, H = rows.length * rowH;
    const { svg, W } = svgIn(el, H);
    el.replaceChildren(svg.node());
    const labW = Math.min(W * 0.4, textWidth(svg, rows.map((r) => r.opportunity)) + 14);
    const endW = textWidth(svg, ['€149K of €497K']) + 12;
    const x = d3.scaleLinear([0, rows[0].gmv_annual_full_closure_eur], [0, Math.max(40, W - labW - endW)]);
    const g = svg.selectAll('g').data(rows).join('g').attr('transform', (d, i) => `translate(0,${i * rowH})`);
    const lt = g.append('text').attr('x', labW - 14).attr('y', rowH / 2 - 6).attr('text-anchor', 'end').attr('class', 'ink');
    lt.append('tspan').text((d) => d.opportunity);
    lt.append('tspan').attr('x', labW - 14).attr('dy', 15).attr('class', 'muted').attr('font-size', 11).text((d) => 'at ' + d.step);
    const tipF = (d) => [d.opportunity + ' · ' + d.step, [['Users affected (6 mo)', int(d.sessions_affected_6m)], ['Exit vs benchmark', pct(d.segment_exit_pct) + ' vs ' + pct(d.benchmark_exit_pct)],
      ['Relative risk', d.relative_risk.toFixed(2) + '×'], ['At ' + Math.round(g0 * 100) + '% closure', eur(d.gmv_annual_full_closure_eur * g0)], ['Ceiling', eur(d.gmv_annual_full_closure_eur)]]];
    hover(g.append('rect').attr('x', labW).attr('y', 12).attr('height', rowH - 24).attr('rx', 4).attr('width', (d) => x(d.gmv_annual_full_closure_eur)).attr('fill', css('--blue-soft')), tipF);
    hover(g.append('rect').attr('x', labW).attr('y', 12).attr('height', rowH - 24).attr('rx', 4).attr('width', (d) => Math.max(g0 > 0 ? 2 : 0, x(d.gmv_annual_full_closure_eur * g0))).attr('fill', css('--blue')), tipF);
    g.append('text').attr('x', (d) => labW + x(d.gmv_annual_full_closure_eur) + 8).attr('y', rowH / 2).attr('dy', '.35em').attr('class', 'ink')
      .text((d) => eur(d.gmv_annual_full_closure_eur * g0) + ' of ' + eur(d.gmv_annual_full_closure_eur));
  }
  function drawOppTable() {
    const rows = [...D.opportunity].sort((a, b) => b.gmv_annual_full_closure_eur - a.gmv_annual_full_closure_eur);
    const t = $('#opp-table');
    t.innerHTML = '<thead><tr><th>Leak</th><th>Problem segment</th><th>Benchmark</th><th class="n">Exit</th><th class="n">Benchmark exit</th><th class="n">Relative risk</th><th class="n">Users (6 mo)</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      [[r.opportunity], [r.problem_segment], [r.benchmark_segment], [pct(r.segment_exit_pct), 1], [pct(r.benchmark_exit_pct), 1], [r.relative_risk.toFixed(2) + '×', 1], [int(r.sessions_affected_6m), 1]]
        .forEach(([v, n]) => { const td = document.createElement('td'); td.textContent = v; if (n) td.className = 'n'; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  // ---------- 05 plan ----------
  function drawAB() {
    const a = D.ab_test;
    $('#ab-note').textContent = `Baseline cart → order conversion is ${share(a.baseline_cvr)} with about ${int(Math.round(a.daily_carts))} carts a day. ` +
      `At α = 0.05 and 80% power, a 50/50 split needs:`;
    const t = $('#ab-table');
    t.innerHTML = '<thead><tr><th>Lift to detect</th><th class="n">Carts per arm</th><th class="n">Days to run</th></tr></thead>';
    const tb = document.createElement('tbody');
    a.power.forEach((r) => {
      const tr = document.createElement('tr'); if (r.mde_pp === 2) tr.className = 'em';
      [['+' + r.mde_pp + ' pp' + (r.mde_pp === 2 ? '  (recommended)' : '')], [int(r.carts_per_arm), 1], [r.days + ' days', 1]]
        .forEach(([v, n]) => { const td = document.createElement('td'); td.textContent = v; if (n) td.className = 'n'; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  // ---------- boot ----------
  function drawAll() {
    if (!D) return;
    hideTip();
    drawFunnel(); drawExits(); drawHeat(); drawHourly(); drawBasket(); drawFee(); drawPromo(); drawDrivers(); drawImpact();
    firstDraw = false;
  }
  function fail(msg) {
    $('#lead').textContent = msg;
    document.querySelectorAll('.chart').forEach((c) => { c.innerHTML = '<div class="fail">Data failed to load</div>'; });
  }

  fetch('data/dashboard.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      D = data;
      drawHero(); buildFunnelFilter(); buildDimTabs(); drawPayTable(); drawConfound(); drawOppTable(); drawAB();
      drawAll();
      $('#stamp').textContent = 'Data exported ' + D.generated_at + ' · period ' + D.period.start + ' to ' + D.period.end + '.';
      if (REPO_URL) { const a = document.createElement('a'); a.href = REPO_URL; a.textContent = 'Source code on GitHub →'; $('#repo-link').appendChild(a); }
      let t, lastW = $('main').clientWidth;
      new ResizeObserver(() => {
        const w = $('main').clientWidth;
        if (w === lastW) return;
        lastW = w; clearTimeout(t); t = setTimeout(drawAll, 120);
      }).observe($('main'));
    })
    .catch(() => fail('The data file could not be loaded. If you opened index.html directly from disk, serve the folder instead (for example: npx serve web).'));
})();
