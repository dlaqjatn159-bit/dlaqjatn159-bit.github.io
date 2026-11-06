/* 리담 홈페이지 화면 장치 (1106t, Claude)
   캔버스에서 쓰던 틀 문법({{ }}, sc-if, sc-for, onClick, ref)을 일반 웹 페이지에서 그대로 돌림.
   글은 미리 그려 둔 채로 파일에 들어 있고(검색에 잡힘), 이 장치는 누를 때 바뀌는 부분만 고침. */
(function () {
  'use strict';

  // 화면 로직이 물려받는 바탕 (캔버스의 DCLogic과 같은 쓰임)
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = undefined; }
    setState(part) {
      const next = typeof part === 'function' ? part(this.state, this.props) : part;
      this.state = Object.assign({}, this.state, next);
      if (this.__schedule) this.__schedule();
    }
  }
  window.DCLogic = DCLogic;

  // {{ 값 }} 읽기: 참·거짓·숫자·글자, 아니면 a.b.c 길
  function evalExpr(src, scope) {
    const e = src.trim();
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    if (/^(['"]).*\1$/.test(e)) return e.slice(1, -1);
    let v = scope;
    for (const k of e.split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  const ONE = /^\s*\{\{([^}]*)\}\}\s*$/;
  const ANY = /\{\{([^}]*)\}\}/g;
  function interp(str, scope) {
    return str.replace(ANY, (_, e) => { const v = evalExpr(e, scope); return v == null || v === false ? '' : String(v); });
  }

  // 틀 → 새 마디들
  function build(node, scope, out, refs) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') < 0 ? t : interp(t, scope)));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const m = ONE.exec(node.getAttribute('list') || '');
      const list = m ? evalExpr(m[1], scope) : [];
      const as = node.getAttribute('as') || 'item';
      (Array.isArray(list) ? list : []).forEach((item, i) => {
        const s = Object.create(scope); s[as] = item; s.$index = i;
        node.childNodes.forEach((c) => build(c, s, out, refs));
      });
      return;
    }
    if (tag === 'sc-if') {
      const m = ONE.exec(node.getAttribute('value') || '');
      if (m ? evalExpr(m[1], scope) : false) node.childNodes.forEach((c) => build(c, scope, out, refs));
      return;
    }
    const el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName)
      : document.createElement(node.localName);
    el.__ta = new Set();
    for (const a of Array.from(node.attributes)) {
      const n = a.name, v = a.value;
      if (n.startsWith('hint-')) continue;
      const one = ONE.exec(v);
      if (n.length > 2 && n.startsWith('on') && one) {
        const fn = evalExpr(one[1], scope);
        if (typeof fn === 'function') (el.__on = el.__on || {})[n.slice(2).toLowerCase()] = fn;
        continue;
      }
      if (n === 'ref') { if (one) { const fn = evalExpr(one[1], scope); if (typeof fn === 'function') refs.push([fn, el]); } continue; }
      let val;
      if (one) {
        const x = evalExpr(one[1], scope);
        if (x == null || x === false) continue;
        val = x === true ? '' : String(x);
      } else val = v.indexOf('{{') < 0 ? v : interp(v, scope);
      el.setAttribute(n, val); el.__ta.add(n);
    }
    const kids = [];
    const src = node.localName === 'template' ? node.content : node;
    src.childNodes.forEach((c) => build(c, scope, kids, refs));
    kids.forEach((k) => el.appendChild(k));
    out.push(el);
  }

  // 지금 화면을 새 모습에 맞춰 고침 (스크롤로 붙은 data-in 같은 표시는 지우지 않음)
  function patchEl(old, nu) {
    const prev = old.__ta || nu.__ta;
    for (const n of nu.__ta) { const v = nu.getAttribute(n); if (old.getAttribute(n) !== v) old.setAttribute(n, v); }
    for (const n of prev) if (!nu.__ta.has(n) && old.hasAttribute(n)) old.removeAttribute(n);
    old.__ta = nu.__ta; old.__on = nu.__on;
    morph(old, Array.from(nu.childNodes));
  }
  function same(a, b) {
    return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.localName === b.localName && a.namespaceURI === b.namespaceURI));
  }
  function morph(parent, nodes) {
    let cur = parent.firstChild;
    for (const nu of nodes) {
      while (cur && cur.nodeType !== 1 && cur.nodeType !== 3) { const nx = cur.nextSibling; parent.removeChild(cur); cur = nx; }
      if (cur && same(cur, nu)) {
        if (nu.nodeType === 3) { if (cur.nodeValue !== nu.nodeValue) cur.nodeValue = nu.nodeValue; }
        else patchEl(cur, nu);
        cur = cur.nextSibling;
      } else {
        parent.insertBefore(nu, cur);
      }
    }
    while (cur) { const nx = cur.nextSibling; parent.removeChild(cur); cur = nx; }
  }

  // 누르기: 가장 가까운 처리기를 찾아 부름
  document.addEventListener('click', (ev) => {
    for (let n = ev.target; n && n !== document; n = n.parentNode) {
      if (n.__on && n.__on.click) { n.__on.click(ev); return; }
    }
  });

  // 화면 하나 띄우기
  window.DCMount = function (Component, props) {
    const tpl = document.getElementById('dc-tpl');
    const root = document.getElementById('dc-root');
    const comp = new Component(props);
    let queued = false;
    // ref는 실제 화면의 마디를 가리켜야 하므로, 고친 뒤 같은 자리의 마디를 찾음
    const renderAndRef = () => {
      const vals = comp.renderVals ? comp.renderVals() || {} : {};
      const out = [], refs = [];
      tpl.content.childNodes.forEach((c) => build(c, vals, out, refs));
      const marks = refs.map(([, el]) => el);
      marks.forEach((el, i) => { el.setAttribute('data-ref-i', String(i)); el.__ta.add('data-ref-i'); });
      morph(root, out);
      refs.forEach(([fn], i) => {
        const real = root.querySelector('[data-ref-i="' + i + '"]');
        if (real) { real.removeAttribute('data-ref-i'); if (real.__ta) real.__ta.delete('data-ref-i'); }
        fn(real);
      });
      queued = false;
    };
    comp.__schedule = () => { if (!queued) { queued = true; Promise.resolve().then(renderAndRef); } };
    renderAndRef();
    if (window.__RD_PRERENDER) return comp;
    if (comp.componentDidMount) comp.componentDidMount();
    return comp;
  };
})();
