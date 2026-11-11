// Workflow designer webview. Talks to the extension (workflowDesignerPanel.ts) through
// request/response messages; all AAP access happens in the extension.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const KINDS = {
    job_template: { label: 'Job template', short: 'JT', catalog: 'job templates' },
    workflow_job_template: { label: 'Workflow job template', short: 'WF', catalog: 'workflow job templates' },
    project: { label: 'Project sync', short: 'P', catalog: 'projects' },
    inventory_source: { label: 'Inventory source sync', short: 'I', catalog: 'inventory sources' },
    system_job_template: { label: 'Management job', short: 'M', catalog: 'management jobs' },
    workflow_approval: { label: 'Approval', short: 'A' },
  };
  const LINK_LABELS = { success: 'On success', failure: 'On failure', always: 'Always' };
  const PROMPTING = ['job_template', 'workflow_job_template'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const NODE_W = 230, NODE_H = 62, GAP_X = 80, GAP_Y = 26, START_W = 76, START_H = 34, DUMMY_H = 14;

  // ---------------------------------------------------------------- messaging
  let nextRequest = 1;
  const pending = new Map();
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextRequest++;
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type: 'request', id, method, params });
    });
  }
  window.addEventListener('message', ({ data: msg }) => {
    if (msg.type === 'response') {
      const request = pending.get(msg.id);
      pending.delete(msg.id);
      if (!request) return;
      if (msg.error !== undefined) request.reject(new Error(msg.error));
      else request.resolve(msg.result);
    } else if (msg.type === 'session') {
      onSession(msg.session);
    }
  });

  // ---------------------------------------------------------------- state
  let wf = emptyWorkflow();
  let dirty = false;
  let selection = null; // { kind: 'node', key } | { kind: 'link', from, to } | { kind: 'details' } | null
  let linkFrom = null; // node key while choosing a link target
  let problemKeys = new Set();
  let newCount = 0;
  let session = null;
  let busy = false;
  let workflows = [];
  const undoStack = [];
  const view = { x: 40, y: 0, k: 1 };
  let autoPos = new Map();
  let waypoints = new Map(); // "from>to" -> points a long link passes through
  let caches = { catalog: {}, lookup: {}, launch: {} };

  function emptyWorkflow() {
    return {
      details: {
        name: '', description: '', organization: null, inventory: null, limit: '', scmBranch: '', labels: [],
        jobTags: '', skipTags: '', extraVars: '', askInventory: false, askLimit: false, askScmBranch: false,
        askLabels: false, askTags: false, askSkipTags: false, askVariables: false, allowSimultaneous: false,
        webhookService: '', webhookCredential: null,
      },
      nodes: [],
      links: [],
    };
  }

  const cached = (bucket, key, load) => {
    if (!caches[bucket][key]) {
      caches[bucket][key] = load().catch((err) => {
        delete caches[bucket][key];
        throw err;
      });
    }
    return caches[bucket][key];
  };
  const catalog = (kind) => cached('catalog', kind, () => call('catalog', { kind }));
  const lookup = (kind) => cached('lookup', kind, () => call('lookup', { kind }));
  const launchInfo = (kind, id) => cached('launch', kind + ':' + id, () => call('launchInfo', { kind, id }));

  function nodeByKey(key) {
    return wf.nodes.find((n) => n.key === key);
  }
  function setDirty(value = true) {
    dirty = value;
    $('dirty').hidden = !dirty;
    $('wf-name').textContent = wf.details.name || (wf.details.id ? '' : 'new workflow');
    vscode.postMessage({ type: 'title', name: wf.details.name, dirty });
  }
  /** Snapshot before a graph change, for Ctrl/Cmd+Z. */
  function remember() {
    undoStack.push(JSON.stringify({ nodes: wf.nodes, links: wf.links }));
    if (undoStack.length > 50) undoStack.shift();
  }
  function undo() {
    const last = undoStack.pop();
    if (!last) return;
    const snapshot = JSON.parse(last);
    wf.nodes = snapshot.nodes;
    wf.links = snapshot.links;
    selection = null;
    linkFrom = null;
    setDirty();
    render();
    showSide();
  }

  // ---------------------------------------------------------------- graph helpers
  const parentsOf = (key) => wf.links.filter((l) => l.to === key);
  const childrenOf = (key) => wf.links.filter((l) => l.from === key);
  function reaches(from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const key = stack.pop();
      if (key === to) return true;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const l of childrenOf(key)) stack.push(l.to);
    }
    return false;
  }
  /** Links must not repeat a pair of nodes or close a loop. */
  function canLink(from, to) {
    return from !== to && !wf.links.some((l) => l.from === from && l.to === to) && !reaches(to, from);
  }
  function newIdentifier() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  function nodeTitle(node) {
    if (node.kind === 'workflow_approval') return node.approval && node.approval.name ? node.approval.name : 'Approval';
    return node.resource ? node.resource.name : 'Deleted resource';
  }
  function alias(node) {
    return UUID.test(node.identifier) ? '' : node.identifier;
  }
  function formatSeconds(total) {
    if (!total) return 'never expires';
    const m = Math.floor(total / 60), s = total % 60;
    return 'expires after ' + (m ? m + ' min' : '') + (m && s ? ' ' : '') + (s ? s + ' s' : '');
  }

  // ---------------------------------------------------------------- layout
  /**
   * Layered left-to-right layout, like AAP's: each node one column right of its deepest parent.
   * Links spanning several columns get placeholder slots in the columns they cross, so they run
   * through a gap instead of behind other nodes.
   */
  function computeLayout() {
    const layer = new Map();
    const indegree = new Map(wf.nodes.map((n) => [n.key, 0]));
    wf.links.forEach((l) => indegree.set(l.to, (indegree.get(l.to) || 0) + 1));
    const queue = wf.nodes.filter((n) => !indegree.get(n.key)).map((n) => n.key);
    queue.forEach((k) => layer.set(k, 1));
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      for (const l of childrenOf(key)) {
        layer.set(l.to, Math.max(layer.get(l.to) || 0, layer.get(key) + 1));
        indegree.set(l.to, indegree.get(l.to) - 1);
        if (!indegree.get(l.to)) queue.push(l.to);
      }
    }
    const layers = [];
    const place = (i, key) => (layers[i] = layers[i] || []).push(key);
    for (const n of wf.nodes) place(layer.get(n.key) || 1, n.key);
    const preds = new Map(); // key -> keys in the previous column it is linked from
    const addPred = (key, pred) => (preds.get(key) || preds.set(key, []).get(key)).push(pred);
    const chains = new Map(); // "from>to" -> placeholder keys of a long link
    for (const l of wf.links) {
      const chain = [];
      let prev = l.from;
      for (let i = (layer.get(l.from) || 1) + 1; i < (layer.get(l.to) || 1); i++) {
        const dummy = '~' + l.from + '>' + l.to + ':' + i;
        place(i, dummy);
        addPred(dummy, prev);
        chain.push(dummy);
        prev = dummy;
      }
      addPred(l.to, prev);
      if (chain.length) chains.set(l.from + '>' + l.to, chain);
    }
    // Order each column by the average position of its predecessors to limit crossings.
    const rank = new Map();
    for (let i = 1; i < layers.length; i++) {
      const column = layers[i] || [];
      if (i > 1) {
        const bary = (key) => {
          const ranks = (preds.get(key) || []).map((p) => rank.get(p)).filter((r) => r !== undefined);
          return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : Infinity;
        };
        const scores = new Map(column.map((k, j) => [k, bary(k) + j * 1e-6]));
        column.sort((a, b) => scores.get(a) - scores.get(b));
      }
      column.forEach((k, j) => rank.set(k, j));
    }
    autoPos = new Map();
    const passage = new Map();
    const slot = (key) => (key.startsWith('~') ? DUMMY_H : NODE_H);
    for (let i = 1; i < layers.length; i++) {
      const column = layers[i] || [];
      const x = START_W + GAP_X + (i - 1) * (NODE_W + GAP_X);
      let y = -(column.reduce((sum, k) => sum + slot(k), 0) + GAP_Y * (column.length - 1)) / 2;
      for (const key of column) {
        if (key.startsWith('~')) passage.set(key, { x, y: y + DUMMY_H / 2 });
        else autoPos.set(key, { x, y });
        y += slot(key) + GAP_Y;
      }
    }
    waypoints = new Map([...chains].map(([link, keys]) => [link, keys.map((k) => passage.get(k))]));
  }
  function pos(node) {
    return node.x !== undefined && node.x !== null ? { x: node.x, y: node.y } : autoPos.get(node.key) || { x: 0, y: 0 };
  }

  // ---------------------------------------------------------------- rendering
  function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
    for (const c of children) if (c) el.append(c);
    return el;
  }
  function svgText(attrs, text) {
    const el = svg('text', attrs);
    el.textContent = text;
    return el;
  }
  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }
  /** Path segment from (x1, y1) to (x2, y2) leaving and arriving horizontally. */
  function curveTo(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
  }
  function curve(x1, y1, x2, y2) {
    return 'M' + x1 + ',' + y1 + curveTo(x1, y1, x2, y2);
  }

  function render() {
    computeLayout();
    const edges = $('edges');
    const nodes = $('nodes');
    edges.replaceChildren();
    nodes.replaceChildren();
    $('canvas').classList.toggle('linking', !!linkFrom);
    const startY = 0;

    // Start node, linked to every root node.
    const roots = wf.nodes.filter((n) => !parentsOf(n.key).length);
    for (const root of roots) {
      const p = pos(root);
      edges.append(
        svg('g', { class: 'edge start' },
          svg('path', { class: 'line', d: curve(START_W, startY, p.x - 2, p.y + NODE_H / 2), 'marker-end': 'url(#arrow-start)' })),
      );
    }
    for (const link of wf.links) {
      const a = nodeByKey(link.from), b = nodeByKey(link.to);
      if (!a || !b) continue;
      const pa = pos(a), pb = pos(b);
      // Route through the gaps reserved by the layout, unless an end was moved by hand.
      const points = a.x == null && b.x == null ? waypoints.get(link.from + '>' + link.to) || [] : [];
      let d = 'M' + (pa.x + NODE_W) + ',' + (pa.y + NODE_H / 2);
      let x = pa.x + NODE_W, y = pa.y + NODE_H / 2;
      for (const p of points) {
        d += curveTo(x, y, p.x, p.y) + ' L' + (p.x + NODE_W) + ',' + p.y;
        x = p.x + NODE_W;
        y = p.y;
      }
      d += curveTo(x, y, pb.x - 2, pb.y + NODE_H / 2);
      const selected = selection && selection.kind === 'link' && selection.from === link.from && selection.to === link.to;
      // Label on the first stretch of the link.
      const first = points[0] || { x: pb.x, y: pb.y + NODE_H / 2 };
      const midX = (pa.x + NODE_W + first.x) / 2, midY = (pa.y + NODE_H / 2 + first.y) / 2;
      const g = svg('g', { class: 'edge ' + link.type + (selected ? ' selected' : ''), 'data-from': link.from, 'data-to': link.to },
        svg('path', { class: 'line', d, 'marker-end': 'url(#arrow-' + link.type + ')' }),
        svg('path', { class: 'hit', d }),
        selected || wf.links.length < 40 ? svgText({ class: 'edge-label', x: midX, y: midY - 5 }, LINK_LABELS[link.type]) : null,
        svg('title', {}, document.createTextNode(LINK_LABELS[link.type] + ': ' + nodeTitle(a) + ' → ' + nodeTitle(b))),
      );
      edges.append(g);
    }

    const start = svg('g', { class: 'node start', 'data-key': '__start', transform: 'translate(0,' + (startY - START_H / 2) + ')' },
      svg('rect', { class: 'box', width: START_W, height: START_H, rx: 17 }),
      svgText({ class: 'name', x: START_W / 2, y: START_H / 2 + 4 }, 'START'),
      addButton(START_W, START_H / 2, '__start'),
    );
    nodes.append(start);

    for (const node of wf.nodes) {
      const p = pos(node);
      const selected = selection && selection.kind === 'node' && selection.key === node.key;
      let linkClass = '';
      if (linkFrom) linkClass = node.key === linkFrom ? ' link-source' : canLink(linkFrom, node.key) ? ' target-ok' : ' target-no';
      const missing = node.kind !== 'workflow_approval' && !node.resource;
      const sub = [KINDS[node.kind].label];
      if (alias(node)) sub.unshift(alias(node));
      if (node.kind === 'workflow_approval' && node.approval) sub.push(formatSeconds(node.approval.timeout));
      const g = svg('g', {
        class: 'node k-' + node.kind + (selected ? ' selected' : '') + (missing ? ' missing' : '') + (problemKeys.has(node.key) ? ' problem' : '') + linkClass,
        'data-key': node.key,
        transform: 'translate(' + p.x + ',' + p.y + ')',
        tabindex: '0',
        role: 'button',
        'aria-label': KINDS[node.kind].label + ' ' + nodeTitle(node),
      },
        svg('rect', { class: 'box', width: NODE_W, height: NODE_H, rx: 4 }),
        svg('rect', { class: 'stripe', width: 5, height: NODE_H, rx: 2 }),
        svg('rect', { class: 'badge-bg', x: 14, y: 12, width: 24, height: 16, rx: 3 }),
        svgText({ class: 'badge-text', x: 26, y: 24 }, KINDS[node.kind].short),
        svgText({ class: 'name', x: 46, y: 25 }, clip(nodeTitle(node), 22)),
        svgText({ class: 'sub', x: 14, y: 47 }, clip((missing ? '⚠ Resource deleted · ' : '') + sub.join(' · '), 36)),
        node.allParentsMustConverge
          ? svg('g', {}, svg('rect', { class: 'conv-bg', x: NODE_W - 36, y: 6, width: 30, height: 14, rx: 3 }),
            svgText({ class: 'conv-text', x: NODE_W - 21, y: 16 }, 'ALL'))
          : null,
        svg('title', {}, document.createTextNode(KINDS[node.kind].label + ': ' + nodeTitle(node) + (alias(node) ? '\nAlias: ' + alias(node) : '') +
          (node.allParentsMustConverge ? '\nConvergence: all parents' : ''))),
        linkFrom ? null : addButton(NODE_W, NODE_H / 2, node.key),
      );
      nodes.append(g);
    }
    applyView();
    $('empty-hint').hidden = wf.nodes.length > 0;
  }

  function addButton(x, y, key) {
    return svg('g', { class: 'add', 'data-add': key, transform: 'translate(' + x + ',' + y + ')' },
      svg('circle', { r: 11 }),
      svgText({ y: 5 }, '+'),
      svg('title', {}, document.createTextNode(key === '__start' ? 'Add a step at the start' : 'Add a step after this one')));
  }

  function applyView() {
    $('viewport').setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }
  function fit() {
    const wrap = $('canvas').getBoundingClientRect();
    if (!wrap.width) return;
    let minX = 0, minY = -START_H / 2, maxX = START_W, maxY = START_H / 2;
    for (const n of wf.nodes) {
      const p = pos(n);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W + 14);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    const pad = 40;
    view.k = Math.max(0.2, Math.min(1.2, Math.min((wrap.width - 2 * pad) / (maxX - minX), (wrap.height - 2 * pad) / (maxY - minY))));
    view.x = pad - minX * view.k + Math.max(0, (wrap.width - 2 * pad - (maxX - minX) * view.k) / 2);
    view.y = pad - minY * view.k + Math.max(0, (wrap.height - 2 * pad - (maxY - minY) * view.k) / 2);
    applyView();
  }
  function zoomAt(factor, cx, cy) {
    const k = Math.max(0.2, Math.min(2.5, view.k * factor));
    view.x = cx - ((cx - view.x) * k) / view.k;
    view.y = cy - ((cy - view.y) * k) / view.k;
    view.k = k;
    applyView();
  }

  // ---------------------------------------------------------------- canvas interaction
  const canvas = $('canvas');
  let drag = null; // { type: 'pan' | 'node', ... }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const add = e.target.closest('[data-add]');
    if (add) return; // handled on click
    const nodeEl = e.target.closest('.node');
    canvas.focus();
    if (nodeEl && nodeEl.dataset.key !== '__start') {
      const node = nodeByKey(nodeEl.dataset.key);
      const p = pos(node);
      // While picking a link target, nodes are clicked, not dragged.
      drag = { type: linkFrom ? 'pick' : 'node', key: node.key, startX: e.clientX, startY: e.clientY, ox: p.x, oy: p.y, moved: false };
    } else if (!nodeEl && !e.target.closest('.edge')) {
      drag = { type: 'pan', startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y, moved: false };
      canvas.classList.add('panning');
    }
    if (drag) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.type === 'pick') return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved && drag.type === 'node') remember();
    drag.moved = true;
    if (drag.type === 'pan') {
      view.x = drag.ox + dx;
      view.y = drag.oy + dy;
      applyView();
    } else {
      const node = nodeByKey(drag.key);
      node.x = Math.round(drag.ox + dx / view.k);
      node.y = Math.round(drag.oy + dy / view.k);
      render();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    canvas.classList.remove('panning');
    if (!d || d.moved) return;
    if (d.type === 'pan') {
      if (linkFrom) cancelLinking();
      else if (selection && selection.kind !== 'details') select(null);
    } else {
      onNodeClick(d.key);
    }
    e.preventDefault();
  });
  canvas.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      addStep(add.dataset.add === '__start' ? null : add.dataset.add);
      return;
    }
    const edge = e.target.closest('.edge:not(.start)');
    if (edge && !linkFrom) select({ kind: 'link', from: edge.dataset.from, to: edge.dataset.to });
    const nodeEl = e.target.closest('.node');
    if (nodeEl && nodeEl.dataset.key === '__start' && linkFrom) cancelLinking();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const nodeEl = e.target.closest && e.target.closest('.node');
    if ((e.key === 'Enter' || e.key === ' ') && nodeEl && nodeEl.dataset.key !== '__start') {
      e.preventDefault();
      onNodeClick(nodeEl.dataset.key);
    }
  });
  document.addEventListener('keydown', (e) => {
    // Graph shortcuts only act on the canvas, never while a form control has focus.
    const onCanvas = e.target === document.body || canvas.contains(e.target);
    if (e.key === 'Escape') {
      if (linkFrom) cancelLinking();
      else if ($('dialog')) return;
      else if (selection) select(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && onCanvas && selection) {
      if (selection.kind === 'node') removeNode(selection.key);
      else if (selection.kind === 'link') removeLink(selection.from, selection.to);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && onCanvas) {
      e.preventDefault();
      undo();
    }
  });

  function onNodeClick(key) {
    if (linkFrom) {
      if (key === linkFrom) return cancelLinking();
      if (!canLink(linkFrom, key)) {
        hintBar(reaches(key, linkFrom) ? 'That link would create a loop. Pick another node, or Esc to cancel.'
          : 'These nodes are already linked. Pick another node, or Esc to cancel.');
        return;
      }
      remember();
      const link = { from: linkFrom, to: key, type: 'success' };
      wf.links.push(link);
      linkFrom = null;
      hintBar('');
      setDirty();
      select({ kind: 'link', from: link.from, to: link.to });
      return;
    }
    select({ kind: 'node', key });
  }
  function startLinking(key) {
    linkFrom = key;
    hintBar('Click the node to run after "' + nodeTitle(nodeByKey(key)) + '". Esc cancels.');
    render();
  }
  function cancelLinking() {
    linkFrom = null;
    hintBar('');
    render();
  }
  function hintBar(text) {
    $('hint-bar').textContent = text;
    $('hint-bar').hidden = !text;
  }

  // ---------------------------------------------------------------- graph edits
  function removeNode(key) {
    const node = nodeByKey(key);
    if (!node) return;
    remember();
    // Like AAP: the removed node's children are re-attached to its parents with the parent's link type.
    const parents = parentsOf(key), children = childrenOf(key);
    wf.links = wf.links.filter((l) => l.from !== key && l.to !== key);
    wf.nodes = wf.nodes.filter((n) => n.key !== key);
    for (const p of parents) {
      for (const c of children) {
        if (canLink(p.from, c.to)) wf.links.push({ from: p.from, to: c.to, type: p.type });
      }
    }
    problemKeys.delete(key);
    selection = null;
    setDirty();
    render();
    showSide();
    banner('info', 'Removed "' + nodeTitle(node) + '". Ctrl/Cmd+Z restores it.');
  }
  function removeLink(from, to) {
    remember();
    wf.links = wf.links.filter((l) => !(l.from === from && l.to === to));
    selection = null;
    setDirty();
    render();
    showSide();
  }
  function addStep(parentKey) {
    if (linkFrom) cancelLinking();
    const draft = {
      key: 'new-' + ++newCount, identifier: newIdentifier(), kind: 'job_template', resource: null,
      allParentsMustConverge: false, prompts: {}, survey: {}, days: null, passwordVariables: [],
    };
    selection = { kind: 'new', parentKey };
    render();
    nodeForm(draft, { isNew: true, parentKey });
  }

  // ---------------------------------------------------------------- side panel
  const side = $('side');
  function select(sel) {
    selection = sel;
    render();
    showSide();
  }
  function showSide() {
    if (!selection) return showHelp();
    if (selection.kind === 'details') return detailsForm();
    if (selection.kind === 'node') {
      const node = nodeByKey(selection.key);
      if (node) return nodeForm(JSON.parse(JSON.stringify(node)), { isNew: false });
    }
    if (selection.kind === 'link') return linkPanel();
    selection = null;
    showHelp();
  }

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || (v === false && k !== 'spellcheck')) continue;
      if (k === 'spellcheck') {
        el.spellcheck = !!v;
        continue;
      }
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }
  function field(label, control, { hint, required, id } = {}) {
    return h('div', { class: 'field' + (required ? ' required' : ''), 'data-field': id },
      h('label', { for: control.id || undefined }, label),
      hint ? h('span', { class: 'hint' }, hint) : null,
      control,
      h('span', { class: 'field-error', hidden: true }));
  }
  function fieldError(container, id, message) {
    const f = container.querySelector('[data-field="' + id + '"]');
    if (!f) return false;
    const err = f.querySelector('.field-error');
    err.textContent = message;
    err.hidden = !message;
    const control = f.querySelector('input:not([type=checkbox]), select, textarea');
    if (control) control.classList.toggle('invalid', !!message);
    if (message && control) control.focus();
    return true;
  }
  function option(value, label, selected) {
    const o = new Option(label, value);
    o.selected = !!selected;
    return o;
  }
  /** A select filled from an AAP list; `value` is a Ref (or array of Refs when multiple). */
  function refSelect(id, kind, value, { multiple = false, empty = '(none)', filter } = {}) {
    const select = h('select', { id, multiple });
    const selectedIds = new Set((multiple ? value || [] : value ? [value] : []).map((r) => r.id));
    select.append(option('', 'Loading…'));
    select.disabled = true;
    lookup(kind).then((items) => {
      const shown = filter ? items.filter(filter) : items;
      const options = multiple ? [] : [option('', empty)];
      for (const item of shown) {
        const label = item.name + (item.detail ? ' — ' + item.detail : '') + (item.organization ? ' (' + item.organization + ')' : '');
        const o = option(String(item.id), label, selectedIds.has(item.id));
        o.ref = { id: item.id, name: item.name, organization: item.organization || null };
        options.push(o);
      }
      // Keep values AAP no longer lists, so nothing disappears silently.
      for (const ref of multiple ? value || [] : value ? [value] : []) {
        if (!shown.some((i) => i.id === ref.id)) {
          const o = option(String(ref.id), ref.name + ' (not found in AAP)', true);
          o.ref = ref;
          options.push(o);
        }
      }
      select.replaceChildren(...options);
      if (multiple) select.size = Math.min(8, Math.max(4, options.length));
      select.disabled = false;
    }, (err) => {
      select.replaceChildren(option('', 'Could not load: ' + err.message));
    });
    select.readRef = () => {
      const refs = [...select.selectedOptions].filter((o) => o.ref).map((o) => o.ref);
      return multiple ? refs : refs[0] || null;
    };
    return select;
  }

  function showHelp() {
    const counts = wf.nodes.length ? wf.nodes.length + ' node' + (wf.nodes.length === 1 ? '' : 's') + ', ' + wf.links.length + ' link' + (wf.links.length === 1 ? '' : 's') : 'No nodes yet';
    side.replaceChildren(
      h('h2', {}, wf.details.name || 'New workflow'),
      h('p', { class: 'sub' }, counts + (wf.details.organization ? ' · ' + wf.details.organization.name : '')),
      h('p', {}, 'Use ', h('b', {}, '+'), ' on START or on a node to add a step after it. Click a node to edit it, link it to another node or remove it; click a link to change when it runs.'),
      h('p', {}, 'Drag nodes to move them and the background to pan; scroll to zoom. ', h('kbd', {}, 'Del'), ' removes the selection, ', h('kbd', {}, 'Ctrl/Cmd+Z'), ' undoes a graph change, ', h('kbd', {}, 'Esc'), ' cancels.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'secondary', onclick: () => select({ kind: 'details' }) }, 'Workflow details'),
        h('button', { type: 'button', class: 'secondary', onclick: () => addStep(null) }, 'Add step')),
    );
  }

  function linkPanel() {
    const link = wf.links.find((l) => l.from === selection.from && l.to === selection.to);
    if (!link) {
      selection = null;
      return showHelp();
    }
    const from = nodeByKey(link.from), to = nodeByKey(link.to);
    const radios = h('div', { class: 'radio-row', role: 'radiogroup' },
      Object.entries(LINK_LABELS).map(([type, label]) =>
        h('label', { class: 'check ' + type },
          h('input', {
            type: 'radio', name: 'link-type', value: type, checked: link.type === type,
            onchange: () => {
              remember();
              link.type = type;
              setDirty();
              render();
            },
          }),
          h('span', {}, label))));
    side.replaceChildren(
      h('h2', {}, 'Link'),
      h('p', { class: 'sub' }, '"' + nodeTitle(from) + '" → "' + nodeTitle(to) + '"'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Run "' + nodeTitle(to) + '"'), radios),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'secondary danger', onclick: () => removeLink(link.from, link.to) }, 'Remove link'),
        h('button', { type: 'button', class: 'secondary', onclick: () => select({ kind: 'node', key: link.from }) }, 'Go to parent'),
        h('button', { type: 'button', class: 'secondary', onclick: () => select({ kind: 'node', key: link.to }) }, 'Go to child')),
    );
  }

  // ---- workflow details (applied as typed)
  function detailsForm() {
    const d = wf.details;
    const change = (fn) => () => {
      fn();
      setDirty();
    };
    const text = (id, key, attrs = {}) => h('input', { id, value: d[key] || '', autocomplete: 'off', ...attrs, oninput: (e) => { d[key] = e.target.value; setDirty(); } });
    const ask = (key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d[key], onchange: (e) => { d[key] = e.target.checked; setDirty(); } }), h('span', { class: 'hint' }, 'Prompt on launch'));
    const org = refSelect('d-organization', 'organizations', d.organization, { empty: 'Select…' });
    org.addEventListener('change', change(() => { d.organization = org.readRef(); }));
    const inv = refSelect('d-inventory', 'inventories', d.inventory);
    inv.addEventListener('change', change(() => { d.inventory = inv.readRef(); }));
    const labels = refSelect('d-labels', 'labels', d.labels.filter((l) => l.id), { multiple: true });
    const newLabels = h('input', { id: 'd-new-labels', autocomplete: 'off', placeholder: 'new-label, another', value: d.labels.filter((l) => !l.id).map((l) => l.name).join(', ') });
    const syncLabels = () => {
      const names = newLabels.value.split(',').map((s) => s.trim()).filter(Boolean);
      d.labels = labels.readRef().concat([...new Set(names)].map((name) => ({ id: 0, name })));
      setDirty();
    };
    labels.addEventListener('change', syncLabels);
    newLabels.addEventListener('input', syncLabels);
    const vars = h('textarea', { id: 'd-extraVars', class: 'code', rows: 6, spellcheck: false, placeholder: 'key: value', value: d.extraVars,
      oninput: (e) => { d.extraVars = e.target.value; setDirty(); } });
    const hookService = h('select', { id: 'd-webhookService' },
      option('github', 'GitHub', d.webhookService === 'github'),
      option('gitlab', 'GitLab', d.webhookService === 'gitlab'),
      option('bitbucket_dc', 'Bitbucket Data Center', d.webhookService === 'bitbucket_dc'));
    const hookCredHolder = h('div');
    const renderHookCred = () => {
      const kind = (d.webhookService || 'github') + '_token';
      const sel = refSelect('d-webhookCredential', 'credentials', d.webhookCredential, { filter: (c) => c.kind === kind });
      sel.addEventListener('change', change(() => { d.webhookCredential = sel.readRef(); }));
      hookCredHolder.replaceChildren(field('Webhook credential', sel, { hint: 'Optional token credential, used to post status back to the service.' }));
    };
    const hookBox = h('div', { hidden: !d.webhookService }, field('Webhook service', hookService), hookCredHolder);
    hookService.addEventListener('change', () => {
      d.webhookService = hookService.value;
      d.webhookCredential = null;
      renderHookCred();
      setDirty();
    });
    renderHookCred();
    const hookEnabled = h('input', { type: 'checkbox', checked: !!d.webhookService, onchange: (e) => {
      d.webhookService = e.target.checked ? hookService.value || 'github' : '';
      if (!e.target.checked) d.webhookCredential = null;
      hookBox.hidden = !e.target.checked;
      setDirty();
    } });

    side.replaceChildren(
      h('h2', {}, 'Workflow details'),
      h('p', { class: 'sub' }, d.id ? 'Workflow job template #' + d.id : 'Created in AAP when you save.'),
      field('Name', text('d-name', 'name', { maxlength: 512 }), { required: true, id: 'name' }),
      field('Description', h('textarea', { id: 'd-description', rows: 2, value: d.description, oninput: (e) => { d.description = e.target.value; setDirty(); } })),
      field('Organization', org, { required: true, id: 'organization' }),
      field('Inventory', h('div', {}, inv, ask('askInventory')), { hint: 'Applies to every node that prompts for an inventory.' }),
      field('Limit', h('div', {}, text('d-limit', 'limit'), ask('askLimit'))),
      field('Source control branch', h('div', {}, text('d-scmBranch', 'scmBranch'), ask('askScmBranch'))),
      field('Labels', h('div', {}, labels, h('span', { class: 'hint' }, 'Ctrl/Cmd-click to select several. New labels (comma-separated) are created on save:'), newLabels, ask('askLabels')), { id: 'labels' }),
      field('Job tags', h('div', {}, text('d-jobTags', 'jobTags', { placeholder: 'tag1,tag2' }), ask('askTags'))),
      field('Skip tags', h('div', {}, text('d-skipTags', 'skipTags'), ask('askSkipTags'))),
      field('Extra variables', h('div', {}, vars, ask('askVariables')), { hint: 'YAML or JSON.', id: 'extraVars' }),
      h('h3', {}, 'Options'),
      h('label', { class: 'check option' }, h('input', { type: 'checkbox', checked: d.allowSimultaneous, onchange: (e) => { d.allowSimultaneous = e.target.checked; setDirty(); } }), h('span', {}, 'Enable concurrent jobs')),
      h('label', { class: 'check option' }, hookEnabled, h('span', {}, 'Enable webhook')),
      hookBox,
    );
  }

  // ---- node editor (applied with the Apply / Add button)
  async function nodeForm(draft, { isNew, parentKey }) {
    const original = isNew ? null : nodeByKey(draft.key);
    const form = h('form', { novalidate: true });
    const kindSelect = h('select', { id: 'n-kind' }, Object.entries(KINDS).map(([k, v]) => option(k, v.label, k === draft.kind)));
    const resourceBox = h('div');
    const promptsBox = h('div');
    const daysBox = h('div');
    let launch = null; // launch info of the chosen resource
    let runType = 'success';

    const header = isNew
      ? [h('h2', {}, 'Add step'), h('p', { class: 'sub' }, parentKey ? 'Runs after "' + nodeTitle(nodeByKey(parentKey)) + '".' : 'Runs when the workflow starts.')]
      : [
          h('h2', {}, h('span', { class: 'kind-pill k-' + draft.kind }, KINDS[draft.kind].short), nodeTitle(draft)),
          h('p', { class: 'sub' }, KINDS[draft.kind].label + (draft.id ? ' · node #' + draft.id : ' · not saved yet')),
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'secondary', onclick: () => addStep(draft.key) }, 'Add step after'),
            h('button', { type: 'button', class: 'secondary', onclick: () => startLinking(draft.key) }, 'Link to…'),
            h('button', { type: 'button', class: 'secondary danger', onclick: () => removeNode(draft.key) }, 'Remove')),
        ];

    // Resource (or approval settings)
    function renderResource() {
      launch = null;
      promptsBox.replaceChildren();
      daysBox.replaceChildren();
      if (draft.kind === 'workflow_approval') {
        const a = draft.approval || (draft.approval = { name: '', description: '', timeout: 0 });
        const minutes = h('input', { type: 'number', id: 'n-timeout-min', min: 0, step: 1, value: Math.floor(a.timeout / 60) || '' , placeholder: '0' });
        const seconds = h('input', { type: 'number', id: 'n-timeout-sec', min: 0, max: 59, step: 1, value: a.timeout % 60 || '', placeholder: '0' });
        resourceBox.replaceChildren(
          field('Name', h('input', { id: 'n-approval-name', maxlength: 512, value: a.name, autocomplete: 'off' }), { required: true, id: 'approvalName' }),
          field('Description', h('textarea', { id: 'n-approval-desc', rows: 2, value: a.description })),
          field('Timeout', h('div', { class: 'row' }, minutes, h('span', {}, 'min'), seconds, h('span', {}, 's')),
            { hint: 'Leave empty for no timeout; an expired approval counts as failed.', id: 'timeout' }),
        );
        return;
      }
      const search = h('input', { id: 'n-search', type: 'search', placeholder: 'Filter ' + KINDS[draft.kind].catalog + '…', autocomplete: 'off' });
      const list = h('select', { id: 'n-resource', size: 8 }, option('', 'Loading…'));
      list.disabled = true;
      resourceBox.replaceChildren(field(KINDS[draft.kind].label, h('div', {}, search, list), { required: true, id: 'resource' }));
      let items = [];
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.organization || '').toLowerCase().includes(q));
        const options = shown.slice(0, 500).map((i) => {
          const where = i.inventory ? i.inventory.name : i.organization;
          const o = option(String(i.id), i.name + (where ? ' (' + where + ')' : ''), draft.resource && draft.resource.id === i.id);
          o.item = i;
          return o;
        });
        if (draft.resource && !shown.some((i) => i.id === draft.resource.id) && !q) {
          const o = option(String(draft.resource.id), draft.resource.name + ' (not found in AAP)', true);
          o.item = draft.resource;
          options.unshift(o);
        }
        if (!options.length) options.push(Object.assign(option('', q ? 'No match' : 'Nothing available'), { disabled: true }));
        if (shown.length > 500) options.push(Object.assign(option('', '… ' + (shown.length - 500) + ' more, type to filter'), { disabled: true }));
        list.replaceChildren(...options);
      };
      search.addEventListener('input', fill);
      list.addEventListener('change', () => {
        const o = list.selectedOptions[0];
        if (!o || !o.item) return;
        const changed = !draft.resource || draft.resource.id !== o.item.id;
        draft.resource = { id: o.item.id, name: o.item.name, organization: o.item.organization || null,
          ...(o.item.inventory ? { inventory: o.item.inventory } : {}), ...(o.item.jobType ? { jobType: o.item.jobType } : {}) };
        if (changed) {
          draft.prompts = {};
          draft.survey = {};
          draft.passwordVariables = [];
          draft.days = null;
        }
        fieldError(form, 'resource', '');
        loadPrompts(changed);
      });
      catalog(draft.kind).then((all) => {
        // A workflow cannot run itself.
        items = draft.kind === 'workflow_job_template' && wf.details.id ? all.filter((i) => i.id !== wf.details.id) : all;
        list.disabled = false;
        fill();
      }, (err) => list.replaceChildren(option('', 'Could not load: ' + err.message)));
      if (draft.resource) loadPrompts(false);
    }

    async function loadPrompts(fresh) {
      promptsBox.replaceChildren();
      daysBox.replaceChildren();
      if (draft.kind === 'system_job_template') {
        if (draft.resource && /^cleanup_/.test(draft.resource.jobType || '')) {
          daysBox.append(field('Days of data to keep', h('input', { id: 'n-days', type: 'number', min: 0, step: 1, value: draft.days == null ? '' : draft.days, placeholder: 'Template default' }), { id: 'days' }));
        }
        return;
      }
      if (!PROMPTING.includes(draft.kind) || !draft.resource) return;
      promptsBox.append(h('p', { class: 'loading' }, 'Loading launch options…'));
      const resourceId = draft.resource.id;
      try {
        launch = await launchInfo(draft.kind, resourceId);
      } catch (err) {
        promptsBox.replaceChildren(h('p', { class: 'field-error' }, 'Could not load the launch options: ' + err.message));
        return;
      }
      if (!draft.resource || draft.resource.id !== resourceId) return; // changed meanwhile
      draft.passwordVariables = launch.survey.filter((q) => q.type === 'password').map((q) => q.variable);
      if (fresh) {
        // New choice: start from the survey defaults, as AAP does.
        for (const q of launch.survey) {
          if (q.default !== undefined && q.default !== null && q.default !== '') draft.survey[q.variable] = q.default;
        }
      }
      renderPrompts();
    }

    function renderPrompts() {
      const asks = new Set(launch.asks);
      const p = draft.prompts;
      const def = launch.defaults || {};
      const defName = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map((x) => x.name).join(', ') : v.name) : v);
      const defHint = (key) => {
        const v = defName(def[key]);
        return v !== undefined && v !== null && v !== '' ? 'Template default: ' + v : 'Leave empty for the template default.';
      };
      const rows = [];
      const text = (id, key, defKey) => field(promptLabel(id), h('input', { id: 'p-' + id, value: p[key] || '', autocomplete: 'off', placeholder: defName(def[defKey]) || '' }), { hint: defHint(defKey), id });
      if (asks.has('inventory')) {
        rows.push(field('Inventory', refSelect('p-inventory', 'inventories', p.inventory, { empty: launch.inventoryNeeded ? 'Select…' : '(template default)' }),
          { hint: launch.inventoryNeeded ? 'The template has no inventory: choose one.' : defHint('inventory'), required: launch.inventoryNeeded, id: 'inventory' }));
      }
      if (asks.has('credential')) rows.push(field('Credentials', refSelect('p-credentials', 'credentials', p.credentials, { multiple: true }), { hint: 'Replaces the template credentials of the same type. ' + defHint('credentials'), id: 'credentials' }));
      if (asks.has('execution_environment')) rows.push(field('Execution environment', refSelect('p-ee', 'execution_environments', p.executionEnvironment, { empty: '(template default)' }), { hint: defHint('execution_environment') }));
      if (asks.has('instance_groups')) rows.push(field('Instance groups', refSelect('p-ig', 'instance_groups', p.instanceGroups, { multiple: true }), { hint: defHint('instance_groups') }));
      if (asks.has('labels')) rows.push(field('Labels', refSelect('p-labels', 'labels', p.labels, { multiple: true }), { hint: defHint('labels') }));
      if (asks.has('job_type')) {
        rows.push(field('Job type', h('select', { id: 'p-jobType' }, option('', '(template default)'), option('run', 'Run', p.jobType === 'run'), option('check', 'Check', p.jobType === 'check')), { hint: defHint('job_type') }));
      }
      if (asks.has('scm_branch')) rows.push(text('scmBranch', 'scmBranch', 'scm_branch'));
      if (asks.has('limit')) rows.push(text('limit', 'limit', 'limit'));
      if (asks.has('tags')) rows.push(text('jobTags', 'jobTags', 'job_tags'));
      if (asks.has('skip_tags')) rows.push(text('skipTags', 'skipTags', 'skip_tags'));
      if (asks.has('verbosity')) {
        const labels = ['0 (Normal)', '1 (Verbose)', '2 (More verbose)', '3 (Debug)', '4 (Connection debug)', '5 (WinRM debug)'];
        rows.push(field('Verbosity', h('select', { id: 'p-verbosity' }, option('', '(template default)'), labels.map((l, i) => option(String(i), l, p.verbosity === i))), { hint: defHint('verbosity') }));
      }
      for (const [ask, key, label] of [['forks', 'forks', 'Forks'], ['job_slice_count', 'jobSliceCount', 'Job slicing'], ['timeout', 'timeout', 'Timeout (seconds)']]) {
        if (asks.has(ask)) rows.push(field(label, h('input', { id: 'p-' + key, type: 'number', min: 0, step: 1, value: p[key] == null ? '' : p[key], placeholder: defName(def[ask]) == null ? '' : String(defName(def[ask])) }), { hint: defHint(ask), id: key }));
      }
      if (asks.has('diff_mode')) {
        rows.push(field('Show changes', h('select', { id: 'p-diffMode' }, option('', '(template default)'), option('true', 'On', p.diffMode === true), option('false', 'Off', p.diffMode === false)), { hint: defHint('diff_mode') }));
      }
      if (asks.has('variables')) {
        rows.push(field('Extra variables', h('textarea', { id: 'p-variables', class: 'code', rows: 5, spellcheck: false, value: p.variables || '', placeholder: 'key: value' }), { hint: 'YAML or JSON, added to the launch variables.', id: 'variables' }));
      }
      const nodes = [];
      if (rows.length) nodes.push(h('h3', {}, 'Prompt on launch'), ...rows);
      else nodes.push(h('p', { class: 'hint' }, 'This template prompts for nothing on launch.'));
      if (launch.survey.length) {
        nodes.push(h('h3', {}, 'Survey'));
        for (const q of launch.survey) nodes.push(surveyField(q));
      }
      promptsBox.replaceChildren(...nodes);
    }

    function surveyField(q) {
      const id = 's-' + q.variable;
      const value = draft.survey[q.variable];
      const choices = Array.isArray(q.choices) ? q.choices : String(q.choices || '').split('\n').map((c) => c.trim()).filter(Boolean);
      let control;
      switch (q.type) {
        case 'textarea':
          control = h('textarea', { id, rows: 3, value: value == null ? '' : String(value) });
          break;
        case 'password':
          control = h('input', { id, type: 'password', autocomplete: 'off', value: value == null ? '' : String(value) });
          break;
        case 'integer':
        case 'float':
          control = h('input', { id, type: 'number', step: q.type === 'integer' ? 1 : 'any', min: q.min == null ? undefined : q.min, max: q.max == null ? undefined : q.max, value: value == null ? '' : value });
          break;
        case 'multiplechoice':
          control = h('select', { id }, option('', q.required ? 'Select…' : '(none)'), choices.map((c) => option(c, c, value === c)));
          break;
        case 'multiselect': {
          const selected = Array.isArray(value) ? value : String(value || '').split('\n');
          control = h('select', { id, multiple: true, size: Math.min(6, Math.max(3, choices.length)) }, choices.map((c) => option(c, c, selected.includes(c))));
          break;
        }
        default:
          control = h('input', { id, autocomplete: 'off', value: value == null ? '' : String(value), maxlength: q.max || undefined });
      }
      control.dataset.variable = q.variable;
      return field(q.question_name, control, { hint: q.question_description || (q.type === 'password' && value === '$encrypted$' ? 'Stored in AAP; leave as is to keep it.' : ''), required: q.required, id: id });
    }

    function readForm() {
      const errors = [];
      const err = (id, message) => errors.push([id, message]);
      draft.allParentsMustConverge = form.querySelector('#n-convergence').value === 'all';
      const aliasValue = form.querySelector('#n-alias').value.trim();
      draft.identifier = aliasValue || (UUID.test(draft.identifier) ? draft.identifier : newIdentifier());
      if (aliasValue && wf.nodes.some((n) => n.key !== draft.key && n.identifier === aliasValue)) err('identifier', 'Another node already uses this alias.');
      if (isNew && parentKey) runType = form.querySelector('input[name=run]:checked').value;
      if (draft.kind === 'workflow_approval') {
        const name = form.querySelector('#n-approval-name').value.trim();
        if (!name) err('approvalName', 'Name is required.');
        const min = Number(form.querySelector('#n-timeout-min').value || 0), sec = Number(form.querySelector('#n-timeout-sec').value || 0);
        if (!Number.isInteger(min) || min < 0 || !Number.isInteger(sec) || sec < 0) err('timeout', 'Use whole, non-negative numbers.');
        draft.approval = { ...(draft.approval || {}), name, description: form.querySelector('#n-approval-desc').value, timeout: min * 60 + sec };
        draft.resource = null;
        draft.prompts = {};
        draft.survey = {};
        return errors;
      }
      delete draft.approval;
      if (!draft.resource) {
        err('resource', 'Choose a ' + KINDS[draft.kind].label.toLowerCase() + '.');
        return errors;
      }
      const days = form.querySelector('#n-days');
      if (days) {
        const v = days.value.trim();
        if (v && (!Number.isInteger(Number(v)) || Number(v) < 0)) err('days', 'Use a whole, non-negative number.');
        draft.days = v ? Number(v) : null;
      }
      if (!launch) return errors;
      const p = {};
      const get = (id) => form.querySelector('#' + id);
      if (get('p-inventory')) {
        p.inventory = get('p-inventory').readRef();
        if (launch.inventoryNeeded && !p.inventory) err('inventory', 'The template has no inventory: choose one.');
      }
      if (get('p-credentials')) p.credentials = get('p-credentials').readRef();
      if (get('p-ee')) p.executionEnvironment = get('p-ee').readRef();
      if (get('p-ig')) p.instanceGroups = get('p-ig').readRef();
      if (get('p-labels')) p.labels = get('p-labels').readRef();
      if (get('p-jobType')) p.jobType = get('p-jobType').value;
      for (const key of ['scmBranch', 'limit', 'jobTags', 'skipTags']) if (get('p-' + key)) p[key] = get('p-' + key).value.trim();
      if (get('p-verbosity')) p.verbosity = get('p-verbosity').value === '' ? null : Number(get('p-verbosity').value);
      for (const key of ['forks', 'jobSliceCount', 'timeout']) {
        const el = get('p-' + key);
        if (!el) continue;
        const v = el.value.trim();
        if (v && (!Number.isInteger(Number(v)) || Number(v) < 0)) err(key, 'Use a whole, non-negative number.');
        p[key] = v ? Number(v) : null;
      }
      if (get('p-diffMode')) p.diffMode = get('p-diffMode').value === '' ? null : get('p-diffMode').value === 'true';
      if (get('p-variables')) p.variables = get('p-variables').value;
      draft.prompts = p;
      const survey = {};
      for (const q of launch.survey) {
        const el = get('s-' + q.variable);
        let v;
        if (q.type === 'multiselect') v = [...el.selectedOptions].map((o) => o.value);
        else if (q.type === 'integer' || q.type === 'float') v = el.value.trim() === '' ? '' : Number(el.value);
        else v = el.value;
        const empty = v === '' || (Array.isArray(v) && !v.length);
        if (q.required && empty) err('s-' + q.variable, 'An answer is required.');
        else if (!empty && typeof v === 'number' && ((q.min != null && v < q.min) || (q.max != null && v > q.max))) err('s-' + q.variable, 'Must be between ' + q.min + ' and ' + q.max + '.');
        else if (!empty && typeof v === 'string' && q.type !== 'password' && ((q.min && v.length < q.min) || (q.max && v.length > q.max))) err('s-' + q.variable, 'Length must be between ' + (q.min || 0) + ' and ' + q.max + '.');
        if (!empty) survey[q.variable] = v;
      }
      draft.survey = survey;
      return errors;
    }

    kindSelect.addEventListener('change', () => {
      draft.kind = kindSelect.value;
      draft.resource = null;
      draft.prompts = {};
      draft.survey = {};
      draft.days = null;
      draft.passwordVariables = [];
      if (draft.kind === 'workflow_approval') draft.approval = { name: '', description: '', timeout: 0 };
      else delete draft.approval;
      renderResource();
    });

    const runRow = isNew && parentKey
      ? field('Run', h('div', { class: 'radio-row', role: 'radiogroup' }, Object.entries(LINK_LABELS).map(([type, label]) =>
          h('label', { class: 'check ' + type }, h('input', { type: 'radio', name: 'run', value: type, checked: type === 'success' }), h('span', {}, label)))),
        { hint: 'When this step runs, depending on how "' + nodeTitle(nodeByKey(parentKey)) + '" ends.' })
      : null;
    const convergence = h('select', { id: 'n-convergence' },
      option('any', 'Any — run when any parent link fires', !draft.allParentsMustConverge),
      option('all', 'All — run only when all parent links fire', draft.allParentsMustConverge));

    const rows = [
      field('Node type', kindSelect, { id: 'kind' }),
      resourceBox,
      daysBox,
      runRow,
      field('Convergence', convergence, { hint: 'Matters for nodes with several parents.' }),
      field('Node alias', h('input', { id: 'n-alias', maxlength: 512, autocomplete: 'off', value: alias(draft), placeholder: 'Optional, e.g. deploy-web' }),
        { hint: 'Unique name of the node in this workflow (its identifier). Empty keeps a generated one.', id: 'identifier' }),
      promptsBox,
      h('div', { class: 'form-buttons' },
        h('button', { type: 'submit' }, isNew ? 'Add step' : 'Apply'),
        h('button', { type: 'button', class: 'secondary', onclick: () => select(isNew ? null : { kind: 'node', key: draft.key }) }, isNew ? 'Cancel' : 'Revert')),
    ];
    form.append(...rows.filter(Boolean));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      form.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; });
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      const errors = readForm();
      if (errors.length) {
        for (const [id, message] of errors.reverse()) fieldError(form, id, message);
        return;
      }
      remember();
      draft.dirty = true;
      if (isNew) {
        wf.nodes.push(draft);
        if (parentKey) wf.links.push({ from: parentKey, to: draft.key, type: runType });
      } else {
        // Keep a position dragged while the form was open.
        Object.assign(original, draft, { x: original.x, y: original.y });
      }
      problemKeys.delete(draft.key);
      setDirty();
      select({ kind: 'node', key: draft.key });
      banner('', '');
    });
    side.replaceChildren(...header, form);
    renderResource();
    if (isNew) kindSelect.focus();
  }

  function promptLabel(id) {
    return { scmBranch: 'Source control branch', limit: 'Limit', jobTags: 'Job tags', skipTags: 'Skip tags' }[id] || id;
  }

  // ---------------------------------------------------------------- banner, dialog
  function banner(kind, content) {
    const el = $('banner');
    el.className = 'banner ' + kind;
    el.replaceChildren(...(Array.isArray(content) ? content : [content || '']));
    el.hidden = !content || (Array.isArray(content) && !content.length);
  }
  function confirmDialog(text, ok) {
    return new Promise((resolve) => {
      const dialog = h('dialog', { id: 'dialog' },
        h('p', {}, text),
        h('div', { class: 'form-buttons' },
          h('button', { type: 'button', onclick: () => { dialog.close(); resolve(true); } }, ok),
          h('button', { type: 'button', class: 'secondary', onclick: () => { dialog.close(); resolve(false); } }, 'Cancel')));
      dialog.addEventListener('close', () => { dialog.remove(); resolve(false); });
      document.body.append(dialog);
      dialog.showModal();
    });
  }
  async function confirmDiscard() {
    return !dirty || confirmDialog('Discard the unsaved changes to this workflow?', 'Discard');
  }

  // ---------------------------------------------------------------- open / save
  function setBusy(value, label) {
    busy = value;
    for (const id of ['save', 'new', 'reload', 'wf-select']) $(id).disabled = value;
    $('save').textContent = value ? label || 'Working…' : saveLabel();
  }
  function saveLabel() {
    const api = $('useApi').checked, pb = $('generatePlaybook').checked;
    $('save').disabled = busy || (!api && !pb);
    return api && pb ? 'Save & generate playbook' : pb ? 'Generate playbook' : 'Save';
  }
  for (const id of ['useApi', 'generatePlaybook']) {
    $(id).addEventListener('change', () => {
      vscode.setState({ ...(vscode.getState() || {}), useApi: $('useApi').checked, generatePlaybook: $('generatePlaybook').checked });
      $('save').textContent = saveLabel();
    });
  }

  function setWorkflow(next, { keepPositionsFrom } = {}) {
    if (keepPositionsFrom) {
      for (const node of next.nodes) {
        const old = keepPositionsFrom.get(node.id);
        if (old && old.x != null) {
          node.x = old.x;
          node.y = old.y;
        }
      }
    }
    wf = next;
    undoStack.length = 0;
    problemKeys = new Set();
    linkFrom = null;
    selection = null;
    hintBar('');
    setDirty(false);
    render();
    fit();
    showSide();
    $('wf-select').value = wf.details.id ? String(wf.details.id) : '';
  }

  async function refreshWorkflowList() {
    const select = $('wf-select');
    try {
      workflows = await call('listWorkflows');
    } catch (err) {
      banner('error', 'Could not list workflows: ' + err.message);
      workflows = [];
    }
    select.replaceChildren(option('', '(new workflow)'),
      ...workflows.map((w) => option(String(w.id), w.name + (w.organization ? ' (' + w.organization + ')' : ''))));
    select.value = wf.details.id ? String(wf.details.id) : '';
  }

  async function openWorkflow(id) {
    setBusy(true, 'Loading…');
    banner('info', 'Loading workflow…');
    try {
      const loaded = await call('loadWorkflow', { id });
      setWorkflow(loaded);
      banner('', '');
      vscode.setState({ ...(vscode.getState() || {}), workflowId: id });
    } catch (err) {
      banner('error', 'Could not load the workflow: ' + err.message);
      $('wf-select').value = wf.details.id ? String(wf.details.id) : '';
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    if (linkFrom) cancelLinking();
    const useApi = $('useApi').checked, generatePlaybook = $('generatePlaybook').checked;
    setBusy(true, useApi ? 'Saving…' : 'Generating…');
    banner('', '');
    problemKeys = new Set();
    let res;
    try {
      res = await call('save', { workflow: wf, useApi, generatePlaybook });
    } catch (err) {
      res = { error: err.message };
    }
    setBusy(false);
    if (res.problems) {
      problemKeys = new Set(res.problems.filter((p) => p.node).map((p) => p.node));
      banner('error', [h('b', {}, 'Please fix these problems:'), h('ul', {}, res.problems.map((p) => h('li', {}, p.message)))]);
      const first = res.problems[0];
      if (first.node) select({ kind: 'node', key: first.node });
      else if (first.field) select({ kind: 'details' });
      else render();
      if (first.field) fieldError(side, first.field, first.message);
      return;
    }
    const done = [];
    if (res.playbook) done.push('Playbook opened in the editor.');
    if (res.workflow) {
      // Saving can create labels and workflows: lists loaded before are out of date.
      caches = { catalog: {}, lookup: {}, launch: {} };
      const positions = new Map();
      for (const node of wf.nodes) {
        const id = node.id || (res.progress && res.progress.created[node.key]);
        if (id) positions.set(id, { x: node.x, y: node.y });
      }
      const sel = selection;
      setWorkflow(res.workflow, { keepPositionsFrom: positions });
      done.unshift('Workflow "' + wf.details.name + '" saved in AAP (id ' + wf.details.id + ').');
      await refreshWorkflowList();
      if (sel && sel.kind === 'details') select(sel);
    } else if (res.progress) {
      applyProgress(res.progress);
    }
    if (res.error) banner('error', done.concat(res.error + (res.progress && res.progress.workflowId ? ' Changes saved before the error are kept; fix the problem and save again.' : '')).join(' '));
    else banner('success', done.join(' '));
  }

  /** After a failed save: record what AAP already has, so saving again does not create it twice. */
  function applyProgress(progress) {
    if (progress.workflowId) wf.details.id = progress.workflowId;
    for (const node of wf.nodes) {
      if (progress.created[node.key]) {
        node.id = progress.created[node.key];
        node.dirty = true;
      }
      if (progress.approvals[node.key] && node.approval) node.approval.templateId = progress.approvals[node.key];
    }
    for (const label of progress.labels) {
      const pending = wf.details.labels.find((l) => !l.id && l.name === label.name);
      if (pending && label.id) Object.assign(pending, label);
    }
    render();
  }

  // ---------------------------------------------------------------- session
  let server = null;
  async function onSession(next) {
    session = next;
    $('target').textContent = next ? 'Connected: ' + next.target : 'Not connected';
    $('overlay').hidden = !!next;
    if (!next) {
      $('overlay-text').textContent = 'Logged out of Ansible Automation Platform. The designer works connected: log in to continue. Your unsaved changes are kept.';
      return;
    }
    const otherServer = server !== null && server !== next.server;
    server = next.server;
    caches = { catalog: {}, lookup: {}, launch: {} };
    if (otherServer && (wf.details.id || wf.nodes.length)) {
      setWorkflow(emptyWorkflow());
      banner('info', 'Connected to a different AAP server; the workflow from the previous server was closed.');
    }
    await refreshWorkflowList();
    if (!otherServer && !wf.details.id && !wf.nodes.length && !dirty) {
      const saved = vscode.getState();
      if (saved && saved.workflowId && workflows.some((w) => w.id === saved.workflowId)) await openWorkflow(saved.workflowId);
    }
    if (selection) showSide();
  }
  $('login').addEventListener('click', async () => {
    $('login').disabled = true;
    try {
      await call('login');
    } finally {
      $('login').disabled = false;
    }
  });

  // ---------------------------------------------------------------- toolbar
  $('wf-select').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!(await confirmDiscard())) {
      e.target.value = wf.details.id ? String(wf.details.id) : '';
      return;
    }
    if (id) await openWorkflow(Number(id));
    else {
      setWorkflow(emptyWorkflow());
      select({ kind: 'details' });
      vscode.setState({ ...(vscode.getState() || {}), workflowId: undefined });
    }
  });
  $('new').addEventListener('click', async () => {
    if (!(await confirmDiscard())) return;
    setWorkflow(emptyWorkflow());
    select({ kind: 'details' });
    vscode.setState({ ...(vscode.getState() || {}), workflowId: undefined });
  });
  $('reload').addEventListener('click', async () => {
    if (!(await confirmDiscard())) return;
    caches = { catalog: {}, lookup: {}, launch: {} };
    await refreshWorkflowList();
    if (wf.details.id) await openWorkflow(wf.details.id);
    else setWorkflow(emptyWorkflow());
  });
  $('details').addEventListener('click', () => select({ kind: 'details' }));
  $('add-root').addEventListener('click', () => addStep(null));
  $('remove-all').addEventListener('click', async () => {
    if (!wf.nodes.length) return;
    if (!(await confirmDialog('Remove all ' + wf.nodes.length + ' nodes? Nothing changes in AAP until you save.', 'Remove all'))) return;
    remember();
    wf.nodes = [];
    wf.links = [];
    selection = null;
    setDirty();
    render();
    showSide();
  });
  $('save').addEventListener('click', save);
  $('zoom-in').addEventListener('click', () => { const r = canvas.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); });
  $('zoom-out').addEventListener('click', () => { const r = canvas.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); });
  $('fit').addEventListener('click', fit);
  $('layout').addEventListener('click', () => {
    remember();
    for (const n of wf.nodes) {
      delete n.x;
      delete n.y;
    }
    render();
    fit();
  });
  $('legend-toggle').addEventListener('click', () => { $('legend').hidden = !$('legend').hidden; });

  // ---------------------------------------------------------------- start
  $('canvas-wrap').append(h('div', { class: 'empty-hint', id: 'empty-hint' }, 'Empty workflow. Click + on START to add the first step.'));
  const state = vscode.getState();
  if (state && typeof state.useApi === 'boolean') {
    $('useApi').checked = state.useApi;
    $('generatePlaybook').checked = state.generatePlaybook;
  }
  $('save').textContent = saveLabel();
  setDirty(false);
  render();
  fit();
  showHelp();
  new ResizeObserver(() => { if (!wf.nodes.length) fit(); }).observe(canvas);
  vscode.postMessage({ type: 'ready' });
})();
