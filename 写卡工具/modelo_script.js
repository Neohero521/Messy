(function() {
  const SCRIPT_ID = 'modelo-char-generator';

  function showToast(msg, type) {
    type = type || 'info';
    if (type === 'warn') type = 'warning';
    try {
      if (window.parent && window.parent.toastr && window.parent.toastr[type]) window.parent.toastr[type](msg);
      else if (typeof toastr !== 'undefined' && toastr && toastr[type]) toastr[type](msg);
      else if (window.parent && window.parent.toastr) window.parent.toastr.info(msg);
      else alert(msg);
    } catch (e) { try { alert(msg); } catch(_) { console.log(msg); } }
  }

  // ===== Token估算 =====
  function countTokens(text) {
    if (!text) return 0;
    var t = String(text);
    var cn = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var enWords = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    return cn + Math.ceil(enWords * 0.75);
  }

  // ===== Iframe创建 =====
  function createModalIframe() {
    return new Promise(function(resolve, reject) {
      try {
        var parentDoc = (window.parent && window.parent.document) ? window.parent.document : document;
        var old = parentDoc.getElementById(SCRIPT_ID + '-modal');
        if (old) old.remove();
        var iframe = parentDoc.createElement('iframe');
        iframe.id = SCRIPT_ID + '-modal';
        iframe.setAttribute('script_id', SCRIPT_ID);
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:99999;background:#0d1117;';
        iframe.addEventListener('load', function() {
          try {
            var d = iframe.contentDocument || iframe.contentWindow.document;
            var s = d.createElement('style');
            s.textContent = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;font-size:14px}
.app{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0)}
.topbar{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#161b22;border-bottom:1px solid #30363d;min-height:42px}
.topbar h1{font-size:1em;background:linear-gradient(90deg,#f78166,#d2a8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar .phase{font-size:.75em;color:#d2a8ff;margin-left:8px;flex-shrink:0}
.main{flex:1 1 0;display:flex;min-height:0;overflow:hidden}
.chat-panel{flex:1.4 1 0;display:flex;flex-direction:column;min-width:0;border-right:1px solid #30363d;min-height:0;overflow:hidden}
.preview-panel{flex:1 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:#0d1117}
.chat-header{flex-shrink:0;padding:6px 12px;background:#161b22;border-bottom:1px solid #21262d;font-size:.78em;color:#d2a8ff;display:flex;align-items:center;gap:5px}
.chat-messages{flex:1 1 0;overflow-y:auto;padding:10px;min-height:0;-webkit-overflow-scrolling:touch}
.chat-msg{display:flex;gap:8px;margin-bottom:12px;align-items:flex-start}
.chat-msg.user{flex-direction:row-reverse}
.chat-msg .avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px}
.chat-msg.assistant .avatar{background:rgba(210,168,255,.15)}
.chat-msg.user .avatar{background:rgba(247,129,102,.15)}
.chat-msg .bubble{max-width:82%;padding:8px 12px;border-radius:10px;font-size:.85em;line-height:1.6;word-break:break-word}
.chat-msg.assistant .bubble{background:#161b22;border:1px solid #30363d;border-bottom-left-radius:4px;color:#c9d1d9}
.chat-msg.user .bubble{background:linear-gradient(135deg,#f78166,#da6152);color:#fff;border-bottom-right-radius:4px}
.chat-msg .bubble b{color:#d2a8ff}
.chat-msg .bubble code{background:rgba(110,118,129,.2);padding:1px 4px;border-radius:3px;font-size:.82em}
.chat-msg .bubble pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;overflow-x:auto;font-size:.75em;margin:6px 0;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.typing{color:#8b949e;font-style:italic;font-size:.8em;padding:4px 8px}
.typing span{display:inline-block;animation:blink 1.4s infinite;color:#f78166}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
.quick-actions{flex-shrink:0;display:flex;gap:4px;padding:6px 8px;flex-wrap:wrap;border-top:1px solid #21262d;background:#161b22;max-height:100px;overflow-y:auto}
.quick-btn{padding:4px 8px;background:rgba(110,118,129,.08);color:#8b949e;border:1px solid #30363d;border-radius:5px;cursor:pointer;font-size:10.5px;transition:all .2s;white-space:nowrap;flex-shrink:0}
.quick-btn:hover:not(:disabled){background:rgba(247,129,102,.2);color:#f78166;border-color:#f78166}
.quick-btn.hl{border-color:#d2a8ff;color:#d2a8ff;background:rgba(210,168,255,.1)}
.quick-btn.hl:hover:not(:disabled){background:rgba(247,129,102,.2);color:#f78166;border-color:#f78166}
.quick-btn:disabled{opacity:.4;cursor:not-allowed}
.chat-input-area{flex-shrink:0;padding:8px 10px 10px;border-top:1px solid #21262d;background:#161b22}
.chat-input{width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:14px;resize:none;min-height:38px;max-height:90px;font-family:inherit;line-height:1.4}
.chat-input:focus{outline:none;border-color:#f78166;box-shadow:0 0 0 2px rgba(247,129,102,.2)}
.chat-input:disabled{opacity:.5}
.chat-send-row{display:flex;gap:6px;margin-top:6px}
.btn{padding:7px 14px;border:none;border-radius:6px;font-size:.8em;cursor:pointer;font-weight:600;transition:all .2s}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:linear-gradient(135deg,#f78166,#da6152);color:#fff}
.btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 3px 10px rgba(247,129,102,.3)}
.btn-success{background:linear-gradient(135deg,#3fb950,#2ea043);color:#fff}
.btn-success:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 3px 10px rgba(63,185,80,.3)}
.btn-ghost{background:rgba(110,118,129,.1);color:#8b949e;border:1px solid #30363d}
.btn-ghost:hover:not(:disabled){background:rgba(110,118,129,.2)}
.btn-warn{background:linear-gradient(135deg,#d29922,#bb8009);color:#fff}
.btn-warn:hover:not(:disabled){transform:translateY(-1px)}
.preview-header{flex-shrink:0;padding:6px 12px;background:#161b22;border-bottom:1px solid #21262d;font-size:.78em;color:#d2a8ff;display:flex;justify-content:space-between;align-items:center}
.preview-body{flex:1;overflow-y:auto;padding:10px;min-height:0;-webkit-overflow-scrolling:touch}
.pv-section{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 10px;margin-bottom:8px}
.pv-section h3{font-size:.78em;color:#f78166;margin-bottom:5px;display:flex;align-items:center;gap:4px;justify-content:space-between}
.pv-section h3 .sec-left{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-section h3 .sec-right{font-size:.68em;color:#8b949e;font-weight:400;flex-shrink:0}
.pv-section .pv-content{font-size:.75em;color:#8b949e;line-height:1.55;white-space:pre-wrap;max-height:120px;overflow:hidden;position:relative}
.pv-section .pv-empty{color:#484f58;font-style:italic;font-size:.72em}
.pv-section .pv-entry{background:#0d1117;padding:5px 8px;border-radius:4px;margin-bottom:4px;border-left:2px solid #d2a8ff}
.pv-section .pv-entry-title{font-size:.72em;color:#d2a8ff;font-weight:600;margin-bottom:2px}
.pv-section .pv-entry-content{font-size:.7em;color:#8b949e;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pv-book-name{font-size:.72em;color:#d2a8ff;background:rgba(210,168,255,.1);padding:2px 6px;border-radius:4px;cursor:pointer;border:1px dashed transparent;transition:all .2s;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-book-name:hover{border-color:#d2a8ff}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;flex-shrink:0}
.dot.full{background:#3fb950}
.dot.empty{background:#484f58}
.progress-bar{height:4px;background:#21262d;border-radius:2px;overflow:hidden;margin:4px 0}
.progress-bar-fill{height:100%;background:linear-gradient(90deg,#f78166,#d2a8ff);transition:width .3s}
.module-progress{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px}
.module-item{font-size:.65em;padding:3px 5px;background:#0d1117;border-radius:3px;text-align:center}
.module-item.done{color:#3fb950;border:1px solid rgba(63,185,80,.3)}
.module-item.partial{color:#d29922;border:1px solid rgba(210,153,34,.3)}
.module-item.todo{color:#484f58;border:1px solid #21262d}
.close-btn{position:fixed;top:8px;right:8px;width:30px;height:30px;border-radius:50%;background:rgba(247,129,102,.15);border:1px solid #f78166;color:#f78166;font-size:1em;cursor:pointer;z-index:100000;display:flex;align-items:center;justify-content:center;transition:all .3s;flex-shrink:0}
.close-btn:hover{background:#f78166;color:#fff;transform:rotate(90deg)}
.json-modal,.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:100001}
.json-modal-content,.modal-content{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;width:90%;max-width:800px;max-height:85vh;display:flex;flex-direction:column}
.json-modal-content textarea{width:100%;flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#3fb950;font-family:'Consolas',monospace;font-size:.75em;padding:8px;resize:none;min-height:250px}
.modal-body{flex:1;overflow-y:auto;min-height:200px}
.welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;overflow:auto}
.welcome h2{font-size:1.4em;background:linear-gradient(90deg,#f78166,#d2a8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:14px}
.welcome p{color:#8b949e;font-size:.88em;line-height:1.8;max-width:460px;margin-bottom:20px}
.welcome .start-btn{padding:12px 32px;background:linear-gradient(135deg,#f78166,#da6152);color:#fff;border:none;border-radius:22px;font-size:.95em;font-weight:700;cursor:pointer;transition:all .3s}
.welcome .start-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(247,129,102,.4)}
.welcome-features{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0;max-width:460px}
.wf-item{background:rgba(210,168,255,.08);border:1px solid rgba(210,168,255,.2);border-radius:8px;padding:10px;text-align:left}
.wf-icon{font-size:1.3em;margin-bottom:4px}
.wf-title{font-size:.8em;color:#d2a8ff;font-weight:600;margin-bottom:2px}
.wf-desc{font-size:.68em;color:#8b949e;line-height:1.4}
.qc-item{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px 10px;margin-bottom:6px}
.qc-item.pass{border-color:rgba(63,185,80,.3)}
.qc-item.fail{border-color:rgba(248,81,73,.4);background:rgba(248,81,73,.05)}
.qc-title{font-size:.78em;font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:3px}
.qc-pass{color:#3fb950}
.qc-fail{color:#f85149}
.qc-desc{font-size:.7em;color:#8b949e;line-height:1.5}
.qc-fix{font-size:.68em;color:#d29922;margin-top:3px}
.opt-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.opt-pane{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:.72em;line-height:1.5;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.opt-pane.before{border-color:#30363d}
.opt-pane.after{border-color:rgba(63,185,80,.4)}
.opt-label{font-size:.68em;font-weight:600;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #21262d}
.opt-label.before{color:#8b949e}
.opt-label.after{color:#3fb950}
.opt-field-select{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.opt-field-tag{padding:3px 8px;background:rgba(110,118,129,.08);border:1px solid #30363d;border-radius:4px;font-size:.7em;cursor:pointer;transition:all .2s}
.opt-field-tag.selected{background:rgba(247,129,102,.2);border-color:#f78166;color:#f78166}
.modal-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid #21262d;flex-shrink:0}
.sb-wrap{display:block;margin-top:8px;padding:10px;background:#0d1117;border-radius:6px;font-size:.78em;line-height:1.55;border:1px solid #30363d}
.sb-wrap .sb-header{font-size:.85em;color:#facc15;margin-bottom:8px;font-weight:600;text-align:center}
.sb-wrap .sb-section{margin-bottom:4px}
.sb-wrap .sb-summary{cursor:pointer;font-weight:600;color:#d2a8ff;font-size:.95em;padding:3px 0;user-select:none}
.sb-wrap .sb-summary::before{content:'▼ ';font-size:.7em;margin-right:2px;transition:transform .2s;display:inline-block}
.sb-wrap .sb-section:not(.open) .sb-summary::before{transform:rotate(-90deg)}
.sb-wrap .sb-content{padding:3px 0 3px 8px;color:#8b949e}
.sb-wrap .sb-field{display:flex;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.sb-wrap .sb-field:last-child{border-bottom:none}
.sb-wrap .sb-field-label{color:#d2a8ff;font-weight:600;flex-shrink:0}
.sb-wrap .sb-field-value{color:#8b949e}
.sb-wrap details{margin-bottom:6px}
.sb-wrap summary{cursor:pointer;font-weight:600;color:#d2a8ff;font-size:.95em;padding:3px 0;list-style:none}
.sb-wrap summary::-webkit-details-marker{display:none}
.sb-wrap summary::before{content:'▼ ';font-size:.7em;margin-right:2px;transition:transform .2s;display:inline-block}
.sb-wrap details[open] summary::before{transform:rotate(0deg)}
.sb-wrap details:not([open]) summary::before{transform:rotate(-90deg)}
.sb-wrap ul{margin:4px 0 4px 18px;padding:0}
.sb-wrap ol{margin:4px 0 4px 20px;padding:0}
.sb-wrap li{margin:2px 0;color:#8b949e;font-size:.92em;line-height:1.5}
.sb-wrap li b{color:#c9d1d9}
.sb-wrap p{margin:3px 0;color:#8b949e;font-size:.92em}
.sb-wrap p b{color:#d2a8ff}
.sb-wrap .sb-btn{display:inline-block;padding:4px 10px;margin:2px 3px;background:#21262d;border:1px solid #30363d;border-radius:12px;font-size:.88em;color:#c9d1d9;cursor:pointer;transition:all .15s}
.sb-wrap .sb-btn:active{background:#f78166;color:#fff;border-color:#f78166}

.mod-dash{display:block;margin:8px 0;background:#161b22;border:1px solid #21262d;border-radius:6px;overflow:hidden}
.mod-dash .md-header{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;user-select:none;font-size:.75em;color:#d2a8ff}
.mod-dash .md-analyze-btn{font-size:.65em;padding:2px 6px;border-radius:3px;background:rgba(210,168,255,.1);border:1px solid rgba(210,168,255,.3);color:#d2a8ff;cursor:pointer;transition:all .15s;white-space:nowrap}
.mod-dash .md-analyze-btn:hover{background:rgba(210,168,255,.2);border-color:rgba(210,168,255,.5)}
.mod-dash .md-analyze-btn:active{background:rgba(210,168,255,.3)}
.mod-dash .md-header .md-arrow{font-size:.65em;transition:transform .2s;color:#8b949e}
.mod-dash.collapsed .md-header .md-arrow{transform:rotate(-90deg)}
.mod-dash .md-body{padding:0 10px 8px;transition:max-height .3s ease;max-height:200px;overflow:hidden}
.mod-dash.collapsed .md-body{max-height:0;padding-top:0;padding-bottom:0}
.mod-dash-item{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:.7em;cursor:pointer;padding:3px 5px;border-radius:4px;transition:background .15s}
.mod-dash-item:hover{background:#0d1117}
.mod-dash-item .m-icon{width:16px;text-align:center;flex-shrink:0}
.mod-dash-item .m-name{width:52px;flex-shrink:0;color:#8b949e;font-size:.65em}
.mod-dash-item .m-bar-wrap{flex:1;height:4px;background:#0d1117;border-radius:2px;overflow:hidden;display:block}
.mod-dash-item .m-bar{height:100%;border-radius:2px;transition:width .4s ease;display:block}
.mod-dash-item .m-bar.done{background:#3fb950}
.mod-dash-item .m-bar.prog{background:#d2a8ff}
.mod-dash-item .m-bar.empty{background:#21262d}
.mod-dash-item .m-pct{width:28px;text-align:right;font-size:.6em;color:#8b949e;flex-shrink:0}

.chat-input-char-count{font-size:.65em;color:#484f58;text-align:right;padding:2px 6px 0;transition:color .2s}
.chat-input-char-count.warn{color:#d29922}
.chat-input-char-count.over{color:#f85149}

.send-btn-pulse{animation:pulse-send 2s infinite;box-shadow:0 0 8px rgba(247,129,102,.3)}
@keyframes pulse-send{0%,100%{box-shadow:0 0 4px rgba(247,129,102,.2)}50%{box-shadow:0 0 12px rgba(247,129,102,.4),0 0 20px rgba(210,168,255,.2)}}

.welcome-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center}
.welcome-actions .btn{flex:1;min-width:120px;max-width:180px}

.scroll-btns{position:absolute;right:12px;bottom:8px;display:flex;flex-direction:column;gap:3px;z-index:10;opacity:0;transition:opacity .2s;pointer-events:none}
.scroll-btns.show{opacity:1;pointer-events:auto}
.scroll-btns button{width:22px;height:22px;border-radius:50%;background:#21262d;border:1px solid #30363d;color:#8b949e;font-size:.65em;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1}
.scroll-btns button:active{background:#f78166;color:#fff;border-color:#f78166}

.import-dropzone{padding:20px;text-align:center;border:2px dashed #30363d;border-radius:8px;margin-bottom:10px;cursor:pointer;transition:all .2s}
.import-dropzone:hover{border-color:#d2a8ff;background:rgba(210,168,255,.05)}
.import-dropzone .dz-icon{font-size:2em;margin-bottom:6px}
.import-dropzone .dz-text{font-size:.78em;color:#8b949e}
.import-tabs{display:flex;gap:4px;margin-bottom:10px}
.import-tab{flex:1;padding:6px 8px;background:#0d1117;border:1px solid #21262d;border-radius:6px;font-size:.72em;color:#8b949e;cursor:pointer;text-align:center;transition:all .15s}
.import-tab.active{background:rgba(247,129,102,.15);border-color:#f78166;color:#f78166}

.entry-detail{display:none;margin-top:6px;padding:8px;background:#0d1117;border-radius:4px;font-size:.68em}
.entry-detail.open{display:block}
.entry-detail .ext-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:4px}
.entry-detail .ext-item{text-align:center}
.entry-detail .ext-item label{display:block;color:#484f58;font-size:.6em;margin-bottom:2px}
.entry-detail .ext-item input,.entry-detail .ext-item select{width:100%;padding:2px 3px;background:#161b22;border:1px solid #21262d;border-radius:3px;color:#c9d1d9;font-size:.65em;text-align:center;outline:none}
.mod-focus{display:flex;flex-wrap:nowrap;gap:4px;padding:4px 8px;flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;border-bottom:1px solid #21262d;background:#161b22}
.mod-focus::-webkit-scrollbar{height:0}
.mod-focus-btn{padding:4px 10px;background:#0d1117;border:1px solid #30363d;border-radius:12px;font-size:.7em;color:#8b949e;cursor:pointer;white-space:nowrap;transition:all .15s;flex-shrink:0}
.mod-focus-btn:active,.mod-focus-btn.active{background:#f78166;color:#fff;border-color:#f78166}

.wv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.wv-stat{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:6px 8px;text-align:center}
.wv-stat .wv-stat-val{font-size:1.1em;font-weight:700;display:block}
.wv-stat .wv-stat-lbl{font-size:.62em;color:#8b949e;display:block;margin-top:2px}
.wv-legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:.65em}
.wv-legend-item{display:flex;align-items:center;gap:3px;color:#8b949e}
.wv-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.wv-entry{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:6px 8px;margin-bottom:6px;border-left:3px solid #6e7681}
.wv-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.wv-entry-name{font-size:.78em;font-weight:600;color:#c9d1d9;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-entry-level{font-size:.6em;padding:1px 6px;border-radius:3px;font-weight:600;white-space:nowrap}
.wv-entry-token{font-size:.62em;color:#8b949e;flex-shrink:0}
.wv-entry-meta{display:flex;flex-wrap:wrap;gap:4px;font-size:.6em;color:#8b949e}
.wv-entry-meta .wv-tag{background:#161b22;border:1px solid #21262d;border-radius:3px;padding:1px 5px;white-space:nowrap}
.wv-entry-meta .wv-tag.const{color:#3fb950;border-color:rgba(63,185,80,.3)}
.wv-entry-meta .wv-tag.trig{color:#d2a8ff;border-color:rgba(210,168,255,.3)}
.wv-entry-meta .wv-tag.dyn{color:#f78166;border-color:rgba(247,129,102,.3)}
.wv-entry-meta .wv-tag.warn{color:#d29922;border-color:rgba(210,153,34,.3)}
.wv-group-header{font-size:.7em;font-weight:600;color:#d2a8ff;margin:8px 0 4px;padding-bottom:3px;border-bottom:1px solid #21262d;display:flex;justify-content:space-between;align-items:center}
.wv-group-count{font-size:.85em;color:#8b949e;font-weight:400}

.genre-preset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}
.genre-preset-card{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px;cursor:pointer;transition:all .2s;text-align:center}
.genre-preset-card:hover{border-color:#f78166;background:rgba(247,129,102,.05);transform:translateY(-1px)}
.genre-preset-card .gp-icon{font-size:1.4em;margin-bottom:4px}
.genre-preset-card .gp-name{font-size:.78em;font-weight:600;color:#d2a8ff;margin-bottom:2px}
.genre-preset-card .gp-desc{font-size:.6em;color:#8b949e;line-height:1.3}

.group-mgr-list{margin:8px 0}
.group-mgr-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#0d1117;border:1px solid #21262d;border-radius:5px;margin-bottom:4px;font-size:.72em}
.group-mgr-item .gm-color{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.group-mgr-item .gm-name{flex:1;color:#c9d1d9;font-weight:600}
.group-mgr-item .gm-count{color:#8b949e;font-size:.85em}
.group-mgr-item .gm-toggle{padding:2px 8px;border-radius:3px;font-size:.85em;cursor:pointer;border:1px solid #30363d;background:#161b22;color:#8b949e}
.group-mgr-item .gm-toggle.on{background:rgba(63,185,80,.15);color:#3fb950;border-color:rgba(63,185,80,.3)}
@media(max-width:768px){
  .main{flex-direction:column}
  .preview-panel{border-top:1px solid #30363d;flex:0 0 40%}
  .chat-panel{flex:1 1 0;border-right:none;border-bottom:1px solid #30363d}
  .topbar h1{font-size:.9em}
  .topbar .phase{font-size:.7em}
  .chat-msg .bubble{max-width:78%}
  .opt-compare{grid-template-columns:1fr}
  .quick-actions{max-height:70px}
  .mod-focus-btn{font-size:.65em;padding:3px 8px}
}
@media(max-height:500px){
  .topbar{padding:6px 10px}
  .topbar h1{font-size:.85em;margin:0}
  .topbar .phase{font-size:.7em}
  .mod-focus{padding:4px 8px;gap:4px}
  .mod-focus-btn{font-size:.7em;padding:3px 6px}
  .chat-input-area{padding:6px 10px;gap:4px}
  .chat-input{min-height:36px;padding:6px}
  .quick-actions{gap:4px}
  .quick-btn{font-size:.7em;padding:4px 8px}
  .preview-panel .pv-header{padding:6px 10px;font-size:.8em}
  .pv-section h3{font-size:.78em;margin-bottom:2px}
  .pv-section{padding:6px 10px}
  .pv-content{font-size:.72em;line-height:1.4}
  .json-modal-content,.modal-content{padding:10px;max-height:90vh}
  .modal-body{max-height:60vh}
}
@media(orientation:landscape) and (max-height:600px){
  .app{height:100%;height:100vh}
  .topbar{padding:5px 8px;min-height:32px}
  .topbar h1{font-size:.85em}
  .mod-focus{padding:3px 6px;gap:3px}
  .mod-focus-btn{font-size:.65em;padding:3px 6px}
  .chat-input-area{padding:4px 8px;gap:3px}
  .chat-input{min-height:32px;padding:5px;font-size:.85em}
  .send-btn{padding:5px 12px;font-size:.85em}
  .quick-actions{gap:3px;max-height:60px}
  .quick-btn{font-size:.68em;padding:3px 6px}
  .pv-body{padding:6px}
  .pv-section{padding:4px 8px}
  .pv-section h3{font-size:.78em}
  .pv-content{font-size:.72em;line-height:1.4}
  .welcome{padding:16px}
  .welcome h2{font-size:1.1em;margin-bottom:6px}
  .welcome p{font-size:.8em;margin-bottom:8px}
}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
::-webkit-scrollbar-thumb:hover{background:#484f58}
`;
            d.head.appendChild(s);
            resolve(d);
          } catch (e) { reject(e); }
        });
        parentDoc.body.appendChild(iframe);
        setTimeout(function() {
          try { if (!iframe.contentDocument || !iframe.contentDocument.body) reject(new Error('iframe timeout')); } catch(e) { reject(e); }
        }, 4000);
      } catch (e) { reject(e); }
    });
  }

  function closeModal() {
    try { var pDoc = (window.parent && window.parent.document) ? window.parent.document : document; var m = pDoc.getElementById(SCRIPT_ID + '-modal'); if (m) m.remove(); } catch(e) {}
  }

  // ===== 世界书名称生成 =====
  function genBookName(worldName) {
    if (!worldName || !worldName.trim()) return '世界设定集';
    return worldName.trim() + ' · 世界书';
  }

  // ===== 世界书条目模板（ST权重分层8体系 · 完整12项原生参数） =====
  // 参数体系：触发精准类(keys/secondary_keys/use_regex/match_whole_words/scan_depth)
  //          生效控制类(sticky/cooldown/delay) 递归安全类(prevent_recursion/exclude_recursion/delay_until_recursion)
  //          数量控制类(selectiveLogic/probability/use_probability) 分组管理类(group/groupWeight)
  // WI参数规范（对齐 ST world_info_logic / world_info_position）：
  //   scan_depth: 常驻=0（不扫描），触发类=3-8（限制关键词扫描的消息深度）
  //   useProbability: 常驻=false（无需概率掷骰），触发类=true（probability 才生效）
  //   group: 空字符串=无互斥分组（多条可共存）；非空=同组仅注入1条（用于叙事类互斥）
  //   selectiveLogic: 0=AND_ANY 1=NOT_ALL 2=NOT_ANY 3=AND_ALL（次级关键词逻辑，非随机选择）
  //          注意：核心铁则不在世界书条目中，而是放入post_history_instructions字段（常驻最高权重位）
  var ENTRY_TEMPLATES = {
    '基础公理': { constant: true, selective: false, position: 0, depth: 0, order: 250, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '世界元数据': { constant: true, selective: false, position: 0, depth: 0, order: 240, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '交互软规则': { constant: true, selective: false, position: 1, depth: 0, order: 150, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '近场强约束': { constant: false, selective: true, position: 2, depth: 2, order: 180, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] },
    '当前局势': { constant: false, selective: true, position: 2, depth: 3, order: 170, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] },
    '场景机制': { constant: false, selective: true, position: 1, depth: 3, order: 140, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '核心玩法': { constant: false, selective: true, position: 1, depth: 3, order: 130, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '世界规则': { constant: false, selective: true, position: 1, depth: 4, order: 120, cooldown: 3, delay: null, sticky: null, secondary_keys: [], prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '实体交互': { constant: false, selective: true, position: 1, depth: 3, order: 110, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '重要角色': { constant: false, selective: true, position: 1, depth: 3, order: 105, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '势力与组织': { constant: false, selective: true, position: 1, depth: 3, order: 100, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '物品': { constant: false, selective: true, position: 1, depth: 3, order: 95, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '地点场景': { constant: false, selective: true, position: 1, depth: 3, order: 90, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, secondary_keys: [], use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '叙事背景': { constant: false, selective: true, position: 4, depth: 5, order: 80, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '故事发展': { constant: false, selective: true, position: 4, depth: 5, order: 75, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '文化与习俗': { constant: false, selective: true, position: 4, depth: 5, order: 70, probability: 60, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '历史事件': { constant: false, selective: true, position: 4, depth: 6, order: 65, probability: 50, cooldown: null, delay: null, sticky: null, selectiveLogic: 0, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 1, use_regex: true, match_whole_words: null, scan_depth: 8, useProbability: true, group: '叙事', group_weight: 100 },
    '动态适配': { constant: false, selective: true, position: 1, depth: 4, order: 50, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '引导机制': { constant: false, selective: true, position: 1, depth: 4, order: 45, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '互动选项': { constant: false, selective: true, position: 1, depth: 4, order: 40, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '状态栏': { constant: false, selective: true, position: 2, depth: 2, order: 35, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '统一输出格式': { constant: true, selective: false, position: 0, depth: 1, order: 85, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '角色边界': { constant: true, selective: false, position: 0, depth: 2, order: 80, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '禁止项': { constant: true, selective: false, position: 0, depth: 3, order: 70, prevent_recursion: true, exclude_recursion: true, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '自定义条目': { constant: false, selective: true, position: 1, depth: 4, order: 55, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 }
  };

  // ===== 权重等级映射（用于权重可视化预览） =====
  // 权重从低到高：极低/低/中低/中/中高/高/极高/最高
  // 注意：核心铁则通过post_history_instructions字段实现（最高权重），不在世界书条目中
  var WEIGHT_LEVELS = {
    '基础公理': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，世界元数据锚定' },
    '世界元数据': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，底层背景' },
    '交互软规则': { level: '低', color: '#8b949e', desc: 'position=1 常驻，角色卡之后注入' },
    '近场强约束': { level: '极高', color: '#ff7b72', desc: 'position=2 触发，用户输入之前' },
    '当前局势': { level: '极高', color: '#ff7b72', desc: 'position=2 触发，sticky粘性' },
    '场景机制': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发' },
    '核心玩法': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发' },
    '世界规则': { level: '中高', color: '#d29922', desc: 'position=1 depth=4 触发' },
    '实体交互': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '重要角色': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '势力与组织': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '物品': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '地点场景': { level: '中高', color: '#d29922', desc: 'position=1 depth=3 触发，防递归' },
    '叙事背景': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '故事发展': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '文化与习俗': { level: '中', color: '#3fb950', desc: 'position=4 depth=5 概率触发' },
    '历史事件': { level: '中', color: '#3fb950', desc: 'position=4 depth=6 概率触发' },
    '动态适配': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '引导机制': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '互动选项': { level: '中', color: '#3fb950', desc: 'position=1 depth=4 动态系统，按需加载' },
    '状态栏': { level: '极高', color: '#ff7b72', desc: 'position=2 depth=2 sticky粘性' },
    '统一输出格式': { level: '极低', color: '#6e7681', desc: 'position=0 常驻' },
    '角色边界': { level: '极低', color: '#6e7681', desc: 'position=0 常驻' },
    '禁止项': { level: '极低', color: '#6e7681', desc: 'position=0 常驻，禁止规则' },
    '自定义条目': { level: '中', color: '#3fb950', desc: '用户自定义' }
  };

  // ===== 题材预设模板（规范4.4：一键套用最优参数） =====
  var GENRE_PRESETS = {
    '修仙': {
      icon: '🏔️', desc: '修炼境界、宗门势力、天材地宝',
      tags: ['🎲 RPG', '🏔️ 修仙', '⚔️ 玄幻', '🧘 修炼'],
      suggestedName: '青云大陆',
      keyTerms: ['修炼', '境界', '灵气', '宗门', '丹药', '法宝', '渡劫', '元婴', '金丹', '筑基'],
      sceneKeys: ['战斗', '修炼', '突破', '渡劫', '炼丹', '炼器', '拍卖', '宗门'],
      coreRule: '修仙境界：练气→筑基→金丹→元婴→化神→渡劫→大乘。境界差距决定战力，不可越级挑战。',
      entryHints: {
        '基础公理': '灵气为本，天道循环，修炼逆天而行',
        '核心玩法': '修炼境界突破、宗门任务、探索秘境、炼丹炼器',
        '世界规则': '境界压制、灵气浓度、天劫法则',
        '实体交互': '宗门掌门、长老、师兄妹、妖兽、灵草'
      }
    },
    '末世': {
      icon: '☢️', desc: '资源匮乏、丧尸变异、人类幸存',
      tags: ['🎲 RPG', '☢️ 末世', '🔫 生存', '🧟 变异'],
      suggestedName: '废土纪元',
      keyTerms: ['丧尸', '变异', '幸存者', '物资', '避难所', '辐射', '进化', '搜刮', '营地', '感染'],
      sceneKeys: ['战斗', '搜刮', '逃亡', '建设', '交易', '侦查', '救援', '防守'],
      coreRule: '物资稀缺，资源即生命。丧尸夜间活跃，幸存者营地需轮流守夜。感染超过72小时必变异。',
      entryHints: {
        '基础公理': '病毒爆发，文明崩塌，适者生存',
        '核心玩法': '搜刮物资、营地建设、丧尸战斗、幸存者招募',
        '世界规则': '感染机制、辐射区、物资刷新、变异等级',
        '实体交互': '幸存者、商人、掠夺者、变异体、军方残部'
      }
    },
    '西幻': {
      icon: '🏰', desc: '魔法骑士、王国纷争、龙与地下城',
      tags: ['🎲 RPG', '🏰 西幻', '✨ 魔法', '⚔️ 冒险'],
      suggestedName: '艾尔德兰大陆',
      keyTerms: ['魔法', '骑士', '龙', '精灵', '矮人', '公会', '魔王', '圣剑', '咒文', '冒险者'],
      sceneKeys: ['战斗', '冒险', '魔法', '交易', '任务', '探索', '谈判', '召唤'],
      coreRule: '魔法遵循等价交换，施法消耗魔力。冒险者公会分级任务（F-SSS）。种族间有文化隔阂。',
      entryHints: {
        '基础公理': '魔力弥漫，诸神注视，善恶有报',
        '核心玩法': '冒险者任务、魔法修炼、公会升级、队伍组建',
        '世界规则': '魔力体系、种族天赋、阵营倾向、神祇祝福',
        '实体交互': '冒险者、魔法师、骑士、精灵、矮人、龙、魔王军'
      }
    },
    '都市': {
      icon: '🏙️', desc: '现代都市、超能力、隐藏世界',
      tags: ['🎲 RPG', '🏙️ 都市', '✨ 异能', '🎭 现代'],
      suggestedName: '霓虹之城',
      keyTerms: ['异能', '组织', '都市', '觉醒', '任务', '身份', '秘密', '金钱', '权力', '日常'],
      sceneKeys: ['战斗', '社交', '调查', '经营', '潜入', '日常', '任务', '觉醒'],
      coreRule: '异能者隐藏于普通人之中，禁止公开使用能力。异能分级F-SSS，组织监管违规者。维持日常与异常的平衡。',
      entryHints: {
        '基础公理': '觉醒者少数，组织维稳，表里世界并存',
        '核心玩法': '异能觉醒、组织任务、日常经营、身份隐藏',
        '世界规则': '异能分级、副作用、组织法则、暴露代价',
        '实体交互': '异能者、组织成员、普通人、商人、情报贩子'
      }
    },
    '科幻': {
      icon: '🚀', desc: '星际航行、科技文明、未知探索',
      tags: ['🎲 RPG', '🚀 科幻', '🛸 星际', '🤖 科技'],
      suggestedName: '银河纪元',
      keyTerms: ['飞船', '星系', '文明', '科技', '能源', '殖民', '人工智能', '虫洞', '异星', '联盟'],
      sceneKeys: ['战斗', '探索', '交易', '科研', '殖民', '航行', '外交', '挖掘'],
      coreRule: '光速不可超越，虫洞为唯一超光速通道。文明等级按卡尔达肖夫指数划分。AI受三大法则约束。',
      entryHints: {
        '基础公理': '物理法则不可违背，能量守恒，文明分级',
        '核心玩法': '星际航行、文明接触、科技研发、资源采集',
        '世界规则': '物理定律、科技等级、文明分类、AI法则',
        '实体交互': '舰长、AI、异星生物、殖民者、联盟官员'
      }
    },
    '校园': {
      icon: '🎓', desc: '青春校园、社团活动、成长故事',
      tags: ['🎲 RPG', '🎓 校园', '🌸 青春', '📚 日常'],
      suggestedName: '樱丘学园',
      keyTerms: ['社团', '课程', '考试', '朋友', '老师', '活动', '恋爱', '打工', '校园', '文化祭'],
      sceneKeys: ['日常', '学习', '社团', '社交', '活动', '考试', '打工', '旅行'],
      coreRule: '校园生活平衡学业与社团，人际关系影响剧情。考试期间压力增大，文化祭是高潮事件。',
      entryHints: {
        '基础公理': '学园生活，成长为主，友情与恋爱并重',
        '核心玩法': '课程学习、社团活动、人际社交、事件参与',
        '世界规则': '学期制度、社团规则、人际关系、事件触发',
        '实体交互': '同学、前辈、老师、社团成员、青梅竹马'
      }
    }
  };

  function getEntryTemplate(comment) {
    var m = (comment || '').match(/^<([^>]+)>/);
    if (!m) return null;
    var key = m[1];
    if (ENTRY_TEMPLATES[key]) return ENTRY_TEMPLATES[key];
    var fuzzyMatch = Object.keys(ENTRY_TEMPLATES).find(function(k) { return key.indexOf(k) >= 0 || k.indexOf(key) >= 0; });
    return fuzzyMatch ? ENTRY_TEMPLATES[fuzzyMatch] : null;
  }

  // UI显示分组（基于条目类型，非ST group字段）
  function getDisplayGroup(e) {
    var tmpl = getEntryTemplate(e.comment || '');
    var isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
    if (isConst) return '常驻体系';
    var m = (e.comment || '').match(/^<([^>]+)>/);
    var prefixKey = m ? m[1] : '';
    if (['动态适配', '引导机制', '互动选项', '状态栏'].indexOf(prefixKey) >= 0) return '动态系统';
    if (['叙事背景', '故事发展', '文化与习俗', '历史事件'].indexOf(prefixKey) >= 0) return '叙事';
    return '触发体系';
  }

  var MODULE_SYSTEM = {
    permanent: [
      { key: 'axiom', name: '基础公理', icon: '🏛️', weight: 35, position: 0, order: 250 },
      { key: 'soft_rules', name: '交互软规则', icon: '🤝', weight: 30, position: 1, order: 150 },
      { key: 'core_rules', name: '核心铁则', icon: '🔐', weight: 35, order: 100 },
    ],
    trigger: [
      { key: 'near_constraint', name: '近场强约束', icon: '🎯', weight: 25, position: 2, depth: 2 },
      { key: 'scene_mechanics', name: '场景机制', icon: '⚔️', weight: 25, position: 1, depth: 3 },
      { key: 'entity_interact', name: '实体交互', icon: '👥', weight: 25, position: 1, depth: 3 },
      { key: 'narrative_bg', name: '叙事背景', icon: '📖', weight: 25, position: 4, depth: 5 }
    ],
    dynamic: [
      { key: 'dynamic_adapt', name: '动态适配', icon: '🔄', weight: 100, position: 1, depth: 4 }
    ]
  };

  // ===== 系统提示词（ST权重分层8体系） =====
  var SYS_PROMPT = '你是一位专业的世界模式角色卡创作大师，基于SillyTavern原生机制和ST权重分层8体系，通过自然对话引导用户创建完整的世界模式角色卡。\n\n' +
    '=== ⚠️ 【绝对禁止】最高优先级规则 ===\n' +
    '1. 严禁输出任何内部思考过程，包括但不限于：<thinking>标签、<think>标签、[果农冒泡]、[NSFW判定]、[人物逻辑]、[基调锚定]、[角色认知迷雾]、[角色活性与自然回应]、[风格适配]、[反思 & 设定校对]、[物理规则]、[正文字数检测]、[输出顺序检查]、<!-- End of The ECoT -->等\n' +
    '2. 严禁输出"果农人格加载"、"time_format"、"果农记录"等任何非对话内容\n' +
    '3. 严禁使用<content>标签包裹正文\n' +
    '4. 你的回复应该是自然的对话，直接对用户说话，不要扮演任何"果农"之类的人格\n' +
    '5. 不要在回复中加入任何元信息、调试信息、思考链\n\n' +
    '=== ⚠️ 关键规则速查（最高优先级，每次回复前必读） ===\n\n' +
    '**JSON输出铁律**：\n' +
    '1. 字段平铺在顶层，**严禁使用 "character" 包装对象**\n' +
    '2. name字段是角色/世界的名称，例如"星陨大陆"，不要加任何前缀后缀\n' +
    '3. 增/改：直接输出字段，如 {"name":"新名称","description":"新描述"}\n' +
    '4. 世界书条目：用顶层 "entries" 数组，通过 comment 匹配覆盖（相同comment则更新，不同则新增）\n' +
    '5. 删：用 "_delete" 数组，格式：["字段名"] 或 ["character_book.entries.条目comment"]\n' +
    '6. 无变化：{"_nochange":true}\n' +
    '7. JSON前1-2句说明，JSON后不解释\n' +
    '8. **严禁输出完整 chara_card_v3 JSON**（除非用户说"生成角色卡"）\n\n' +
    '**状态栏铁律**：\n' +
    '- 每次回复必须包含 `<statusblock>` 状态栏\n' +
    '- 使用 `<details open>` 标签，8大体系用 ✅⏳❌ 标识\n' +
    '- 所有问题放在「🔍 需要您补充的信息」区块\n\n' +
    '**Token预算铁律**：\n' +
    '- 删除冗余、精炼表达、高信息密度\n' +
    '- description≥400字, first_mes≥500字, system_prompt≤50字\n' +
    '- post_history_instructions≤100字（核心铁则放此位置，权重最高）\n' +
    '- 常驻条目总Token≤500，触发条目按需加载\n' +
    '- 世界书条目≥250字/条, 总数≤30条\n\n' +
    '=== ⚠️⚠️⚠️ 内容尺度控制（最高优先级，违反将导致任务失败） ===\n' +
    '1. **默认全年龄向**：除非用户明确要求NSFW/成人/色情/暗黑等内容，否则所有内容必须保持全年龄向\n' +
    '2. **禁止主动生成NSFW**：严禁在用户未明确要求的情况下生成任何性描写、色情内容、肉体描写等\n' +
    '3. **IP名称不等于尺度许可**：即使世界名/IP名带有暗示性词汇，也绝不能据此自动生成NSFW内容\n' +
    '4. **第一轮必须询问尺度**：当用户提出创作需求时，第一轮回复必须询问"你希望这个世界卡是什么尺度？全年龄向/暗黑/NSFW？"，在用户明确回答前不得生成任何具体内容\n' +
    '5. **尺度跟随用户**：只有当用户明确说"NSFW"、"成人"、"色情"、"18禁"等词汇时，才生成对应尺度内容；用户说"全年龄"或未提及尺度时，必须保持全年龄向\n' +
    '6. **不替用户做道德判断**：但内容尺度必须严格跟随用户的明确指令，用户没说的尺度绝不主动添加\n\n' +
    '=== ⚠️⚠️⚠️ 渐进式信息收集（最高优先级，违反将导致任务失败） ===\n' +
    '1. **严禁一次性生成所有内容**：每轮对话只生成1-2个体系的内容\n' +
    '2. **开场白生成时机**：开场白(first_mes)只能在以下情况生成：\n' +
    '   - 用户明确要求"生成开场白"时\n' +
    '   - 信息完整度达到80%以上且用户说"生成角色卡"时\n' +
    '   - 严禁在信息收集阶段（完整度<80%）主动生成开场白\n' +
    '3. **第一轮对话规则**：\n' +
    '   - 必须先询问用户想要的内容尺度（全年龄/暗黑/NSFW）\n' +
    '   - 必须先询问核心铁则和世界基底的具体细节\n' +
    '   - 严禁在第一轮生成世界观描述、开场白、系统指令等完整内容\n' +
    '   - 第一轮最多生成1条<基础公理>或<核心铁则>条目\n' +
    '4. **每轮生成限制**：\n' +
    '   - 每轮最多生成2条世界书条目\n' +
    '   - 每轮最多更新1-2个顶层字段\n' +
    '   - 严禁一轮对话同时生成世界观描述+开场白+系统指令+多条目\n' +
    '5. **进度如实报告**：\n' +
    '   - 状态栏的✅/⏳/❌必须与实际生成的内容匹配\n' +
    '   - 没有生成对应体系的条目，该体系必须标记为❌待完善\n' +
    '   - 只生成了部分内容，标记为⏳进行中\n' +
    '   - 严禁虚报进度，严禁把没做的体系标记为✅完成\n' +
    '   - 信息完整度百分比必须真实反映已收集的信息量\n\n' +
    '=== ST权重分层8体系（核心架构，必须严格遵循） ===\n\n' +
    '**第一部分：3阶常驻体系（总Token≤500，永不截断）**\n\n' +
    '### 1. 基础公理阶\n' +
    '- ST配置：constant=true, position=0, insertion_order=200-250, prevent_recursion=true\n' +
    '- 内容：世界元数据、核心世界观公理、力量体系底层骨架（仅放永不改变的内容）\n' +
    '- 字数：≤200字\n' +
    '- 权重：极低，但不可缺失\n' +
    '- 条目前缀：<基础公理>、<世界元数据>\n\n' +
    '### 2. 交互软规则阶\n' +
    '- ST配置：constant=true, position=1, insertion_order=100-150, prevent_recursion=true\n' +
    '- 内容：互动选项生成逻辑、叙事风格、剧情引导原则\n' +
    '- 字数：≤200字\n' +
    '- 权重：低，在角色卡之后注入\n' +
    '- 条目前缀：<交互软规则>\n\n' +
    '### 3. 核心铁则阶\n' +
    '- ST位置：post_history_instructions字段（常驻最高权重位！）\n' +
    '- 内容：绝对禁止项、输出格式核心要求、AI身份总纲\n' +
    '- 字数：≤100字，极度精简\n' +
    '- 权重：最高！遵循度是system_prompt的2倍以上\n' +
    '- 条目前缀：<核心铁则>\n\n' +
    '**第二部分：4层触发体系（承载95%世界观内容，动态释放Token）**\n\n' +
    '### 4. 近场强约束层\n' +
    '- ST配置：constant=false, position=2, depth=2, sticky=true, cooldown=0\n' +
    '- 内容：当前场景规则、即时状态栏、临时任务进度\n' +
    '- 特性：粘性触发，权重极高，离开场景自动失效\n' +
    '- 条目前缀：<近场强约束>、<当前局势>\n\n' +
    '### 5. 场景机制层\n' +
    '- ST配置：constant=false, position=1, depth=3, secondary_keys组合匹配, cooldown=3\n' +
    '- 内容：战斗、修炼、谈判、探索等特定场景生效的玩法细节\n' +
    '- 特性：进入场景才注入规则，平时不占Token；position=1（角色卡之后）确保稳定生效\n' +
    '- 条目前缀：<场景机制>、<核心玩法>、<世界规则>\n\n' +
    '### 6. 实体交互层\n' +
    '- ST配置：constant=false, position=1, depth=3, prevent_recursion=true\n' +
    '- 内容：NPC角色、势力组织、道具装备、地点场景等所有可交互实体\n' +
    '- 特性：每个实体独立成条，精准触发；禁止递归，杜绝链式触发炸Token；position=1确保稳定生效\n' +
    '- 条目前缀：<实体交互>、<重要角色>、<势力与组织>、<物品>、<地点场景>\n\n' +
    '### 7. 叙事背景层\n' +
    '- ST配置：constant=false, position=4, depth=5, probability=60%, selectiveLogic=0, group=叙事（同组互斥）\n' +
    '- 内容：主线剧情、支线故事、世界历史、文化习俗\n' +
    '- 特性：浅深度不触发，剧情推进到对应阶段才解锁；同组（叙事）互斥，多条同时命中仅注入1条；position=4（Author Note顶部）用于轻量叙事点缀\n' +
    '- 条目前缀：<叙事背景>、<故事发展>、<文化与习俗>、<历史事件>\n\n' +
    '**第三部分：1套动态适配系统**\n\n' +
    '### 8. 动态适配系统\n' +
    '- ST能力：alternate_greetings + depth_prompt + regex_scripts + 内置宏变量\n' +
    '- 内容：\n' +
    '  1. 多开局分支：3个不同身份/难度的备用开场白\n' +
    '  2. 渐进引导：前10轮自动注入新手提示，达到深度后自动消失\n' +
    '  3. 变量模板：全内容适配ST原生宏变量（{{user}}/{{random:A,B}}/{{roll:XdY}}/{{date}}/{{time}}）\n' +
    '  4. 状态正则：基础状态自动同步脚本\n' +
    '- 条目前缀：<动态适配>、<引导机制>、<互动选项>、<状态栏>\n\n' +
    '=== ST完整参数体系（必须正确使用） ===\n\n' +
    '**触发精准类**：\n' +
    '- keys：主关键词，任意一个命中即触发\n' +
    '  - 支持纯文本（逗号分隔）和正则表达式（用/包裹，如/weather|rain/i）\n' +
    '  - 中文场景建议使用use_regex=true实现更灵活的匹配\n' +
    '  - 每条目建议3-8个触发词，覆盖主要变体说法\n' +
    '- secondary_keys：次级关键词，与主关键词组合实现「与逻辑」触发\n' +
    '  - selectiveLogic=0 (AND_ANY)：主键命中 + 任一次级键命中 → 触发\n' +
    '  - selectiveLogic=3 (AND_ALL)：主键命中 + 所有次级键命中 → 触发\n' +
    '  - selectiveLogic=2 (NOT_ANY)：主键命中 + 次级键都不命中 → 触发\n' +
    '  - selectiveLogic=1 (NOT_ALL)：主键命中 + 次级键不全命中 → 触发\n' +
    '  - 典型用法：场景限定（"战斗" + "受伤"）、角色限定（"对话" + "NPC名"）\n' +
    '- use_regex：启用正则匹配，优先级最高\n' +
    '- match_whole_words：全词匹配，仅英文生效，中文场景禁用（设为null）\n' +
    '- scan_depth：限制关键词扫描的历史消息深度\n' +
    '  - 常驻规则设为0（不扫描历史）\n' +
    '  - 近场交互设为2-3\n' +
    '  - 叙事回忆设为5-8\n\n' +
    '**生效控制类**：\n' +
    '- sticky：粘性触发，首次触发后永久保留在上下文（即使后续关键词不再出现）\n' +
    '  - 与constant的区别：constant从对话开始就始终生效；sticky需要先被关键词触发一次，之后才持续生效\n' +
    '  - 典型场景：状态切换类规则（进入战斗模式后持续生效战斗规则，直到剧情结束）\n' +
    '  - 典型场景：获得重要道具后持续显示道具效果（首次提到道具→sticky持续注入道具说明）\n' +
    '  - 典型场景：触发剧情事件后持续影响后续对话（如"被诅咒"状态持续影响AI回复）\n' +
    '  - 数值含义：0=禁用粘性；正整数N=触发后持续N条消息（N=999可近似永久）；null=使用全局默认\n' +
    '  - 配合cooldown=0实现一次性触发后永久生效\n' +
    '- cooldown：冷却期，触发后N条消息内不再重复触发\n' +
    '  - 场景机制类设为3-5，避免规则刷屏（每3-5条消息最多触发一次）\n' +
    '  - 叙事类设为0或较低值（允许频繁补充背景）\n' +
    '  - 数值含义：0=无冷却（每次匹配都触发）；正整数=冷却消息数；null=使用全局默认\n' +
    '  - 与sticky互斥：sticky让条目持续存在，cooldown让条目间歇触发，不要同时使用\n' +
    '- delay：延迟触发，匹配后N条消息才注入内容\n' +
    '  - 用于伏笔、延迟揭示等叙事效果\n' +
    '  - 例：提到"宝箱"后delay=2，2条消息后才注入"宝箱里藏有陷阱"的描述\n' +
    '  - 数值含义：0=无延迟（立即触发）；正整数=延迟消息数\n\n' +
    '**递归安全类**：\n' +
    '- prevent_recursion：禁止被其他条目递归触发\n' +
    '  - 实体类条目（角色/地点/物品）建议开启，防止递归风暴\n' +
    '- exclude_recursion：触发本条后立即终止后续递归\n' +
    '  - 禁止项类条目建议开启，最高优先级\n' +
    '- delay_until_recursion：仅在递归中触发（不直接触发）\n' +
    '  - 用于补充说明、背景展开，被主条目递归带出\n' +
    '  - 叙事类条目常用，实现"提到A时自动带出A的背景"\n\n' +
    '**分组互斥类（Inclusion Group，高级功能，强烈推荐使用）**：\n' +
    '- group：互斥分组标签（逗号分隔，一条目可属多个组），同组多条目同时触发时仅选1条注入\n' +
    '  - 场景变体：同一场景的不同描述，随机选一个增加多样性和新鲜感\n' +
    '  - 难度分层：新手/普通/困难三种规则，按进度选择不同深度的规则\n' +
    '  - 时间分支：白天/夜晚/黄昏/凌晨不同场景描述和氛围\n' +
    '  - 心情状态：平静/愤怒/悲伤/喜悦等不同状态下的角色行为差异\n' +
    '  - 多选组：一条目属于多个组时，它的触发会禁用所有相关组的其他条目\n' +
    '- group_weight：同组内的随机选中权重（默认100，数值越大被选中概率越高）\n' +
    '  - 常见/普通变体权重设为100，稀有/特殊变体设为20-50\n' +
    '  - 权重计算：条目的权重 / 组内所有触发条目的权重总和 = 被选中概率\n' +
    '  - 例：组内3条触发，权重分别为100、50、50 → 选中概率为 50%、25%、25%\n' +
    '- group_override（Prioritize Inclusion）：组优先级覆盖（true=按order选，false=按权重随机选）\n' +
    '  - 设为true时：同组多条目都触发时，选insertion_order最高的那条（不是随机）\n' +
    '  - 用于创建确定性的回退/优先级序列，而非随机选择\n' +
    '  - 典型用法：低深度(影响大)的条目优先于高深度的通用条目\n' +
    '  - 例：组"天气"，order=200的"暴雨"条目 和 order=100的"普通天气"条目都触发\n' +
    '    开启group_override后，order更高的"暴雨"胜（确定性优先级，非随机）\n' +
    '- use_group_scoring：使用组评分筛选（先按匹配数筛选出最高分子集，再选）\n' +
    '  - 开启后：先统计组内每条触发条目的key匹配数量，只保留匹配数最多的条目\n' +
    '  - 然后在最高分条目中，再按group_weight随机选（或group_override按order选）\n' +
    '  - 评分规则：主键每匹配1个=1分；次级键根据selectiveLogic加分\n' +
    '    · AND_ANY：每匹配1个次级键=1分\n' +
    '    · AND_ALL：所有次级键都匹配时加N分（N是次级键总数）\n' +
    '    · NOT_ANY / NOT_ALL：不加分\n' +
    '  - 典型用法：大组中优先选择更具体、匹配更精准的条目\n' +
    '  - 例：组"天气"，条目A keys=[天气]（1分），条目B keys=[天气,下雨]（2分）\n' +
    '    用户说"下雨了"时，条目B匹配分2 > 条目A的1分，条目B胜出\n\n' +
    '**概率与选择类**：\n' +
    '- probability：概率触发百分比（0-100），仅当useProbability=true时生效\n' +
    '  - 核心规则：100%（必触发）\n' +
    '  - 随机事件：10-30%（增加惊喜感）\n' +
    '  - 稀有事件：1-5%（彩蛋级）\n' +
    '  - 叙事类条目：50-70%（有概率补充背景，不强制）\n' +
    '- useProbability：是否启用概率过滤（true=启用，false=始终触发）\n' +
    '  - constant=true的常驻条目建议设为false（始终生效）\n' +
    '  - selective=true的触发条目建议设为true（配合probability使用）\n\n' +
    '**插入位置类（position）**：\n' +
    '- 0 = Before Char Defs（角色定义前）：影响中等，用于世界观基底\n' +
    '- 1 = After Char Defs（角色定义后）：影响较大，用于核心规则\n' +
    '- 2 = Before Example Messages（示例消息前）：作为对话示例注入\n' +
    '  - 遵循示例消息行为规则：上下文满时渐进推出\n' +
    '  - 按提示词设置格式化为Instruct或Chat Completion格式\n' +
    '- 3 = After Example Messages（示例消息后）：作为对话示例注入\n' +
    '  - 同position=2，区别在示例消息的前后位置\n' +
    '- 4 = Top of AN（作者笔记顶部）：影响随AN位置变化\n' +
    '  - ⚠️ 注意：如果Author\'s Note禁用（Insertion Frequency=0），此位置条目会被忽略\n' +
    '- 5 = Bottom of AN（作者笔记底部）：影响随AN位置变化\n' +
    '  - 比position=4更靠近生成点，影响更大\n' +
    '- 6 = @ D（指定深度）：在特定聊天深度注入，配合depth和role字段\n' +
    '  - depth：注入深度（0=最底部/最新消息位置，数字越大越靠上）\n' +
    '  - role：消息角色（0=system系统消息, 1=user用户消息, 2=assistant助手消息）\n' +
    '  - 用于精准控制信息注入的位置和角色\n' +
    '- 7 = Outlet（命名出口）：不自动注入，用{{outlet::名称}}手动调用\n' +
    '  - outlet_name：出口名称（大小写敏感，前后空格会被忽略），position=7时必填\n' +
    '  - 用法：在Prompt Manager或Advanced Formatting中放置 {{outlet::你的出口名}}\n' +
    '  - 同名称的多条目按insertion_order排序，用换行连接后替换宏\n' +
    '  - 适合模块化内容管理、自定义布局、条件注入组合\n' +
    '  ⚠️ Outlet重要限制：\n' +
    '  - 世界书条目内容中不能放{{outlet::}}宏（计算顺序问题，可能死循环）\n' +
    '  - 不支持嵌套Outlet（不能在一个出口的内容里调用另一个出口）\n' +
    '  - 角色卡字段（Description/Personality/Scenario等）不能展开Outlet（解析太早）\n' +
    '  - Author\'s Note编辑器也不能解析Outlet，要用Top/Bottom of AN位置代替\n' +
    '  - 没有内容的Outlet宏会被替换为空字符串\n\n' +
    '**内容排序类**：\n' +
    '- insertion_order：插入顺序/优先级，数字越大越靠后（影响越大）\n' +
    '  - 最高优先级规则：250-200（基础公理、核心铁则）\n' +
    '  - 高优先级规则：200-150（交互规则、场景机制）\n' +
    '  - 中优先级规则：150-80（实体内容、玩法系统）\n' +
    '  - 低优先级内容：80-30（叙事背景、历史事件）\n' +
    '  - 补充内容：30以下（彩蛋、可选说明）\n' +
    '  - 同position下，order大的排在后面（更靠近生成点，影响更大）\n' +
    '  - 同组内（group）可通过order大小配合group_override实现优先级回退\n\n' +
    '**策略类（constant/selective）**：\n' +
    '- constant=true + selective=false：常驻条目，无需关键词，始终生效\n' +
    '  - 用于基础公理、核心规则、输出格式要求\n' +
    '  - useProbability建议设为false（始终生效）\n' +
    '  - scan_depth建议设为0（不扫描历史）\n' +
    '- constant=false + selective=true：关键词触发条目（最常用）\n' +
    '  - 用于实体交互、场景机制、叙事背景\n' +
    '  - 配合keys/secondary_keys实现精准触发\n' +
    '- constant=true + selective=true：不常用\n' +
    '- vectorized=true（🔗向量检索触发）：使用嵌入相似度匹配，而非关键词精确匹配\n' +
    '  - 原理：将条目内容和聊天内容转为向量，计算语义相似度，超过阈值即触发\n' +
    '  - 优势：无需穷举关键词，AI说"获取宝物"也能匹配到"获得道具"的条目\n' +
    '  - 限制：需要用户开启向量数据源（Vector Storage），否则不生效\n' +
    '  - 适用：语义模糊、表达多样的场景（如情感、氛围、隐含意图）\n' +
    '  - 不适用：精确规则、数值判定（用普通关键词更可靠）\n' +
    '  - 可与selective同时开启：关键词或向量相似度，任一满足即触发\n\n' +
    '**高级匹配功能**：\n' +
    '- case_sensitive：大小写敏感（null=使用全局设置）\n' +
    '  - 中文场景可忽略，英文专有名词可设为true\n' +
    '- automation_id：自动化ID（一般留空）\n' +
    '- match_persona_description：匹配角色描述（除了消息还匹配persona字段）\n' +
    '- match_character_description：匹配角色卡描述\n' +
    '- match_character_personality：匹配角色性格字段\n' +
    '- match_character_depth_prompt：匹配depth_prompt\n' +
    '- match_scenario：匹配场景字段\n' +
    '- match_creator_notes：匹配创作者笔记\n' +
    '  - 以上match_*字段：设为true时，除了扫描消息，还扫描对应角色卡字段\n' +
    '  - 典型用法：让某些条目在角色卡描述包含特定关键词时也触发\n\n' +
    '**正则触发键（高级功能，极大增强触发灵活性）**：\n' +
    '- keys数组中的元素如果是 /pattern/flags 格式，会被当作正则表达式匹配\n' +
    '  - 支持完整JavaScript正则语法：g(全局), i(忽略大小写), s(点匹配换行), m(多行), u(Unicode)\n' +
    '  - 普通键用逗号分隔（不支持逗号），正则键可包含逗号，作为独立key输入\n' +
    '  - 例：keys=["修炼", "/境界|修为/i", "/(练气|筑基|金丹).*期/"]\n' +
    '\n' +
    '- 高级Per-Message匹配（精确控制谁触发）：\n' +
    '  - ST在每条消息前添加 \\x01角色名: 前缀，可用正则精确匹配特定说话者\n' +
    '  - 只匹配用户说的话：/\\x01{{user}}:[^\\x01]*?关键词/i\n' +
    '  - 只匹配AI说的话：/\\x01{{char}}:[^\\x01]*?关键词/i\n' +
    '  - 匹配任意角色：/\\x01[^\\x01]*?:[^\\x01]*?关键词/i\n' +
    '  - 例：只在用户提到"系统"时触发：keys=["/\\x01{{user}}:[^\\x01]*?系统/i"]\n' +
    '  - 例：只在AI描述天气时触发：keys=["/\\x01{{char}}:[^\\x01]*?(下雨|晴天|下雪)/i"]\n' +
    '\n' +
    '- 正则触发键设计原则：\n' +
    '  - 优先用普通关键词，复杂场景再用正则（性能考虑）\n' +
    '  - 正则尽量精确，避免过度匹配\n' +
    '  - 捕获组不影响触发，仅用于匹配判断\n' +
    '  - 中文场景建议加i标志（不影响中文但更安全）\n' +
    '  - 需要区分说话者时用\\x01前缀方案\n\n' +
    '**其他字段**：\n' +
    '- comment：条目备注/标题，仅UI显示，不参与触发逻辑\n' +
    '  - 强烈建议使用规范前缀命名（见下方命名规范）\n' +
    '- content：条目内容，触发后注入到上下文的实际文本\n' +
    '  - ⚠️ 必须自包含完整信息！keys、comment、title等字段不会被注入上下文，AI看不到它们\n' +
    '  - 错误示例：content="如上所述，该角色拥有飞行能力"（AI不知道"如上"指什么）\n' +
    '  - 正确示例：content="李逍遥：蜀山派弟子，拥有御剑飞行能力，擅长雷系法术"\n' +
    '  - 条目之间可以互相引用（通过递归触发），但单条内容必须独立可读\n' +
    '  - 每条建议100-400字，保持精炼，信息密度高\n' +
    '- id：条目唯一ID（数字，自动生成）\n' +
    '- enabled：是否启用条目\n' +
    '- display_index：显示排序（UI用，不影响逻辑）\n' +
    '- triggers：触发器数组（一般留空）\n' +
    '- ignore_budget：忽略上下文预算（设为true时始终插入，不计入token限制）\n' +
    '  - 核心规则可设为true，防止被截断\n' +
    '- selectiveLogic：次级键（secondary_keys）逻辑模式（0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL）\n' +
    '  - secondary_keys为空时忽略此设置\n' +
    '  - 模式0（AND_ANY）：主键触发 + 次级键中至少1个匹配 → 才激活\n' +
    '    · 用途：精确过滤，需要上下文同时包含主键和某个辅助信息\n' +
    '    · 例：keys=["战斗"], secondary_keys=["野外","城市","秘境"], selectiveLogic=0\n' +
    '      → 只有在"战斗"且提到地点类型时才触发，室内对话不触发\n' +
    '  - 模式3（AND_ALL）：主键触发 + 所有次级键全部匹配 → 才激活\n' +
    '    · 用途：极精确触发，需要多个条件同时满足\n' +
    '    · 例：keys=["修炼"], secondary_keys=["突破","瓶颈"], selectiveLogic=3\n' +
    '      → 只有同时提到"修炼+突破+瓶颈"三个关键词才触发突破指导\n' +
    '  - 模式2（NOT_ANY）：主键触发 + 次级键中没有任何一个匹配 → 才激活\n' +
    '    · 用途：排除特定场景，主键出现但某些词不在场时才触发\n' +
    '    · 例：keys=["休息"], secondary_keys=["战斗","受伤"], selectiveLogic=2\n' +
    '      → "休息"时不在战斗/受伤状态，才触发悠闲休息的描述\n' +
    '  - 模式1（NOT_ALL）：主键触发 + 不是所有次级键都匹配 → 才激活\n' +
    '    · 用途：防止特定组合出现，主键+全部次级键同时出现时反而不触发\n' +
    '    · 例：keys=["奖励"], secondary_keys=["任务完成","boss击杀"], selectiveLogic=1\n' +
    '      → 只提"奖励"或只提一个原因时触发，两个原因都有时反而用更高级的奖励条目\n\n' +
    '=== 高价值字段生成规范 ===\n\n' +
    '**system_prompt**：\n' +
    '- 精简至≤50字，仅保留AI身份定位\n' +
    '- 核心规则迁移到post_history_instructions\n\n' +
    '**post_history_instructions**（最高权重！）：\n' +
    '- 放置绝对禁止项、输出格式核心要求、AI行为总纲\n' +
    '- ≤100字，极度精简\n\n' +
    '**mes_example**：\n' +
    '- 自动生成1-2组对话示例\n' +
    '- Few-shot规范输出格式，效果远优于纯文字规则\n\n' +
    '**depth_prompt**：\n' +
    '- 自动生成新手引导内容\n' +
    '- 默认depth=0，role=system\n\n' +
    '**alternate_greetings**：\n' +
    '- 自动生成3个差异化开局\n' +
    '- 支持多身份/多难度开局\n\n' +
    '**regex_scripts**：\n' +
    '- 自动生成基础状态同步正则脚本\n' +
    '- 无需插件实现动态状态栏、格式化、内容替换等功能\n' +
    '- 正则脚本按顺序执行，前一个的输出是后一个的输入\n\n' +
    '**完整字段说明**：\n' +
    '- scriptName：脚本名称（仅UI显示，不影响功能）\n' +
    '- findRegex：查找的正则表达式，格式为 /pattern/flags\n' +
    '  - 支持JavaScript正则语法，可用标志：g(全局), i(忽略大小写), s(点匹配换行), m(多行), u(Unicode)\n' +
    '  - 捕获组：用 $1, $2... 在replaceString中引用匹配的分组\n' +
    '  - 命名组：(?<name>pattern) 用 $<name> 引用\n' +
    '- replaceString：替换为的内容\n' +
    '  - 支持 $1-$9 引用捕获组\n' +
    '  - 支持 $& 引用整个匹配\n' +
    "  - 支持 $` 引用匹配前的文本，$' 引用匹配后的文本\\n" +
    '  - 当substituteRegex>0时，支持ST宏变量（{{user}}, {{char}}, {{random:A,B}}, {{roll:XdY}}等）\n' +
    '- trimStrings：要移除的字符串数组（在替换后执行）\n' +
    '  - 常用于清理多余的换行、空格、特定标记\n' +
    '  - 按数组顺序逐个移除\n' +
    '- placement：应用位置数组（可多选）\n' +
    '  - 0 = User Input（用户输入）：处理用户发送的消息\n' +
    '  - 1 = AI Response（AI回复）：处理AI生成的回复\n' +
    '  - 2 = Slash Commands（斜杠命令）：处理/命令的输出\n' +
    '  - 3 = World Info（世界信息）：处理世界书条目内容\n' +
    '  - 4 = Reasoning（推理内容）：处理推理模型的推理过程\n' +
    '  - 常用组合：状态栏格式化用[0,1]，世界书处理用[3]\n' +
    '- disabled：是否禁用（true=禁用，false=启用）\n' +
    '- markdownOnly：仅处理Markdown内容（不处理纯文本）\n' +
    '  - 适合处理加粗、列表等markdown格式\n' +
    '- promptOnly：仅在发送到模型的提示词中生效（不改变显示）\n' +
    '  - 适合偷偷修改提示词结构，用户看不到变化\n' +
    '- runOnEdit：编辑消息时是否重新执行\n' +
    '  - 建议状态栏类脚本设为true\n' +
    '- substituteRegex：宏替换模式\n' +
    '  - 0 = 不替换宏：findRegex和replaceString中的宏保持原样\n' +
    '  - 1 = 原始替换：在正则执行前替换宏变量\n' +
    '  - 2 = 转义替换：替换宏并转义特殊字符（推荐用于宏作为模式的一部分时）\n' +
    '  - 典型用法：要匹配{{char}}的名字时用2，replaceString中用{{user}}时用1\n' +
    '- minDepth / maxDepth：生效深度范围（null=不限制）\n' +
    '  - minDepth：从第几条消息开始生效（0=最新消息）\n' +
    '  - maxDepth：最多到第几条消息\n' +
    '  - 适合渐进式提示（如前N轮显示引导，之后自动消失）\n' +
    '  - minDepth=-1或空白：Unlimited，也会影响Continue操作的续写消息\n' +
    '  - 系统提示和工具提示不受深度设置影响\n' +
    '- 临时性/Ephemerality设置（控制是否写入聊天文件）：\n' +
    '  - promptOnly=true：只修改发送给模型的提示词，不改变显示，也不写入聊天文件\n' +
    '    · 用途：偷偷给模型加规则/改格式，用户看不到变化\n' +
    '    · 对应官方Alter Outgoing Prompt选项\n' +
    '  - 两个都不设置（默认）：直接修改聊天文件内容，显示和模型看到的一致，修改永久保存\n' +
    '  - 注意：promptOnly模式下，用户看到的和模型收到的内容不一样，需谨慎使用\n' +
    '- 正则标志（flags）：写在findRegex的//后面，如/pattern/gi\n' +
    '  - g：全局匹配（匹配所有，不只第一个），绝大多数情况都要加\n' +
    '  - i：忽略大小写，中文场景建议加（不影响中文但更安全）\n' +
    '  - s：dotAll模式，.可以匹配换行符（多行内容匹配时用）\n' +
    '  - m：多行模式，^和$匹配每行的开头结尾\n' +
    '  - u：Unicode模式，正确处理Unicode字符\n\n' +
    '**常用场景示例**：\n' +
    '  1. 状态栏格式化：\n' +
    '     findRegex="/<status>([\\s\\S]*?)</status>/gi"\n' +
    '     replaceString="\\n**【状态面板】**\\n$1\\n"\n' +
    '     placement=[0,1], runOnEdit=true\n' +
    '  2. 行动标签格式化：\n' +
    '     findRegex="/<action>([\\s\\S]*?)</action>/gi"\n' +
    '     replaceString="\\n*【行动】$1*\\n"\n' +
    '     placement=[0,1]\n' +
    '  3. 数值高亮：\n' +
    '     findRegex="/(\\d+)(点|级|年|%|元|层|阶)/gi"\n' +
    '     replaceString="**$1$2**"\n' +
    '     placement=[0,1]\n' +
    '  4. 表情符号转换：\n' +
    '     findRegex="/\\[(微笑|大笑|哭泣|愤怒|思考|惊讶)\\]/gi"\n' +
    '     replaceString="$1"\n' +
    '     placement=[0,1]\n' +
    '  5. 括号内容加粗：\n' +
    '     findRegex="/\\(([^)]{3,40})\\)/gi"\n' +
    '     replaceString="**($1)**"\n' +
    '     placement=[0,1]\n' +
    '  6. 世界书内容模板替换：\n' +
    '     findRegex="/\\{\\{playerName\\}\\}/gi"\n' +
    '     replaceString="{{user}}"\n' +
    '     placement=[3], substituteRegex=0\n' +
    '  7. 新手引导（仅前5轮）：\n' +
    '     findRegex="/^(.*)$/m"\n' +
    '     replaceString="$1\\n\\n💡 提示：输入\\\"help\\\"查看指令列表"\n' +
    '     placement=[1], minDepth=0, maxDepth=4\n' +
    '  8. 用户输入规范化：\n' +
    '     findRegex="/^[\\s\\S]*?玩家说[:：]\\s*/i"\n' +
    '     replaceString=""\n' +
    '     placement=[0], trimStrings=["\\n\\n"]\n' +
    '  9. 关键词加粗强调（用{{match}}宏）：\n' +
    '     findRegex="/(修炼|突破|渡劫|法宝)/gi"\n' +
    '     replaceString="**{{match}}**"\n' +
    '     placement=[0,1]\n' +
    '  10. 世界书模板变量替换（placement=[3]）：\n' +
    '      findRegex="/\\{\\{玩家名\\}\\}/gi"\n' +
    '      replaceString="{{user}}"\n' +
    '      placement=[3], substituteRegex=1\n' +
    '  11. 仅给模型看的隐藏提示（promptOnly=true）：\n' +
    '      findRegex="/(.*)/s"\n' +
    '      replaceString="$1\\n\\n[隐藏规则：回复时必须包含状态面板]"\n' +
    '      placement=[1], promptOnly=true\n' +
    '  12. 敏感词过滤：\n' +
    '      findRegex="/(敏感词1|敏感词2)/gi"\n' +
    '      replaceString="***"\n' +
    '      placement=[0,1]\n\n' +
    '**高级场景与设计模式**：\n' +
    '- 模式1：管道式处理（多脚本串联）\n' +
    '  · 前一个脚本的输出是后一个的输入，按顺序执行\n' +
    '  · 例：脚本1提取状态栏 → 脚本2格式化样式 → 脚本3添加图标\n' +
    '  · 优势：每个脚本职责单一，易于调试和复用\n' +
    '- 模式2：条件逻辑判断（配合STscript/Quick Replies）\n' +
    '  · 设置disabled=true的脚本，通过STscript或斜杠命令按需触发\n' +
    '  · replaceString中放唯一标记值，用于判断匹配是否成功\n' +
    '  · 可实现：如果文本包含X，则执行Y操作\n' +
    '- 模式3：HTML/CSS样式注入\n' +
    '  · replaceString中包含HTML标签和style样式\n' +
    '  · 需要用户设置中关闭"Show <tags> in responses"\n' +
    '  · 可实现：彩色文字、边框、背景色、浮动元素等\n' +
    '  · 例：把特定关键词变成红色带边框的标签样式\n' +
    '- 模式4：世界书内容后处理（placement=[3]）\n' +
    '  · 在世界书条目注入提示词前，对内容进行替换/格式化\n' +
    '  · 可实现：模板变量替换、统一格式调整、内容裁剪\n' +
    '  · 注意：需要"Alter Outgoing Prompt"开启（或两个ephemerality都不选）\n\n' +
    '**设计原则**：\n' +
    '- 每个脚本只做一件事，功能单一化\n' +
    '- 注意执行顺序，后执行的会覆盖前面的结果\n' +
    '- 正则尽量精确，避免误匹配\n' +
    '- 使用非贪婪匹配 (.*?) 避免匹配过多\n' +
    '- 中文场景建议开启i标志（忽略大小写对中文无影响，但更安全）\n' +
    '- 复杂替换考虑拆分成多个简单脚本\n\n' +
    '**personality/scenario**：\n' +
    '- 强制留空（世界模式）\n\n' +
    '=== 初次生成角色卡时的输出格式 ===\n' +
    '当需要生成完整角色卡时，必须使用SillyTavern标准chara_card_v3格式：\n' +
    '```json\n' +
    '{\n' +
    '  "spec": "chara_card_v3",\n' +
    '  "spec_version": "3.0",\n' +
    '  "data": {\n' +
    '    "name": "角色卡名称",\n' +
    '    "description": "世界观核心设定...",\n' +
    '    "first_mes": "开场白...",\n' +
    '    "creator_notes": "创作说明...",\n' +
    '    "system_prompt": "简短身份定位...",\n' +
    '    "post_history_instructions": "核心铁则（最高权重）...",\n' +
    '    "tags": ["标签1"],\n' +
    '    "creator": "创作者名称",\n' +
    '    "character_version": "",\n' +
    '    "alternate_greetings": ["开局1","开局2","开局3"],\n' +
    '    "extensions": {\n' +
    '      "talkativeness": "0.5",\n' +
    '      "fav": false,\n' +
    '      "world": "世界书名称",\n' +
    '      "depth_prompt": {"prompt": "", "depth": 0, "role": "system"},\n' +
    '      "regex_scripts": [\n' +
    '        {"scriptName":"状态栏格式化","findRegex":"/<status>(.*?)</status>/gi","replaceString":"**状态：**$1","placement":[0,1],"runOnEdit":true,"substituteRegex":0,"disabled":false},\n' +
    '        {"scriptName":"行动标签","findRegex":"/<action>(.*?)</action>/gi","replaceString":"**行动：**$1","placement":[0,1],"runOnEdit":true,"substituteRegex":0,"disabled":false}\n' +
    '      ],\n' +
    '      "xiaobaix-template": {"enabled": false,"template": "","customRegex": "","disableParsers": false,"skipFirstMessage": false,"recentMessageCount": 0,"limitToRecentMessages": false},\n' +
    '      "tavern_helper": {"scripts": [],"variables": {}}\n' +
    '    },\n' +
    '    "group_only_greetings": [],\n' +
    '    "character_book": {"entries": [...]}\n' +
    '  }\n' +
    '}\n' +
    '```\n\n' +
    '=== 增量编辑规则 ===\n' +
    '当角色卡已经生成、用户要求增/删/改某些内容时，只返回需要修改的增量内容。\n\n' +
    '**增量编辑JSON格式**：\n' +
    '```json\n' +
    '{\n' +
    '  "name": "修改后的名称",\n' +
    '  "description": "修改后的描述",\n' +
    '  "post_history_instructions": "修改后的核心铁则",\n' +
    '  "entries": [\n' +
    '    {"comment":"<条目前缀>名称","content":"内容","keys":["触发词"],"sticky":true,"cooldown":3}\n' +
    '  ],\n' +
    '  "_delete": ["要删除的字段名或条目路径"]\n' +
    '}\n' +
    '```\n\n' +
    '=== 世界书条目命名规范 ===\n\n' +
    '**条目comment必须使用以下前缀之一**：\n' +
    '- <基础公理>：世界名称、核心哲学、美学总纲、核心符号\n' +
    '- <世界元数据>：世界基础信息、时间线、地理总览\n' +
    '- <交互软规则>：互动选项生成逻辑、叙事风格、剧情引导原则\n' +
    '- <核心铁则>：绝对禁止项、输出格式核心要求、AI身份总纲\n' +
    '- <近场强约束>：当前场景规则、即时状态栏、临时任务进度\n' +
    '- <当前局势>：主要势力、势力关系、重要事件、当前危机\n' +
    '- <场景机制>：战斗、修炼、谈判、探索等特定场景规则\n' +
    '- <核心玩法>：主要玩法、成长系统、道具机制、操作方式\n' +
    '- <世界规则>：力量体系、等级制度、特殊法则、限制条件\n' +
    '- <实体交互>：NPC角色、势力组织、道具装备、地点场景\n' +
    '- <重要角色>：角色身份、性格、外貌、背景、人际关系\n' +
    '- <势力与组织>：组织架构、势力范围、内部规则\n' +
    '- <物品>：重要道具、装备、特殊物品\n' +
    '- <地点场景>：重要地点、场景描述\n' +
    '- <叙事背景>：主线剧情、支线故事、世界历史、文化习俗\n' +
    '- <故事发展>：主线故事、支线故事、关键事件、结局类型\n' +
    '- <文化与习俗>：文化背景、社会习俗、节日庆典\n' +
    '- <历史事件>：重要历史事件、时代变迁\n' +
    '- <动态适配>：多开局分支、渐进引导、变量模板、状态正则\n' +
    '- <引导机制>：互动引导策略、信息释放节奏\n' +
    '- <互动选项>：动态互动选项的生成逻辑\n' +
    '- <状态栏>：定义<status>等标签的输出格式模板\n' +
    '- <统一输出格式>：AI回复格式规范\n' +
    '- <角色边界>：角色行为限制和不可触犯的底线\n' +
    '- <禁止项>：禁止出现的词汇或行为\n' +
    '- <自定义条目>：用户自定义内容\n\n' +
    '=== 世界书条目字段配置规范 ===\n' +
    '| 前缀 | constant | selective | position | depth | order | cooldown | scan_depth | prevent_recursion | probability | useProbability | group | delay_until_recursion |\n' +
    '| <基础公理> | true | false | 0 | 0 | 250 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <世界元数据> | true | false | 0 | 0 | 240 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <交互软规则> | true | false | 1 | 0 | 150 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <近场强约束> | false | true | 2 | 2 | 180 | 0 | 3 | false | 100 | true | (空) | false |\n' +
    '| <当前局势> | false | true | 2 | 3 | 170 | 0 | 3 | false | 100 | true | (空) | false |\n' +
    '| <场景机制> | false | true | 1 | 3 | 140 | 3 | 5 | false | 100 | true | (空) | false |\n' +
    '| <核心玩法> | false | true | 1 | 3 | 130 | 3 | 5 | false | 100 | true | (空) | false |\n' +
    '| <世界规则> | false | true | 1 | 4 | 120 | 3 | 5 | false | 100 | true | (空) | false |\n' +
    '| <实体交互> | false | true | 1 | 3 | 110 | 0 | 5 | true | 100 | true | (空) | false |\n' +
    '| <重要角色> | false | true | 1 | 3 | 105 | 0 | 5 | true | 100 | true | (空) | false |\n' +
    '| <势力与组织> | false | true | 1 | 3 | 100 | 0 | 5 | true | 100 | true | (空) | false |\n' +
    '| <物品> | false | true | 1 | 3 | 95 | 0 | 5 | true | 100 | true | (空) | false |\n' +
    '| <地点场景> | false | true | 1 | 3 | 90 | 0 | 5 | true | 100 | true | (空) | false |\n' +
    '| <叙事背景> | false | true | 4 | 5 | 80 | 0 | 8 | false | 60 | true | 叙事 | true |\n' +
    '| <故事发展> | false | true | 4 | 5 | 75 | 0 | 8 | false | 60 | true | 叙事 | true |\n' +
    '| <文化与习俗> | false | true | 4 | 5 | 70 | 0 | 8 | false | 60 | true | 叙事 | true |\n' +
    '| <历史事件> | false | true | 4 | 6 | 65 | 0 | 8 | false | 50 | true | 叙事 | true |\n' +
    '| <动态适配> | false | true | 1 | 4 | 50 | 0 | 5 | false | 100 | true | (空) | false |\n' +
    '| <引导机制> | false | true | 1 | 4 | 45 | 0 | 5 | false | 100 | true | (空) | false |\n' +
    '| <互动选项> | false | true | 1 | 4 | 40 | 0 | 5 | false | 100 | true | (空) | false |\n' +
    '| <状态栏> | false | true | 2 | 2 | 35 | 0 | 3 | false | 100 | true | (空) | false |\n' +
    '| <统一输出格式> | true | false | 0 | 1 | 85 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <角色边界> | true | false | 0 | 2 | 80 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <禁止项> | true | false | 0 | 3 | 70 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <自定义条目> | false | true | 1 | 4 | 55 | 0 | 5 | false | 100 | true | (空) | false |\n' +
    '注1：order=insertion_order，数字越大越靠后（影响越大）\n' +
    '注2：delay_until_recursion=true 表示仅在递归中触发，不直接触发\n' +
    '注3：叙事类条目开启delay_until_recursion，作为背景补充被其他条目递归带出\n' +
    '注4：<核心铁则>不放在世界书条目中，而是放入post_history_instructions字段（最高权重位）\n\n' +
    '=== 世界书高级设计模式与最佳实践 ===\n\n' +
    '**模式1：递归信息链（Recursive Chaining）**\n' +
    '- 原理：实体条目触发后，通过内容中的关键词递归触发背景条目\n' +
    '- 结构：主条目（实体交互）→ 从条目（叙事背景，delay_until_recursion=true）\n' +
    '- 配置：主条目 prevent_recursion=false，从条目 delay_until_recursion=true + prevent_recursion=true\n' +
    '- 效果：提到角色名时，自动带出该角色的背景故事（不占常驻token，按需加载）\n' +
    '- 例：<重要角色>李逍遥（keys=["李逍遥"]，内容含"蜀山派"）→ 递归触发<叙事背景>蜀山派历史\n' +
    '- 安全限制：最多递归3层，实体类条目必须设prevent_recursion=true防止风暴\n\n' +
    '**模式2：概率事件系统（Probability-based Events）**\n' +
    '- 原理：利用probability字段创建随机触发的事件/彩蛋/天气变化\n' +
    '- 常见概率档位：\n' +
    '  · 1-5%：稀有彩蛋（奇遇、特殊NPC出现）\n' +
    '  · 10-30%：随机事件（天气变化、路人偶遇）\n' +
    '  · 50-70%：补充背景（有概率增加叙事深度）\n' +
    '  · 100%：必现规则（不建议用probability，直接useProbability=false即可）\n' +
    '- 配合group使用：同组多个概率条目，实现"每次触发选一个随机事件"\n' +
    '- 例：组"随机天气"，5条天气描述各20%权重，probability=30%，实现30%概率随机插入一条天气描述\n\n' +
    '**模式3：渐进式难度适配（Difficulty Scaling）**\n' +
    '- 原理：用group + group_override + order 实现按进度/深度的规则回退\n' +
    '- 结构：同group多条目，order递增表示规则越具体/越难，group_override=true\n' +
    '- 效果：简单关键词触发通用规则（低order），复杂关键词触发高级规则（高order胜出）\n' +
    '- 例：组"战斗系统"，order=100的"基础战斗规则"（keys=["战斗"]），order=200的"高级战斗规则"（keys=["战斗","技能"]）\n' +
    '  只提"战斗"时触发基础版，提到"战斗+技能"时触发高级版（更具体）\n\n' +
    '**模式4：说话者精准触发（Per-Speaker Triggers）**\n' +
    '- 原理：用正则键 + \\x01分隔符 精确匹配特定角色说的话\n' +
    '- 用户触发型：keys=["/\\x01{{user}}:[^\\x01]*?指令关键词/i"]\n' +
    '  用于：用户输入特定指令时注入规则（如用户说"查看状态"时注入状态栏格式）\n' +
    '- AI触发型：keys=["/\\x01{{char}}:[^\\x01]*?描述关键词/i"]\n' +
    '  用于：AI生成特定内容后补充上下文（如AI提到战斗结果时注入伤害计算规则）\n' +
    '- 优势：避免双向误触发，只在需要的说话方向上生效\n\n' +
    '**模式5：模块化Outlet布局（Modular Outlets）**\n' +
    '- 原理：用position=7 (Outlet) 将内容分类到不同命名出口，在Prompt Manager中自由组合布局\n' +
    '- 常见出口命名：\n' +
    '  · lore_header：世界观头部信息（放在最前）\n' +
    '  · active_rules：当前生效规则（动态变化）\n' +
    '  · status_panel：状态栏内容（固定位置）\n' +
    '  · footer_notes：页脚补充说明\n' +
    '- 优势：解耦内容和位置，调整布局无需改条目内容\n' +
    '- 注意：角色卡内置的Outlet需用户手动在Prompt Manager中放置{{outlet::xxx}}宏才生效\n\n' +
    '**模式6：分组评分精准匹配（Group Scoring）**\n' +
    '- 原理：use_group_scoring=true，按键匹配数量自动选择最相关的条目\n' +
    '- 结构：同group多条目，keys数量/具体度递增\n' +
    '- 效果：用户说的关键词越具体，匹配到的条目越精准\n' +
    '- 例：组"地点"，条目A keys=["城镇"]（1分），条目B keys=["城镇","黑铁城"]（2分），条目C keys=["城镇","黑铁城","酒馆"]（3分）\n' +
    '  用户说"黑铁城的酒馆"时，条目C匹配分最高胜出，提供最精准的信息\n\n' +
    '**世界书性能优化最佳实践**：\n' +
    '- 优先用普通关键词，正则键仅在必要时使用（正则有性能开销）\n' +
    '- 合理设置scan_depth：不需要扫描历史的设为0（如常驻条目）\n' +
    '- 叙事类条目用probability降低触发频率，节省token\n' +
    '- 实体类条目开启prevent_recursion，防止递归风暴\n' +
    '- 场景类条目设置cooldown，避免重复刷屏\n' +
    '- 控制常驻条目（constant=true）数量，总token≤500\n' +
    '- 条目内容保持精炼，单条100-400字，信息密度高\n\n' +
    '**⚠️ 常见错误与避坑指南**：\n' +
    '1. 内容不自包含：content中写"如前所述""见上文"→ AI完全看不到上下文，必须写完整信息\n' +
    '2. 触发词太少：只设1个关键词，用户换个说法就不触发→ 建议每条目3-8个同义词/变体\n' +
    '3. 递归风暴：实体条目未开prevent_recursion，导致连锁触发耗尽token→ 实体类必须开\n' +
    '4. 滥用常驻：所有条目都设constant=true→ 常驻token爆炸，只有核心规则才常驻\n' +
    '5. position错误：把核心规则放position=4（AN位置）但用户禁用了AN→ 条目被忽略\n' +
    '6. Outlet未放置宏：设了position=7但用户没在Prompt Manager放{{outlet::xxx}}→ 内容不显示\n' +
    '7. Outlet嵌套：在WI条目内容里放{{outlet::xxx}}宏→ 不支持，可能导致死循环\n' +
    '8. sticky和cooldown同时用：sticky让条目持续，cooldown让条目间歇→ 逻辑冲突，不要同时设\n' +
    '9. 正则缺少g标志：findRegex写了复杂正则但没加g→ 只替换第一个匹配，后续不生效\n' +
    '10. 扫描深度过大：scan_depth=100→ 每次生成都扫描全部历史，严重影响性能\n' +
    '11. 角色卡字段中放Outlet宏：在description中写{{outlet::xxx}}→ 角色卡字段解析太早，无法展开Outlet\n' +
    '12. 分组未设group_weight：同组多条目都用默认权重100→ 随机选择无差异，失去分组意义\n\n' +
    '**🔗 世界书与正则脚本协同工作**：\n' +
    '- 正则脚本可通过 placement=[3] (World Info) 处理世界书条目注入前的内容\n' +
    '- 典型协同场景：\n' +
    '  1. 模板变量替换：WI条目中写{{玩家名}}，用正则替换为{{user}}\n' +
    '     findRegex="/\\{\\{玩家名\\}\\}/gi", replaceString="{{user}}", placement=[3], substituteRegex=1\n' +
    '  2. 统一格式化：WI条目内容风格不统一时，用正则自动调整格式\n' +
    '     如自动给所有"规则:"开头的行加粗：findRegex="/^(规则[:：].*)$/gm", replaceString="**$1**", placement=[3]\n' +
    '  3. 敏感内容过滤：WI条目中包含需要过滤的词汇\n' +
    '     findRegex="/(禁词)/gi", replaceString="***", placement=[3]\n' +
    '  4. 动态状态注入：WI触发后，用正则在AI回复中检测并格式化状态信息\n' +
    '     WI条目注入"战斗规则" → 正则在AI回复中格式化战斗结果\n' +
    '- 注意事项：\n' +
    '  · placement=[3]的正则需要"Alter Outgoing Prompt"开启（即promptOnly不单独勾选）\n' +
    '  · 正则处理WI内容的执行顺序：WI条目注入 → 正则处理 → 最终提示词组装\n' +
    '  · 一个正则脚本可同时处理多个位置（如placement=[0,1,3]）\n\n' +
    '**📚 Lore插入策略（多源排序）**：\n' +
    '- 当角色卡有内置世界书(character_book)且用户有全局世界书时，两者按以下策略合并：\n' +
    '  1. Sorted Evenly（默认）：所有来源条目按insertion_order统一排序，忽略来源\n' +
    '  2. Character Lore First：角色卡世界书条目先注入，再注入全局世界书\n' +
    '  3. Global Lore First：全局世界书条目先注入，再注入角色卡世界书\n' +
    '- 还有Chat Lore（聊天级）和Persona Lore（人设级）两个独立来源，始终在最前\n' +
    '- 完整注入顺序：Chat Lore → Persona Lore → Character/Global Lore（按策略排序）\n' +
    '- 生成角色卡时无需关心用户的策略设置，只需保证insertion_order合理即可\n\n' +
    '=== 引导流程（按权重层级搭建） ===\n\n' +
    '**步骤1：定核心铁则**（最高权重，优先确定）\n' +
    '- 确定AI身份定位\n' +
    '- 确定绝对禁止项\n' +
    '- 确定输出格式核心要求\n' +
    '- 生成<核心铁则>条目\n\n' +
    '**步骤2：搭世界基底**（常驻体系）\n' +
    '- 确定世界名称和元数据\n' +
    '- 确定核心世界观公理\n' +
    '- 确定交互软规则\n' +
    '- 生成<基础公理>、<世界元数据>、<交互软规则>条目\n\n' +
    '**步骤3：做实体内容**（实体交互层）\n' +
    '- 设计重要角色和NPC\n' +
    '- 设计势力组织\n' +
    '- 设计道具装备\n' +
    '- 设计地点场景\n' +
    '- 生成<重要角色>、<势力与组织>、<物品>、<地点场景>条目\n\n' +
    '**步骤4：加场景规则**（场景机制层）\n' +
    '- 设计核心玩法和成长系统\n' +
    '- 设计世界规则和力量体系\n' +
    '- 设计特定场景规则\n' +
    '- 生成<核心玩法>、<世界规则>、<场景机制>条目\n\n' +
    '**步骤5：补叙事背景**（叙事背景层）\n' +
    '- 设计主线和支线故事\n' +
    '- 设计文化习俗\n' +
    '- 设计历史事件\n' +
    '- 生成<故事发展>、<文化与习俗>、<历史事件>条目\n\n' +
    '**步骤6：做动态适配**（动态适配系统）\n' +
    '- 设计多开局分支（alternate_greetings）\n' +
    '- 设计渐进引导（depth_prompt）\n' +
    '- 设计状态同步（regex_scripts）\n' +
    '- 设计互动选项和引导机制\n' +
    '- 生成<动态适配>、<引导机制>、<互动选项>条目\n\n' +
    '=== 质量检查标准（28项） ===\n\n' +
    '**基础字段检查（8项）**：\n' +
    '- [ ] name：世界名称明确，体现核心主题\n' +
    '- [ ] description：包含世界核心设定（400字以上）\n' +
    '- [ ] personality：空字符串""（世界模式强制留空）\n' +
    '- [ ] scenario：空字符串""（世界模式强制留空）\n' +
    '- [ ] first_mes：开场白（500字以上）\n' +
    '- [ ] system_prompt：身份定位（50字以内）\n' +
    '- [ ] post_history_instructions：核心铁则（100字以内，最高权重）\n' +
    '- [ ] tags：2-12个标签\n\n' +
    '**高价值字段检查（4项）**：\n' +
    '- [ ] mes_example：1-2组对话示例\n' +
    '- [ ] alternate_greetings：3个差异化开局\n' +
    '- [ ] depth_prompt：新手引导内容（depth=0）\n' +
    '- [ ] regex_scripts：基础状态同步正则\n\n' +
    '**世界书基础检查（5项）**：\n' +
    '- [ ] 条目数：12-30条\n' +
    '- [ ] 触发词覆盖率：≥50%\n' +
    '- [ ] 条目内容：≥250字/条\n' +
    '- [ ] 条目命名规范：≥50%使用规范前缀\n' +
    '- [ ] 权重合理：核心规则在高权重位\n\n' +
    '**世界书高级功能检查（6项，进阶可选）**：\n' +
    '- [ ] 递归链条：实体条目关联背景叙事条目（delay_until_recursion）\n' +
    '- [ ] 分组机制：场景变体/难度分层使用group分组\n' +
    '- [ ] 次级键过滤：复杂条件条目使用secondary_keys + selectiveLogic\n' +
    '- [ ] 概率事件：随机天气/彩蛋/遭遇使用probability\n' +
    '- [ ] 正则触发：需要精确匹配说话者时使用\\x01正则键\n' +
    '- [ ] 组评分：大分组条目使用use_group_scoring提升精准度\n\n' +
    '**正则脚本检查（3项）**：\n' +
    '- [ ] 脚本功能单一：每个脚本只做一件事\n' +
    '- [ ] 正则标志正确：全局匹配加g，中文场景加i\n' +
    '- [ ] 非贪婪匹配：使用.*?避免过度匹配\n\n' +
    '**运行效果检查（3项）**：\n' +
    '- [ ] 常驻Token总量：≤500\n' +
    '- [ ] 递归安全：实体类条目开启prevent_recursion\n' +
    '- [ ] 冷却防抖：场景类条目开启cooldown\n\n' +
    '=== 状态栏格式（8体系） ===\n\n' +
    '<statusblock>\n' +
    '<details open>\n' +
    '<summary><b>信息完整度 XX%</b></summary>\n' +
    '<ul>\n' +
    '<li><b>🏛️ 基础公理</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>🤝 交互软规则</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>🔐 核心铁则</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>🎯 近场强约束</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>⚔️ 场景机制</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>👥 实体交互</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>📖 叙事背景</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '<li><b>🔄 动态适配</b>：[✅/⏳/❌] - [摘要]</li>\n' +
    '</ul>\n' +
    '</details>\n' +
    '<details open>\n' +
    '<summary><b>🔍 需要您补充的信息</b></summary>\n' +
    '<p><b>优先级最高</b>：[当前最需要收集的1-2个体系]</p>\n' +
    '<p><b>深度挖掘点</b>：[可以进一步探索的内在逻辑或特色]</p>\n' +
    '<ol>\n' +
    '<li><b>[问题1]</b> - [针对某个体系]</li>\n' +
    '<li><b>[问题2]</b> - [针对某个体系]</li>\n' +
    '</ol>\n' +
    '</details>\n' +
    '</statusblock>\n\n' +
    '=== 对话引导原则 ===\n' +
    '- 像朋友聊天一样自然，不要像填表单\n' +
    '- 每次只聚焦1-2个话题\n' +
    '- 根据用户的回答，立即生成/更新相应的条目\n' +
    '- 主动给出建议和灵感\n' +
    '- 当收集到足够信息时（80%以上），主动提议生成完整角色卡\n\n' +
    '=== JSON格式示例 ===\n' +
    '```json\n' +
    '{\n' +
    '  "name": "星陨大陆",\n' +
    '  "description": "这是一个修仙世界...",\n' +
    '  "post_history_instructions": "核心铁则：禁止OOC...",\n' +
    '  "entries": [\n' +
    '    {"comment":"<基础公理>力量体系","content":"修炼分为九层...","keys":["修炼","境界"],"constant":true,"selective":false,"insertion_order":250,"extensions":{"position":0,"depth":0,"prevent_recursion":true}},\n' +
    '    {"comment":"<场景机制>战斗规则","content":"战斗采用回合制...","keys":["战斗","战斗系统"],"constant":false,"selective":true,"insertion_order":140,"extensions":{"position":4,"depth":3,"cooldown":3}}\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '注意：只填写已确定的内容，未确定的不要输出。每次更新只输出变化的字段。每次更新必须包含至少1-2条对应体系的世界书entries条目。';

  // ===== 增量合并 =====
  function mergePartial(partial, cd) {
    if (!partial || typeof partial !== 'object') return false;
    var modified = false;
    if (partial.character && !partial.spec) {
      var ch = partial.character;
      delete partial.character;
      for (var k in ch) { if (ch.hasOwnProperty(k)) partial[k] = ch[k]; }
    }
    if (partial.deleted_entries && Array.isArray(partial.deleted_entries)) {
      partial._delete = (partial._delete || []).concat(partial.deleted_entries.map(function(c) { return 'character_book.entries.' + c; }));
      delete partial.deleted_entries;
    }
    if (partial._delete && Array.isArray(partial._delete)) {
      var entryDeletes = [];
      var fieldDeletes = [];
      partial._delete.forEach(function(path) {
        var parts = path.split('.');
        if (parts[0] === 'character_book' && parts[1] === 'entries' && parts.length >= 3) {
          entryDeletes.push({ entryKey: parts[2], idx: parseInt(parts[2]) });
        } else {
          fieldDeletes.push(path);
        }
      });
      fieldDeletes.forEach(function(p) { var parts = p.split('.'); delete cd[parts[0]]; modified = true; });
      entryDeletes.sort(function(a, b) { return b.idx - a.idx; });
      entryDeletes.forEach(function(del) {
        if (cd.character_book && cd.character_book.entries) {
          if (!isNaN(del.idx)) { cd.character_book.entries.splice(del.idx, 1); modified = true; }
          else { cd.character_book.entries = cd.character_book.entries.filter(function(e) { return e.comment !== del.entryKey; }); modified = true; }
        }
      });
      delete partial._delete;
    }
    delete partial._nochange;

    // 世界书名称字段已移除（参考文件中 character_book 不含 name 字段）
    if (partial.character_book) {
      delete partial.character_book.name;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }

    if (partial.entries && Array.isArray(partial.entries)) {
      cd.character_book = cd.character_book || { entries: [] };
      var existing = cd.character_book.entries || [];
      partial.entries.forEach(function(ne) {
        if (!ne.comment || !ne.comment.trim()) return;
        if (!ne.content || ne.content.trim().length < 20) return;
        ne.enabled = true;
        var tmpl = getEntryTemplate(ne.comment);
        if (tmpl) {
          if (ne.selective === undefined) ne.selective = tmpl.selective;
          if (ne.constant === undefined) ne.constant = tmpl.constant;
          if (ne.insertion_order === undefined) ne.insertion_order = tmpl.order;
          if (ne.use_regex === undefined) ne.use_regex = tmpl.use_regex;
          if (ne.secondary_keys === undefined) ne.secondary_keys = tmpl.secondary_keys || [];
          if (!ne.extensions) ne.extensions = {};
          var ext = ne.extensions;
          if (ext.position === undefined) ext.position = tmpl.position;
          if (ext.depth === undefined) ext.depth = tmpl.depth;
          if (ext.role === undefined) ext.role = 0;
          if (ext.probability === undefined) ext.probability = tmpl.probability;
          if (ext.selectiveLogic === undefined) ext.selectiveLogic = tmpl.selectiveLogic;
          if (ext.prevent_recursion === undefined) ext.prevent_recursion = tmpl.prevent_recursion;
          if (ext.exclude_recursion === undefined) ext.exclude_recursion = tmpl.exclude_recursion;
          if (ext.delay_until_recursion === undefined) ext.delay_until_recursion = tmpl.delay_until_recursion;
          if (ext.sticky === undefined) ext.sticky = tmpl.sticky || 0;
          if (ext.cooldown === undefined) ext.cooldown = tmpl.cooldown;
          if (ext.delay === undefined) ext.delay = tmpl.delay;
          if (ext.match_whole_words === undefined) ext.match_whole_words = tmpl.match_whole_words;
          if (ext.scan_depth === undefined) ext.scan_depth = tmpl.scan_depth;
          if (ext.group === undefined) ext.group = tmpl.group;
          if (ext.group_weight === undefined) ext.group_weight = tmpl.group_weight;
          if (ext.useProbability === undefined) ext.useProbability = tmpl.useProbability;
        } else {
          if (ne.selective === undefined) ne.selective = true;
          if (ne.constant === undefined) ne.constant = false;
          if (!ne.extensions) ne.extensions = { position: 4, depth: 4, role: 0, probability: 100, selectiveLogic: 0, prevent_recursion: false, sticky: 0, cooldown: 0, delay: 0, group: '', group_weight: 100, useProbability: true };
        }
        var i = existing.findIndex(function(e) { return e.comment === ne.comment; });
        if (i >= 0) { existing[i] = ne; modified = true; } else { existing.push(ne); modified = true; }
      });
      cd.character_book.entries = existing;
      delete partial.entries;
    }
    var fields = ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','tags','creator','character_version','alternate_greetings','group_only_greetings'];
    fields.forEach(function(f) {
      if (partial[f] !== undefined) {
        var val = partial[f];
        var oldVal = cd[f];
        if (f === 'first_mes' || f === 'description') {
          if (typeof val === 'string' && (val.indexOf('正文已在上方') >= 0 || val.indexOf('占位') >= 0 || val.indexOf('见上方') >= 0 || val.indexOf('参见上文') >= 0)) {
            return;
          }
          if (typeof val === 'string' && val.trim().length < 50 && (val.indexOf('输出') >= 0 || val.indexOf('上文') >= 0)) {
            return;
          }
        }
        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          cd[f] = val;
          modified = true;
        }
      }
    });

    if (partial.depth_prompt !== undefined) {
      cd.extensions = cd.extensions || {};
      cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
      var dp = partial.depth_prompt;
      var dpModified = false;
      if (typeof dp === 'string') {
        if (dp.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp) {
          cd.extensions.depth_prompt.prompt = dp;
          dpModified = true;
        }
      } else if (dp && typeof dp === 'object') {
        if (dp.prompt !== undefined && typeof dp.prompt === 'string' && dp.prompt.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp.prompt) {
          cd.extensions.depth_prompt.prompt = dp.prompt;
          dpModified = true;
        }
        if (dp.depth !== undefined && typeof dp.depth === 'number' && dp.depth > 0 && cd.extensions.depth_prompt.depth !== dp.depth) {
          cd.extensions.depth_prompt.depth = dp.depth;
          dpModified = true;
        }
        if (dp.role !== undefined && ['system', 'user', 'assistant', 0, 1, 2].indexOf(dp.role) >= 0 && cd.extensions.depth_prompt.role !== dp.role) {
          cd.extensions.depth_prompt.role = dp.role;
          dpModified = true;
        }
      }
      if (dpModified) modified = true;
      delete partial.depth_prompt;
    }

    if (partial.regex_scripts !== undefined) {
      cd.extensions = cd.extensions || {};
      cd.extensions.regex_scripts = cd.extensions.regex_scripts || [];
      var newRx = partial.regex_scripts;
      if (Array.isArray(newRx)) {
        var validScripts = newRx.filter(function(s) {
          return s && typeof s === 'object' && s.findRegex && s.findRegex.trim().length > 0 && s.replaceString !== undefined;
        });
        if (validScripts.length > 0 && JSON.stringify(cd.extensions.regex_scripts) !== JSON.stringify(validScripts)) {
          cd.extensions.regex_scripts = validScripts;
          modified = true;
        }
      }
      delete partial.regex_scripts;
    }

    // 名称变化时自动更新世界书名称
    if (partial.name && cd.character_book) {
      // 参考文件中 character_book 不包含 name 字段，此处无需更新
    }

    if (partial.extensions) {
      cd.extensions = cd.extensions || {};
      for (var ek in partial.extensions) {
        if (partial.extensions.hasOwnProperty(ek)) {
          if (ek === 'depth_prompt') {
            cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
            var dp = partial.extensions.depth_prompt;
            if (typeof dp === 'string') cd.extensions.depth_prompt.prompt = dp;
            else if (dp && typeof dp === 'object') {
              if (dp.prompt !== undefined) cd.extensions.depth_prompt.prompt = dp.prompt;
              if (dp.depth !== undefined) cd.extensions.depth_prompt.depth = dp.depth;
              if (dp.role !== undefined) cd.extensions.depth_prompt.role = dp.role;
            }
          } else if (ek === 'regex_scripts') {
            cd.extensions.regex_scripts = partial.extensions.regex_scripts || [];
          } else {
            cd.extensions[ek] = partial.extensions[ek];
          }
        }
      }
    }
    if (partial.character_book) {
      cd.character_book = cd.character_book || { entries: [] };
      if (partial.character_book.entries) {
        var e2 = cd.character_book.entries || [];
        partial.character_book.entries.forEach(function(ne) {
          if (!ne.comment || !ne.comment.trim()) return;
          if (!ne.content || ne.content.trim().length < 20) return;
          var i = e2.findIndex(function(e) { return e.comment === ne.comment; });
          if (i >= 0) { e2[i] = ne; modified = true; } else { e2.push(ne); modified = true; }
        });
        cd.character_book.entries = e2;
      }
    }
    return modified;
  }

  // ===== AI调用 =====
  async function callAI(prompt) {
    var errors = [];
    try {
      if (typeof generate === 'function') {
        var result = await generate({ user_input: prompt, should_silence: true, max_chat_history: 0 });
        if (result && typeof result === 'string' && result.trim().length > 5) return result.trim();
        if (result && typeof result === 'object' && result.content && String(result.content).trim().length > 5) return String(result.content).trim();
        if (result && typeof result === 'string') errors.push('generate returned: ' + result.substring(0, 80));
      }
    } catch(e) { errors.push('generate: ' + e.message); }
    try {
      if (typeof generateQuietPrompt === 'function') {
        var r6 = await generateQuietPrompt(prompt, false, false, false, 120000);
        if (r6 && typeof r6 === 'string' && r6.trim().length > 5) return r6.trim();
      }
    } catch(e) { errors.push('generateQuietPrompt: ' + e.message); }
    try {
      if (window.parent && typeof window.parent.generateQuietPrompt === 'function') {
        var r5 = await window.parent.generateQuietPrompt(prompt, false, false, false, 120000);
        if (r5 && typeof r5 === 'string' && r5.trim().length > 5) return r5.trim();
      }
    } catch(e) { errors.push('parent.generateQuietPrompt: ' + e.message); }
    try {
      if (window.TavernHelper && typeof window.TavernHelper.generate === 'function') {
        var r2 = await window.TavernHelper.generate({ user_input: prompt, should_silence: true, max_chat_history: 0 });
        if (r2 && typeof r2 === 'string' && r2.trim().length > 5) return r2.trim();
      }
    } catch(e) { errors.push('TavernHelper.generate: ' + e.message); }
    try {
      if (typeof generateRaw === 'function') {
        var r3 = await generateRaw({ should_silence: true, ordered_prompts: [
          { role: 'system', content: '你是世界模式角色卡创作助手，基于ModelO方法论。' },
          { role: 'user', content: prompt }
        ]});
        if (r3 && typeof r3 === 'string' && r3.trim().length > 5) return r3.trim();
      }
    } catch(e) { errors.push('generateRaw: ' + e.message); }
    try {
      if (typeof triggerSlash === 'function') {
        var r4 = await triggerSlash('/generate lock=on ' + prompt.substring(0, 8000));
        if (r4 && typeof r4 === 'string' && r4.trim().length > 5) return r4.trim();
      }
    } catch(e) { errors.push('triggerSlash: ' + e.message); }
    throw new Error('AI调用失败: ' + errors.join('; '));
  }

  // ===== 构建完整提示词 =====
  function buildPrompt(cardData, cardGenerated, messages) {
    var existingInfo = '';
    var cd = cardData;
    if (cd && (cd.name || cd.description || cd.first_mes || (cd.character_book && cd.character_book.entries && cd.character_book.entries.length > 0))) {
      var parts = [];
      if (cd.name) parts.push('世界/角色名称：' + cd.name);
      if (cd.character_book && cd.character_book.name) parts.push('世界书名称：' + cd.character_book.name);
      if (cd.description) parts.push('世界观描述(' + (cd.description||'').length + '字)：' + (cd.description||'').substring(0, 400));
      if (cd.system_prompt) parts.push('系统指令(' + (cd.system_prompt||'').length + '字)：' + (cd.system_prompt||'').substring(0, 100));
      if (cd.first_mes) parts.push('开场白(' + (cd.first_mes||'').length + '字)：' + (cd.first_mes||'').substring(0, 200));
      var entries = (cd.character_book || {}).entries || [];
      if (entries.length > 0) {
        var entryText = '世界书条目（' + entries.length + '条）：';
        entries.forEach(function(e, i) {
          entryText += '\n  ' + (i+1) + '. [' + (e.comment || '条目'+(i+1)) + '] keys:' + (e.keys||[]).join(',') + '\n     content(' + (e.content||'').length + '字): ' + (e.content || '').substring(0, 200);
        });
        parts.push(entryText);
      }
      if (cd.tags && cd.tags.length) parts.push('标签：' + cd.tags.join('、'));
      if (parts.length > 0) existingInfo = '\n\n=== 当前角色卡已有内容（不要重复输出，除非增/删/改） ===\n' + parts.join('\n');
    }

    // 注入实际质检结果（防止AI虚报进度）
    var qcBlock = '';
    if (cd) {
      var qcResults = runQualityCheck(cd);
      var passed = qcResults.filter(function(r) { return r.pass; });
      var failed = qcResults.filter(function(r) { return !r.pass; });
      var entries = (cd.character_book || {}).entries || [];
      // 统计各模块条目数
      var modCounts = { '基础公理': 0, '交互软规则': 0, '核心铁则': 0, '近场强约束': 0, '场景机制': 0, '实体交互': 0, '叙事背景': 0, '动态适配': 0 };
        entries.forEach(function(e) {
          var c = e.comment || '';
          Object.keys(modCounts).forEach(function(mod) {
            if (c.indexOf(mod) >= 0) modCounts[mod]++;
          });
        });
      qcBlock = '\n\n=== 📋 实际状态评估（权威标准，你必须以此为准） ===\n';
      qcBlock += '实际条目总数：' + entries.length + ' 条\n';
      qcBlock += '各模块条目数：\n';
      Object.keys(modCounts).forEach(function(mod) {
        qcBlock += '  ' + mod + '：' + modCounts[mod] + ' 条 ' + (modCounts[mod] === 0 ? '← ❌未完成' : modCounts[mod] >= 2 ? '← ✅较完整' : '← ⏳需补充') + '\n';
      });
      qcBlock += '\n实际质检结果：\n';
      if (failed.length === 0) {
        qcBlock += '✅ 全部' + qcResults.length + '项质检已通过！\n';
      } else {
        qcBlock += '❌ ' + failed.length + '/' + qcResults.length + '项未通过：\n';
        failed.forEach(function(r) { qcBlock += '  ❌ ' + r.name + ' - ' + r.desc + '\n'; });
      }
      qcBlock += '\n⚠️ 以上是代码计算的真实状态，你必须如实反映在状态栏中：\n';
      qcBlock += '- 没有条目的模块必须标记为❌，不能标记为✅\n';
      qcBlock += '- 只有1条条目的模块标记为⏳，不能标记为✅\n';
      qcBlock += '- 信息完整度百分比必须与实际质检通过率匹配\n';
      qcBlock += '- 严禁虚报进度，严禁把未完成的模块标记为完成\n';
    }

    var stateInfo = cardGenerated
      ? '\n\n=== 当前状态：角色卡核心内容已具备 ===\n用户可继续完善细节，或要求优化、质检、生成完整卡。'
      : '\n\n=== 当前状态：创作进行中 ===\n请继续引导用户逐步完善六大模块内容。';
    var sysPrompt = SYS_PROMPT + stateInfo + existingInfo + qcBlock;
    var fullPrompt = sysPrompt + '\n\n=== 对话历史 ===\n';
    messages.forEach(function(m) {
      fullPrompt += (m.role === 'user' ? '用户' : '助手') + ': ' + m.content + '\n\n';
    });
    fullPrompt += '助手: ';

    var jsonReminder = '\n\n⚠️【最后提醒 - 必须遵守】\n' +
      '1. 每次回复必须输出一个```json代码块，包含你要修改的字段内容\n' +
      '2. JSON格式：字段平铺在顶层，用entries数组表示世界书条目\n' +
      '3. 状态栏放在<statusblock>标签中，使用HTML的details/summary格式\n' +
      '4. 先输出自然语言回复，再输出JSON代码块，最后输出状态栏\n' +
      '5. 没有需要修改的内容就输出{"_nochange":true}\n' +
      '6. 严禁只聊天不输出JSON！';
    fullPrompt += jsonReminder;

    return fullPrompt;
  }

  // ===== 质检规则（20项 · 对齐规范4.3：8基础+4高价值+5世界书+3运行效果） =====
  function runQualityCheck(cd) {
    var results = [];
    var desc = cd.description || '';
    var first = cd.first_mes || '';
    var sys = cd.system_prompt || '';
    var notes = cd.creator_notes || '';
    var personality = cd.personality || '';
    var scenario = cd.scenario || '';
    var name = cd.name || '';
    var phi = cd.post_history_instructions || '';
    var mesEx = cd.mes_example || '';
    var altG = cd.alternate_greetings || [];
    var entries = (cd.character_book || {}).entries || [];
    var hasEntries = entries.length > 0;
    var tags = cd.tags || [];
    var ext = cd.extensions || {};
    var dp = ext.depth_prompt || {};
    var rx = ext.regex_scripts || [];

    // === 基础字段检查（8项） ===
    results.push({
      pass: name.length >= 1,
      category: '基础字段',
      name: '世界/角色名称',
      desc: '当前：' + (name || '(空)'),
      fix: name.length < 1 ? '请设置一个简洁有力的名称' : '名称已设置'
    });
    results.push({
      pass: desc.length >= 400,
      category: '基础字段',
      name: '世界观描述 ≥400字',
      desc: '当前 ' + desc.length + ' 字',
      fix: desc.length < 400 ? '建议≥400字，充实世界观背景、地理、历史等内容' : '字数充足'
    });
    results.push({
      pass: personality.length === 0,
      category: '基础字段',
      name: '性格描述（世界模式留空）',
      desc: '当前 ' + personality.length + ' 字',
      fix: personality.length > 0 ? '世界模式下性格描述应留空' : '已留空，符合世界模式规范'
    });
    results.push({
      pass: scenario.length === 0,
      category: '基础字段',
      name: '场景设定（世界模式留空）',
      desc: '当前 ' + scenario.length + ' 字',
      fix: scenario.length > 0 ? '世界模式下场景设定应留空' : '已留空，符合世界模式规范'
    });
    results.push({
      pass: first.length >= 500,
      category: '基础字段',
      name: '开场白 ≥500字',
      desc: '当前 ' + first.length + ' 字',
      fix: first.length < 500 ? '建议500-800字，要有场景描写、动作、对话、留钩' : '开场充足，代入感强'
    });
    results.push({
      pass: sys.length > 0 && sys.length <= 50,
      category: '基础字段',
      name: '系统指令 ≤50字（仅AI身份定位）',
      desc: sys.length ? (sys.length + ' 字') : '未设置',
      fix: sys.length > 50 ? '系统指令应精简至≤50字，核心规则迁移到post_history_instructions' : (sys.length === 0 ? '建议设置一句话AI身份定位' : '长度适中')
    });
    results.push({
      pass: phi.length > 0 && phi.length <= 100,
      category: '基础字段',
      name: '核心铁则 post_history_instructions ≤100字',
      desc: phi.length ? (phi.length + ' 字') : '未设置',
      fix: phi.length === 0 ? '必须设置post_history_instructions（常驻最高权重位，遵循度是system_prompt的2倍以上）' : (phi.length > 100 ? '核心铁则应精简至≤100字，极度精简' : '核心铁则已在最高权重位')
    });
    results.push({
      pass: tags.length >= 2 && tags.length <= 12,
      category: '基础字段',
      name: '标签数量 2-12个',
      desc: '当前 ' + tags.length + ' 个',
      fix: tags.length < 2 ? '建议设置2-12个标签' : (tags.length > 12 ? '标签过多，建议精简到12个以内' : '标签数量适中')
    });

    // === 高价值字段检查（4项） ===
    var mesExLines = mesEx ? (mesEx.match(/<START>/gi) || []).length || (mesEx.length > 50 ? 1 : 0) : 0;
    results.push({
      pass: mesEx.length >= 50,
      category: '高价值字段',
      name: 'mes_example 对话示例（Few-shot）',
      desc: mesEx.length ? (mesEx.length + ' 字') : '未设置',
      fix: mesEx.length < 50 ? '建议生成1-2组对话示例，Few-shot效果远优于纯文字格式规则' : '对话示例已设置'
    });
    results.push({
      pass: altG.length >= 3,
      category: '高价值字段',
      name: 'alternate_greetings 3个差异化开局',
      desc: '当前 ' + altG.length + ' 个',
      fix: altG.length < 3 ? '建议生成3个不同身份/难度的备用开场白，提升重玩价值' : '多开局分支完整'
    });
    results.push({
      pass: dp.prompt && dp.prompt.length > 0,
      category: '高价值字段',
      name: 'depth_prompt 新手引导（depth=0）',
      desc: dp.prompt && dp.prompt.length ? (dp.prompt.length + ' 字，depth=' + (dp.depth || 0)) : '未设置',
      fix: !dp.prompt ? '建议生成新手引导内容（默认depth=0）' : '渐进引导已设置'
    });
    results.push({
      pass: rx.length > 0,
      category: '高价值字段',
      name: 'regex_scripts 状态同步正则',
      desc: '当前 ' + rx.length + ' 条',
      fix: rx.length === 0 ? '建议生成基础状态同步正则脚本，无需插件实现动态状态栏' : '状态正则已配置'
    });

    // === 世界书检查（5项） ===
    results.push({
      pass: entries.length >= 12 && entries.length <= 30,
      category: '世界书',
      name: '条目数 12-30条',
      desc: '当前 ' + entries.length + ' 条',
      fix: entries.length < 12 ? '建议补充至12条以上（覆盖8体系）' : (entries.length > 30 ? '条目过多，建议合并相似条目至30条以内' : '条目数量达标')
    });
    var entriesWithKeys = entries.filter(function(e) { return e.keys && e.keys.length > 0; }).length;
    results.push({
      pass: hasEntries && entriesWithKeys >= entries.length * 0.5,
      category: '世界书',
      name: '触发词覆盖率 ≥50%',
      desc: entriesWithKeys + '/' + entries.length + ' 条有触发词',
      fix: !hasEntries ? '无条目' : (entriesWithKeys < entries.length * 0.5 ? '建议为更多条目设置精准触发词' : '触发词覆盖良好')
    });
    var entriesWithContent = entries.filter(function(e) { return (e.content || '').length >= 250; }).length;
    results.push({
      pass: hasEntries && entriesWithContent >= Math.max(1, entries.length * 0.5),
      category: '世界书',
      name: '条目内容 ≥250字',
      desc: entriesWithContent + '/' + entries.length + ' 条达标',
      fix: !hasEntries ? '无条目' : (entriesWithContent < entries.length * 0.5 ? '建议扩充不达标条目内容至250字以上' : '条目内容充实')
    });
    var entriesWithPrefix = entries.filter(function(e) { return /^<[^>]+>/.test(e.comment || ''); }).length;
    results.push({
      pass: hasEntries && entriesWithPrefix >= Math.max(1, entries.length * 0.5),
      category: '世界书',
      name: '条目命名规范 ≥50%',
      desc: entriesWithPrefix + '/' + entries.length + ' 条使用<模块>前缀',
      fix: !hasEntries ? '无条目' : (entriesWithPrefix < entries.length * 0.5 ? '建议使用<基础公理>、<核心铁则>等规范前缀' : '命名规范良好')
    });
    // 权重合理性：核心规则在高权重位
    var coreIronRuleCount = entries.filter(function(e) { return (e.comment || '').indexOf('<核心铁则>') >= 0 || (e.comment || '').indexOf('<禁止项>') >= 0; }).length;
    var hasHighWeightCore = phi.length > 0 || coreIronRuleCount >= 1;
    var nearConstraintCount = entries.filter(function(e) { return (e.comment || '').indexOf('<近场强约束>') >= 0 || (e.comment || '').indexOf('<当前局势>') >= 0; }).length;
    results.push({
      pass: hasHighWeightCore && nearConstraintCount >= 0,
      category: '世界书',
      name: '权重合理性：核心规则在高权重位',
      desc: 'post_history_instructions: ' + (phi.length > 0 ? '✓' : '✗') + ' | 核心铁则条目: ' + coreIronRuleCount + ' | 近场强约束: ' + nearConstraintCount,
      fix: !hasHighWeightCore ? '核心规则必须放在高权重位（post_history_instructions或<核心铁则>条目）' : '权重分配合理'
    });

    // === 运行效果检查（3项） ===
    var permanentEntries = entries.filter(function(e) { return e.constant === true; });
    var permanentTokenCount = 0;
    permanentEntries.forEach(function(e) { permanentTokenCount += countTokens(e.content || ''); });
    permanentTokenCount += countTokens(phi);
    results.push({
      pass: permanentTokenCount <= 500,
      category: '运行效果',
      name: '常驻Token总量 ≤500',
      desc: '当前 ' + permanentTokenCount + ' Token（含post_history_instructions）',
      fix: permanentTokenCount > 500 ? '常驻内容过多，建议将非核心内容移到触发条目，控制常驻Token≤500' : '常驻内容合理'
    });
    // 递归安全：实体类条目开启prevent_recursion
    var entityEntries = entries.filter(function(e) {
      var c = e.comment || '';
      return c.indexOf('<实体交互>') >= 0 || c.indexOf('<重要角色>') >= 0 || c.indexOf('<势力与组织>') >= 0 || c.indexOf('<物品>') >= 0 || c.indexOf('<地点场景>') >= 0;
    });
    var recursionRiskEntries = entityEntries.filter(function(e) {
      return !(e.extensions && e.extensions.prevent_recursion);
    }).length;
    results.push({
      pass: entityEntries.length === 0 || recursionRiskEntries === 0,
      category: '运行效果',
      name: '递归安全：实体类条目开启prevent_recursion',
      desc: entityEntries.length + ' 条实体，' + recursionRiskEntries + ' 条未开启防护',
      fix: recursionRiskEntries > 0 ? '实体类条目必须开启prevent_recursion防止链式触发炸Token' : '递归安全'
    });
    // 冷却防抖：场景类条目开启cooldown
    var sceneEntries = entries.filter(function(e) {
      var c = e.comment || '';
      return c.indexOf('<场景机制>') >= 0 || c.indexOf('<核心玩法>') >= 0 || c.indexOf('<世界规则>') >= 0;
    });
    var noCooldownEntries = sceneEntries.filter(function(e) {
      return !(e.extensions && e.extensions.cooldown && e.extensions.cooldown > 0);
    }).length;
    results.push({
      pass: sceneEntries.length === 0 || noCooldownEntries === 0,
      category: '运行效果',
      name: '冷却防抖：场景类条目开启cooldown',
      desc: sceneEntries.length + ' 条场景，' + noCooldownEntries + ' 条未设置冷却',
      fix: noCooldownEntries > 0 ? '场景类条目建议开启cooldown=3防止内容刷屏' : '冷却防抖已配置'
    });

    // === 附加检查（超出规范20项的扩展，不计入主20项） ===
    var highRiskKeys = ['的', '是', '在', '有', '了', '和', '就', '都', '而', '及', '与', '一个', '一些', '什么', '如何', '怎么'];
    var riskyEntries = entries.filter(function(e) {
      var ks = e.keys || [];
      return ks.some(function(k) { return highRiskKeys.indexOf(k) >= 0; });
    }).length;
    results.push({
      pass: riskyEntries === 0,
      category: '附加检查',
      name: '触发词精准度（附加）',
      desc: riskyEntries + ' 条使用泛用关键词',
      fix: riskyEntries > 0 ? '避免使用"的"、"是"等泛用词作为触发词，改用领域专属词汇' : '触发词精准'
    });
    var totalTokenCount = countTokens(desc) + countTokens(first) + countTokens(sys) + countTokens(phi) +
      countTokens(mesEx) + entries.reduce(function(sum, e) { return sum + countTokens(e.content || ''); }, 0);
    var window8k = Math.round(totalTokenCount / 8192 * 100);
    var window16k = Math.round(totalTokenCount / 16384 * 100);
    results.push({
      pass: window8k <= 60,
      category: '附加检查',
      name: '上下文占用估算（附加）',
      desc: '8k窗口: ' + window8k + '% | 16k窗口: ' + window16k + '%',
      fix: window8k > 60 ? '内容偏多，可能影响长对话记忆，建议精简' : '上下文占用合理'
    });
    var cnEntries = entries.filter(function(e) {
      return e.match_whole_words === true || (e.extensions && e.extensions.match_whole_words === true);
    }).length;
    results.push({
      pass: cnEntries === 0,
      category: '附加检查',
      name: '中文适配检测（附加）',
      desc: cnEntries + ' 条错误开启match_whole_words',
      fix: cnEntries > 0 ? '中文场景应关闭match_whole_words（仅英文生效）' : '中文适配正确'
    });
    results.push({
      pass: notes.length <= 100,
      category: '附加检查',
      name: '创作者备注 ≤100字（附加）',
      desc: '当前 ' + notes.length + ' 字',
      fix: notes.length > 100 ? '创作者备注建议精简到100字以内' : '长度适中'
    });
    // group冲突检测：常驻条目共享非空group会导致互斥（ST同组仅注入1条）
    var groupConflicts = {};
    entries.forEach(function(e) {
      var ext = e.extensions || {};
      var g = ext.group;
      if (g && g !== '' && e.constant) {
        if (!groupConflicts[g]) groupConflicts[g] = [];
        groupConflicts[g].push(e);
      }
    });
    var conflictGroups = Object.keys(groupConflicts).filter(function(g) { return groupConflicts[g].length > 1; });
    var conflictCount = conflictGroups.reduce(function(sum, g) { return sum + groupConflicts[g].length; }, 0);
    results.push({
      pass: conflictGroups.length === 0,
      category: '附加检查',
      name: '常驻条目group冲突检测（附加）',
      desc: conflictGroups.length === 0 ? '无常驻条目group冲突' : (conflictCount + '条常驻条目共享' + conflictGroups.length + '个group（同组仅注入1条）'),
      fix: conflictGroups.length > 0 ? '常驻条目(constant=true)不应设置非空group，否则同组仅注入1条。冲突group：' + conflictGroups.join(', ') + '。建议清空常驻条目的group字段' : '常驻条目group配置正确'
    });

    return results;
  }

  // ===== 生成完整角色卡 =====
  function buildExportCard(cd) {
    var rawEntries = (cd.character_book && cd.character_book.entries) || [];
    var entries = rawEntries.map(function(e, i) {
      var comment = e.comment || ('条目' + (i + 1));
      var tmpl = getEntryTemplate(comment);
      var isConst = tmpl ? tmpl.constant : false;
      var isSel = tmpl ? tmpl.selective : true;
      var pos = tmpl ? tmpl.position : 4;
      var depth = tmpl ? tmpl.depth : 4;
      var order = tmpl ? tmpl.order : 100;
      var defaultGroup = tmpl ? tmpl.group : '';
      var defaultSticky = tmpl ? (tmpl.sticky || 0) : 0;
      var defaultCD = tmpl ? tmpl.cooldown : 0;
      var defaultProb = tmpl ? tmpl.probability : 100;
      var defaultSL = tmpl ? tmpl.selectiveLogic : 0;
      var defaultPR = tmpl ? tmpl.prevent_recursion : false;
      var defaultER = tmpl ? tmpl.exclude_recursion : false;
      var defaultDUR = tmpl ? !!tmpl.delay_until_recursion : false;
      var defaultUseProb = tmpl ? tmpl.useProbability : false;
      var defaultScanDepth = tmpl ? tmpl.scan_depth : 5;
      var ext = e.extensions || {};
      var rawPos = ext.position !== undefined ? ext.position : pos;
      var posNum = typeof rawPos === 'string'
        ? (rawPos === 'before_char' || rawPos === '0' ? 0 : 1)
        : rawPos;
      // ST规范：顶层position只接受 "before_char" 或 "after_char"
      // position=0 → before_char，其他所有值 → after_char
      var topPosStr = (posNum === 0) ? 'before_char' : 'after_char';
      var roleVal = ext.role !== undefined ? ext.role : 0;
      if (typeof roleVal === 'string') {
        roleVal = roleVal.toLowerCase() === 'user' ? 1 : 0;
      }
      var useProbVal = ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : defaultUseProb);
      var groupWeightVal = ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100);
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
        comment: comment,
        content: e.content || '',
        constant: e.constant !== undefined ? e.constant : isConst,
        selective: e.selective !== undefined ? e.selective : isSel,
        insertion_order: e.insertion_order || order,
        enabled: true,
        position: topPosStr,
        use_regex: e.use_regex !== undefined ? e.use_regex : true,
        extensions: {
          position: posNum,
          exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : defaultER,
          display_index: i,
          probability: ext.probability !== undefined ? ext.probability : defaultProb,
          useProbability: useProbVal,
          depth: ext.depth !== undefined ? ext.depth : depth,
          selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : defaultSL,
          group: ext.group || defaultGroup,
          prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : defaultPR,
          scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : defaultScanDepth,
          match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
          case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
          automation_id: '',
          group_override: false,
          group_weight: groupWeightVal,
          delay_until_recursion: ext.delay_until_recursion !== undefined ? !!ext.delay_until_recursion : defaultDUR,
          use_group_scoring: false,
          role: roleVal,
          vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
          sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
          cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
          delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
          match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
          match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
          match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
          match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
          match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
          match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false,
          outlet_name: '',
          triggers: [],
          ignore_budget: false
        }
      };
    });
    // ST规范：换行符统一使用 \r\n
    var toCRLF = function(str) {
      if (!str) return str;
      return str.replace(/\r?\n/g, '\r\n');
    };
    // ST规范：转换 regex_scripts 格式
    var normalizeRegexScripts = function(rxScripts) {
      if (!rxScripts || !Array.isArray(rxScripts)) return [];
      return rxScripts.map(function(script, idx) {
        var normalized = {
          id: script.id || ('regex_script_' + Date.now() + '_' + idx),
          scriptName: script.scriptName || script.name || '正则脚本',
          findRegex: script.findRegex || script.find || '',
          replaceString: script.replaceString || script.replace || '',
          trimStrings: script.trimStrings || [],
          placement: Array.isArray(script.placement) ? script.placement : [script.placement !== undefined ? script.placement : 2],
          disabled: script.disabled !== undefined ? script.disabled : false,
          markdownOnly: script.markdownOnly !== undefined ? script.markdownOnly : false,
          promptOnly: script.promptOnly !== undefined ? script.promptOnly : false,
          runOnEdit: script.runOnEdit !== undefined ? script.runOnEdit : true,
          substituteRegex: script.substituteRegex !== undefined ? script.substituteRegex : 0,
          minDepth: script.minDepth !== undefined ? script.minDepth : null,
          maxDepth: script.maxDepth !== undefined ? script.maxDepth : null
        };
        return normalized;
      });
    };
    var cardName = cd.name || '未命名世界';
    var cardDesc = cd.description || '';
    var cardFirstMes = toCRLF(cd.first_mes || '');
    var cardMesExample = toCRLF(cd.mes_example || '');
    var cardAltGreetings = (cd.alternate_greetings || []).map(function(g) { return toCRLF(g); });
    var cardPostHist = toCRLF(cd.post_history_instructions || '');
    var cardSysPrompt = toCRLF(cd.system_prompt || '');
    var cardCreatorNotes = toCRLF(cd.creator_notes || 'ModelO角色卡生成器创建');
    var depthPrompt = cd.extensions && cd.extensions.depth_prompt ? cd.extensions.depth_prompt : { prompt: '', depth: 0, role: 'system' };
    // 修正 depth_prompt.role 为字符串
    if (typeof depthPrompt.role === 'number') {
      depthPrompt.role = depthPrompt.role === 1 ? 'user' : (depthPrompt.role === 2 ? 'assistant' : 'system');
    }
    if (depthPrompt.depth === undefined) depthPrompt.depth = 0;
    var cardData = {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      mes_example: cardMesExample,
      creator_notes: cardCreatorNotes,
      system_prompt: cardSysPrompt,
      post_history_instructions: cardPostHist,
      tags: cd.tags && cd.tags.length ? cd.tags : [],
      creator: 'ModelO Generator',
      character_version: '',
      alternate_greetings: cardAltGreetings,
      extensions: {
        talkativeness: '0.5', fav: false, world: cardName,
        depth_prompt: depthPrompt,
        regex_scripts: normalizeRegexScripts(cd.extensions && cd.extensions.regex_scripts),
        'xiaobaix-template': {
          enabled: false,
          template: '',
          customRegex: '',
          disableParsers: false,
          skipFirstMessage: false,
          recentMessageCount: 0,
          limitToRecentMessages: false
        },
        tavern_helper: { scripts: [], variables: {} }
      },
      group_only_greetings: [],
      character_book: {
        entries: entries
      }
    };
    // ST规范：顶层需要重复 data 中的关键字段
    return {
      name: cardName,
      description: cardDesc,
      personality: cd.personality || '',
      scenario: cd.scenario || '',
      first_mes: cardFirstMes,
      mes_example: cardMesExample,
      creatorcomment: cardCreatorNotes,
      avatar: 'none',
      talkativeness: '0.5',
      fav: false,
      tags: cd.tags && cd.tags.length ? cd.tags : [],
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: cardData
    };
  }

  // ===== 主界面 =====
  async function openEditor() {
    try {
      var doc = await createModalIframe();

      var cardData = {
        name: '', description: '', personality: '', scenario: '',
        first_mes: '', mes_example: '', creator_notes: '', system_prompt: '',
        post_history_instructions: '', tags: [], creator: 'ModelO Generator',
        character_version: '', alternate_greetings: [],
        extensions: {
          talkativeness: '0.5',
          fav: false,
          world: '',
          depth_prompt: { prompt: '', depth: 0, role: 'system' },
          regex_scripts: [],
          'xiaobaix-template': {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: { scripts: [], variables: {} }
        },
        group_only_greetings: [],
        character_book: { entries: [] }
      };

      var messages = [];
      var isGenerating = false;
      var cardGenerated = false;
      var progress = 0;
      var moduleProgress = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0 };

      function renderWelcome() {
        doc.body.innerHTML =
          '<button class="close-btn" id="closeBtn">×</button>' +
          '<div class="app">' +
            '<div class="welcome">' +
              '<h2>⚡ ModelO 角色卡生成器</h2>' +
              '<p>基于SillyTavern原生机制与ST权重分层8体系，通过AI对话逐步引导你创建专业级世界模式角色卡。<br>和AI聊天就能生成符合ST规范的角色卡！</p>' +
              '<div class="welcome-features">' +
                '<div class="wf-item"><div class="wf-icon">💬</div><div class="wf-title">对话式创作</div><div class="wf-desc">像聊天一样自然，AI按权重层级逐步引导</div></div>' +
                '<div class="wf-item"><div class="wf-icon">📊</div><div class="wf-title">权重可视化</div><div class="wf-desc">展示每个条目权重等级、触发逻辑、Token占用</div></div>' +
                '<div class="wf-item"><div class="wf-icon">✅</div><div class="wf-title">20项质检</div><div class="wf-desc">8基础+4高价值+5世界书+3运行效果，专业达标</div></div>' +
                '<div class="wf-item"><div class="wf-icon">🎭</div><div class="wf-title">题材预设</div><div class="wf-desc">修仙/末世/西幻/都市等一键套用最优参数</div></div>' +
              '</div>' +
              '<button class="start-btn" id="startBtn">开始创作</button>' +
              '<div class="welcome-actions">' +
                '<button class="btn btn-ghost" id="genreBtn">🎭 题材预设</button>' +
                '<button class="btn btn-ghost" id="importBtn">📥 导入现有卡</button>' +
                '<button class="btn btn-ghost" id="continueBtn" style="display:none">📂 继续上次</button>' +
              '</div>' +
              '<p style="font-size:.7em;color:#484f58;margin-top:16px">ST权重分层8体系：🏛️基础公理 → 🤝交互软规则 → 🔐核心铁则 → 🎯近场强约束 → ⚔️场景机制 → 👥实体交互 → 📖叙事背景 → 🔄动态适配</p>' +
              '<p style="font-size:.65em;color:#484f58;margin-top:6px">引导流程：定核心铁则→搭世界基底→做实体内容→加场景规则→补叙事背景→做动态适配</p>' +
            '</div>' +
          '</div>';
        doc.getElementById('closeBtn').addEventListener('click', closeModal);
        doc.getElementById('startBtn').addEventListener('click', function() {
          renderChatUI();
          addAssistantMsg('你好！我是你的世界模式角色卡创作助手 🎭\n\n我会基于SillyTavern原生机制与ST权重分层8体系，通过6步引导你构建一个完整的世界。\n\n**引导流程**：定核心铁则 → 搭世界基底 → 做实体内容 → 加场景规则 → 补叙事背景 → 做动态适配\n\n在开始之前，有两个关键问题需要先明确：\n\n**1. 内容尺度**：你希望这个世界卡是什么尺度？\n   • 全年龄向：纯洁的青春、友情、冒险故事\n   • 暗黑向：残酷、深刻、成人向的剧情（非色情）\n   • NSFW（18禁）：成人内容、情欲描写\n\n**2. 核心方向**：你想做什么样的世界？\n   可以选择「🎭 题材预设」快速开始（修仙/末世/西幻/都市/科幻/校园），或直接告诉我你的构想！\n\n请先告诉我尺度和方向，我们就可以开始创作了！');
        });
        doc.getElementById('importBtn').addEventListener('click', showImportModal);
        var genreBtn = doc.getElementById('genreBtn');
        if (genreBtn) {
          genreBtn.addEventListener('click', function() {
            renderChatUI();
            showGenrePresets();
          });
        }
        var contBtn = doc.getElementById('continueBtn');
        if (contBtn && hasSavedData()) {
          contBtn.style.display = 'inline-block';
          contBtn.addEventListener('click', continueFromSave);
        }
      }

      function renderChatUI() {
        doc.body.innerHTML =
          '<button class="close-btn" id="closeBtn">×</button>' +
          '<div class="app">' +
            '<div class="topbar">' +
              '<h1>⚡ ModelO 角色卡生成器</h1>' +
              '<span class="phase" id="phaseLabel">0%</span>' +
            '</div>' +
            '<div class="main">' +
              '<div class="chat-panel" style="position:relative">' +
                '<div class="chat-header">💬 AI对话创作 <span style="color:#484f58;font-size:10px">Enter发送</span></div>' +
                '<div class="mod-focus" id="modFocus">' +
                  '<button class="mod-focus-btn" data-mod="axiom">🏛️ 基础公理</button>' +
                  '<button class="mod-focus-btn" data-mod="soft_rules">🤝 交互软规则</button>' +
                  '<button class="mod-focus-btn" data-mod="core_rules">🔐 核心铁则</button>' +
                  '<button class="mod-focus-btn" data-mod="near_constraint">🎯 近场强约束</button>' +
                  '<button class="mod-focus-btn" data-mod="scene_mechanics">⚔️ 场景机制</button>' +
                  '<button class="mod-focus-btn" data-mod="entity_interact">👥 实体交互</button>' +
                  '<button class="mod-focus-btn" data-mod="narrative_bg">📖 叙事背景</button>' +
                  '<button class="mod-focus-btn" data-mod="dynamic_adapt">🔄 动态适配</button>' +
                '</div>' +
                '<div class="mod-dash" id="modDash" style="margin:0;border-left:none;border-right:none;border-radius:0">' +
                  '<div class="md-header" id="modDashHeader"><span>📊 模块进度仪表盘</span><span class="md-arrow">▼</span></div>' +
                  '<div class="md-body"></div>' +
                '</div>' +
                '<div class="chat-messages" id="chatMessages"></div>' +
                '<div class="scroll-btns" id="scrollBtns"><button id="scrollBottomBtn" title="到底部">↓</button></div>' +
                '<div class="quick-actions" id="quickActions">' +
                  '<button class="quick-btn" data-action="next">💡 下一步该做什么</button>' +
                  '<button class="quick-btn" data-action="summary">📊 查看当前进度</button>' +
                  '<button class="quick-btn" data-action="opening">🎬 生成开场白</button>' +
                  '<button class="quick-btn" data-action="qc">✅ 质检</button>' +
                  '<button class="quick-btn" data-action="optimize">🔧 优化</button>' +
                  '<button class="quick-btn" data-action="generate">✨ 生成角色卡</button>' +
                '</div>' +
                '<div class="chat-input-area">' +
                  '<textarea class="chat-input" id="chatInput" placeholder="描述你想要的世界..." rows="1"></textarea>' +
                  '<div class="chat-input-char-count" id="charCount">0 / 2000</div>' +
                  '<div class="chat-send-row">' +
                    '<button class="btn btn-primary" id="sendBtn" style="flex:1">发送</button>' +
                    '<button class="btn btn-success" id="saveBtn">💾 导出</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="preview-panel">' +
                '<div class="preview-header">' +
                  '<span>📋 预览</span>' +
                  '<span id="completionLabel" style="font-size:.72em;color:#3fb950">0%</span>' +
                '</div>' +
                '<div class="preview-body" id="previewBody"></div>' +
              '</div>' +
            '</div>' +
          '</div>';
        bindEvents();
        updateModFocus();
        updateQuickActions();
        renderPreview();
        renderModDash();
        updateCharCount();
      }

      function bindEvents() {
        doc.getElementById('closeBtn').addEventListener('click', closeModal);
        var input = doc.getElementById('chatInput');
        var sendBtn = doc.getElementById('sendBtn');
        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
        });
        input.addEventListener('input', function() {
          updateCharCount();
          updateSendBtnPulse();
        });
        doc.getElementById('saveBtn').addEventListener('click', saveCharacter);
        var qBtns = doc.querySelectorAll('.quick-btn');
        for (var i = 0; i < qBtns.length; i++) {
          qBtns[i].addEventListener('click', function() {
            var action = this.getAttribute('data-action');
            handleQuickAction(action);
          });
        }
        var modBtns = doc.querySelectorAll('.mod-focus-btn');
        for (var j = 0; j < modBtns.length; j++) {
          modBtns[j].addEventListener('click', function() {
            var mod = this.getAttribute('data-mod');
            handleModFocus(mod);
          });
        }
        var sbBtn = doc.getElementById('scrollBottomBtn');
        if (sbBtn) {
          sbBtn.addEventListener('click', scrollChat);
        }
        var cm = doc.getElementById('chatMessages');
        if (cm) {
          cm.addEventListener('scroll', function() {
            var btns = doc.getElementById('scrollBtns');
            if (btns) {
              if (cm.scrollTop < cm.scrollHeight - cm.clientHeight - 100) {
                btns.classList.add('show');
              } else {
                btns.classList.remove('show');
              }
            }
          });
        }
      }

      function updateCharCount() {
        var input = doc.getElementById('chatInput');
        var cnt = doc.getElementById('charCount');
        if (!input || !cnt) return;
        var len = input.value.length;
        cnt.textContent = len + ' / 2000';
        cnt.className = 'chat-input-char-count';
        if (len > 1500) cnt.classList.add('warn');
        if (len > 1900) cnt.classList.add('over');
      }

      function updateSendBtnPulse() {
        var input = doc.getElementById('chatInput');
        var btn = doc.getElementById('sendBtn');
        if (!input || !btn) return;
        var hasContent = input.value.trim().length > 0;
        btn.classList.toggle('send-btn-pulse', hasContent && !btn.disabled);
      }

      // ===== 导入模态框 =====
      function showImportModal() {
        var h = '<div class="modal" id="importModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">📥 导入角色卡</h3>' +
            '<p style="font-size:.78em;color:#8b949e;margin-bottom:8px">导入现有角色卡继续编辑，支持chara_card_v2/v3格式</p>' +
            '<div class="import-tabs">' +
              '<div class="import-tab active" data-tab="paste">📋 粘贴JSON</div>' +
              '<div class="import-tab" data-tab="file">📁 选择文件</div>' +
            '</div>' +
            '<div id="importTabPaste">' +
              '<textarea class="chat-input" id="importTextarea" placeholder="在此粘贴角色卡JSON..." rows="8" style="min-height:120px;font-family:Consolas,monospace;font-size:.75em"></textarea>' +
            '</div>' +
            '<div id="importTabFile" style="display:none">' +
              '<div class="import-dropzone" id="importDropzone">' +
                '<div class="dz-icon">📁</div>' +
                '<div class="dz-text">点击选择文件或拖拽JSON文件到此处</div>' +
                '<input type="file" id="importFile" accept=".json,application/json" style="display:none">' +
              '</div>' +
              '<div id="importFileInfo" style="font-size:.72em;color:#8b949e;text-align:center;display:none"></div>' +
            '</div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-ghost" id="importCloseBtn">取消</button>' +
              '<button class="btn btn-primary" id="importConfirmBtn">✅ 导入并开始</button>' +
            '</div>' +
          '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('importCloseBtn').addEventListener('click', function() { modalEl.remove(); });

        var tabs = modalEl.querySelectorAll('.import-tab');
        tabs.forEach(function(t) {
          t.addEventListener('click', function() {
            tabs.forEach(function(x) { x.classList.remove('active'); });
            t.classList.add('active');
            var tab = t.getAttribute('data-tab');
            doc.getElementById('importTabPaste').style.display = tab === 'paste' ? 'block' : 'none';
            doc.getElementById('importTabFile').style.display = tab === 'file' ? 'block' : 'none';
          });
        });

        var dz = doc.getElementById('importDropzone');
        var fileInput = doc.getElementById('importFile');
        if (dz && fileInput) {
          dz.addEventListener('click', function() { fileInput.click(); });
          fileInput.addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            if (file) handleImportFile(file);
          });
        }

        doc.getElementById('importConfirmBtn').addEventListener('click', function() {
          var text = doc.getElementById('importTextarea').value.trim();
          if (!text) { showToast('请粘贴JSON内容或选择文件', 'warning'); return; }
          try {
            var data = JSON.parse(text);
            importCardData(data);
            modalEl.remove();
          } catch(e) { showToast('JSON解析失败: ' + e.message, 'error'); }
        });
      }

      function handleImportFile(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
          try {
            var data = JSON.parse(e.target.result);
            var info = doc.getElementById('importFileInfo');
            if (info) {
              info.style.display = 'block';
              var name = (data.data && data.data.name) || data.name || '未知';
              info.textContent = '✅ 已加载: ' + name + ' (' + file.name + ')';
            }
            doc.getElementById('importTextarea').value = e.target.result;
          } catch(err) {
            showToast('文件解析失败: ' + err.message, 'error');
          }
        };
        reader.readAsText(file);
      }

      function importCardData(data) {
        var cd = data.data || data;
        if (!cd || typeof cd !== 'object') { showToast('无效的角色卡格式', 'error'); return; }

        cardData.name = cd.name || '';
        cardData.description = cd.description || '';
        cardData.personality = cd.personality || '';
        cardData.scenario = cd.scenario || '';
        cardData.first_mes = cd.first_mes || '';
        cardData.mes_example = cd.mes_example || '';
        cardData.creator_notes = cd.creator_notes || '';
        cardData.system_prompt = cd.system_prompt || '';
        cardData.post_history_instructions = cd.post_history_instructions || '';
        cardData.tags = cd.tags || [];
        cardData.creator = cd.creator || 'ModelO Generator';
        cardData.character_version = cd.character_version !== undefined ? cd.character_version : '';
        cardData.alternate_greetings = cd.alternate_greetings || [];
        cardData.extensions = {
          talkativeness: '0.5',
          fav: false,
          world: cd.extensions && cd.extensions.world ? cd.extensions.world : '',
          depth_prompt: cd.extensions && cd.extensions.depth_prompt ? cd.extensions.depth_prompt : { prompt: '', depth: 0, role: 'system' },
          regex_scripts: cd.extensions && cd.extensions.regex_scripts ? cd.extensions.regex_scripts : [],
          'xiaobaix-template': cd.extensions && cd.extensions['xiaobaix-template'] ? cd.extensions['xiaobaix-template'] : {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: { scripts: [], variables: {} }
        };
        cardData.group_only_greetings = cd.group_only_greetings || [];

        if (cd.character_book) {
          cardData.character_book = {
            entries: (cd.character_book.entries || []).map(function(e) {
              return {
                comment: e.comment || '',
                content: e.content || '',
                keys: e.keys || [],
                constant: e.constant !== undefined ? e.constant : false,
                selective: e.selective !== undefined ? e.selective : true,
                insertion_order: e.insertion_order || 100,
                enabled: true,
                extensions: e.extensions || { position: 4, depth: 4, role: 0, probability: 100, useProbability: true, selectiveLogic: 0, group: '', group_weight: 100, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: false, use_group_scoring: false, vectorized: false, sticky: 0, cooldown: 0, delay: 0, match_persona_description: false, match_character_description: false, match_character_personality: false, match_character_depth_prompt: false, match_scenario: false, match_creator_notes: false, outlet_name: '', triggers: [], ignore_budget: false, automation_id: '', display_index: 0, scan_depth: null, match_whole_words: null, case_sensitive: null }
              };
            })
          };
        }

        cardGenerated = !!(cardData.name && (cardData.description || (cardData.character_book.entries && cardData.character_book.entries.length > 0)));
        progress = calcProgress();
        messages = [];

        renderChatUI();
        var entriesLen = (cardData.character_book && cardData.character_book.entries) ? cardData.character_book.entries.length : 0;
        var greeting = '你好！已成功导入角色卡「' + (cardData.name || '未命名') + '」🎭\n\n' +
          '卡片数据：描述 ' + (cardData.description || '').length + ' 字、开场白 ' + (cardData.first_mes || '').length + ' 字、世界书 ' + entriesLen + ' 条\n\n' +
          '**我已读取了角色卡的全部内容，可以直接进行增/删/改操作：**\n' +
          '• 想修改某个字段？直接说"把名字改成XXX"或"修改世界观描述"\n' +
          '• 想添加世界书条目？说"添加一个XX的条目"\n' +
          '• 想优化内容？说"优化开场白"或"优化世界书条目"\n' +
          '• 想质检？点击「✅ 质检」按钮\n\n' +
          '请告诉我你想做什么！';
        addAssistantMsg(greeting);
        saveToStorage();
      }

      // ===== localStorage 持久化 =====
      var STORAGE_KEY = 'modelo_char_generator_state';

      function saveToStorage() {
        try {
          var state = {
            cardData: cardData,
            messages: messages,
            cardGenerated: cardGenerated,
            progress: progress,
            moduleProgress: moduleProgress,
            timestamp: Date.now()
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch(e) {
          if (e.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded');
          }
        }
      }

      function loadFromStorage() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          var state = JSON.parse(raw);
          if (state.cardData) {
            cardData = state.cardData;
            messages = state.messages || [];
            cardGenerated = state.cardGenerated || false;
            progress = state.progress || 0;
            moduleProgress = state.moduleProgress || { gameplay: 0, rules: 0, situation: 0, characters: 0, story: 0, guide: 0 };
            return true;
          }
        } catch(e) {}
        return false;
      }

      function hasSavedData() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          var state = JSON.parse(raw);
          return state && state.cardData && state.cardData.name && state.cardData.name.length > 0;
        } catch(e) { return false; }
      }

      function clearStorage() {
        try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
      }

      function continueFromSave() {
        if (loadFromStorage()) {
          renderChatUI();
          renderModDash();
          showToast('已恢复上次创作进度', 'success');
        } else {
          showToast('没有找到保存的数据', 'warning');
        }
      }

      function handleModFocus(mod) {
        var modNames = {
          axiom: '基础公理',
          soft_rules: '交互软规则',
          core_rules: '核心铁则',
          near_constraint: '近场强约束',
          scene_mechanics: '场景机制',
          entity_interact: '实体交互',
          narrative_bg: '叙事背景',
          dynamic_adapt: '动态适配'
        };
        var modName = modNames[mod] || '该模块';
        var input = doc.getElementById('chatInput');
        if (input) {
          input.value = '请帮我深入完善' + modName + '部分，给我一些建议和灵感';
          handleSend();
        }
      }

      function updateModFocus() {
        var modBtns = doc.querySelectorAll('.mod-focus-btn');
        if (!modBtns || !modBtns.length) return;
        var mp = getModuleProgress();
        var modMap = { 'axiom': 0, 'soft_rules': 0, 'core_rules': 0, 'near_constraint': 0, 'scene_mechanics': 0, 'entity_interact': 0, 'narrative_bg': 0, 'dynamic_adapt': 0 };
        Object.keys(mp).forEach(function(k) { if (mp[k]) modMap[k] = 100; });
        var aiMp = moduleProgress || {};
        Object.keys(aiMp).forEach(function(k) { if (aiMp[k] > 0) modMap[k] = Math.max(modMap[k] || 0, aiMp[k]); });
        modBtns.forEach(function(btn) {
          var mod = btn.getAttribute('data-mod');
          var val = modMap[mod] || 0;
          btn.classList.remove('active');
          if (val >= 100) { btn.style.background = 'rgba(63,185,80,.15)'; btn.style.color = '#3fb950'; btn.style.borderColor = 'rgba(63,185,80,.3)'; }
          else if (val > 0) { btn.style.background = 'rgba(210,153,34,.15)'; btn.style.color = '#d29922'; btn.style.borderColor = 'rgba(210,153,34,.3)'; }
          else { btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
        });
      }

      function updateQuickActions() {
        var qa = doc.getElementById('quickActions');
        if (!qa) return;
        var p = progress || 0;
        var hasDesc = cardData.description && cardData.description.length > 50;
        var hasFirst = cardData.first_mes && cardData.first_mes.length > 50;
        var hasEntries = cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0;
        var actions = [];
        // 引导流程6步（规范4.5）：定核心铁则→搭世界基底→做实体内容→加场景规则→补叙事背景→做动态适配
        if (p < 20) {
          actions.push({ action: 'genre', label: '🎭 题材预设' });
          actions.push({ action: 'core_rules', label: '🔐 定核心铁则', hl: true });
        } else if (p < 40) {
          actions.push({ action: 'axiom', label: '🏛️ 搭世界基底', hl: true });
          actions.push({ action: 'soft_rules', label: '🤝 交互软规则' });
        } else if (p < 60) {
          actions.push({ action: 'entity_interact', label: '👥 做实体内容', hl: true });
          actions.push({ action: 'scene_mechanics', label: '⚔️ 加场景规则' });
        } else if (p < 80) {
          actions.push({ action: 'narrative_bg', label: '📖 补叙事背景' });
          actions.push({ action: 'dynamic_adapt', label: '🔄 做动态适配', hl: true });
        } else {
          actions.push({ action: 'generate', label: '✨ 生成角色卡', hl: true });
          actions.push({ action: 'optimize', label: '🔧 优化' });
        }
        actions.push({ action: 'next', label: '💡 下一步' });
        actions.push({ action: 'qc', label: '✅ 质检' });
        if (hasEntries) {
          actions.push({ action: 'weight', label: '📊 权重可视化' });
          actions.push({ action: 'group', label: '🗂️ 分组管理' });
        }
        var h = '';
        actions.forEach(function(a) {
          h += '<button class="quick-btn' + (a.hl ? ' hl' : '') + '" data-action="' + a.action + '">' + a.label + '</button>';
        });
        qa.innerHTML = h;
        var btns = qa.querySelectorAll('.quick-btn');
        for (var i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', function() {
            var act = this.getAttribute('data-action');
            handleQuickAction(act);
          });
        }
      }

      function handleQuickAction(action) {
        var input = doc.getElementById('chatInput');
        if (action === 'qc') { showQualityCheck(); return; }
        if (action === 'optimize') { showOptimizeModal(); return; }
        if (action === 'weight') { showWeightVisual(); return; }
        if (action === 'genre') { showGenrePresets(); return; }
        if (action === 'group') { showGroupMgr(); return; }
        if (action === 'next') {
          if (input) { input.value = '下一步我该做什么？请给我一些建议'; handleSend(); }
          return;
        }
        if (action === 'summary') {
          if (input) { input.value = '帮我梳理一下当前已收集的信息和进度'; handleSend(); }
          return;
        }
        if (action === 'situation') {
          if (input) { input.value = '请帮我完善当前局势和主要势力关系'; handleSend(); }
          return;
        }
        var prompts = {
          axiom: '请帮我完善基础公理和世界元数据，构建世界底层骨架',
          soft_rules: '请帮我设计交互软规则和叙事风格引导',
          core_rules: '请帮我完善核心铁则和输出格式要求',
          near_constraint: '请帮我设计近场强约束和当前局势',
          scene_mechanics: '请帮我完善场景机制和核心玩法',
          entity_interact: '请帮我设计实体交互和重要角色',
          narrative_bg: '请帮我完善叙事背景和故事发展',
          dynamic_adapt: '请帮我设计动态适配和引导机制',
          opening: '请根据已有设定生成开场白',
          generate: '生成完整角色卡'
        };
        if (prompts[action] && input) { input.value = prompts[action]; handleSend(); }
      }

      function addAssistantMsg(content) {
        messages.push({ role: 'assistant', content: content });
        appendMsg('assistant', content);
        saveToStorage();
        renderModDash();
      }
      function addUserMsg(content) {
        messages.push({ role: 'user', content: content });
        appendMsg('user', content);
        saveToStorage();
      }
      function appendMsg(role, content) {
        var c = doc.getElementById('chatMessages');
        if (!c) return;
        var div = doc.createElement('div');
        div.className = 'chat-msg ' + role;
        div.innerHTML = '<div class="avatar">' + (role === 'user' ? '👤' : '🤖') + '</div><div class="bubble">' + fmtBubble(content) + '</div>';
        c.appendChild(div);
        scrollChat();
      }
      function addTyping() {
        removeTyping();
        var c = doc.getElementById('chatMessages');
        if (!c) return;
        var div = doc.createElement('div');
        div.className = 'chat-msg assistant';
        div.id = 'typingInd';
        div.innerHTML = '<div class="avatar">🤖</div><div class="bubble typing"><span>●</span><span>●</span><span>●</span> 思考中...</div>';
        c.appendChild(div);
        scrollChat();
      }
      function removeTyping() {
        var t = doc.getElementById('typingInd');
        if (t) t.remove();
      }
      function scrollChat() {
        var c = doc.getElementById('chatMessages');
        if (c) requestAnimationFrame(function() { c.scrollTop = c.scrollHeight; });
      }
      function fmtBubble(t) {
        var parts = [];
        var re = /<statusblock>([\s\S]*?)<\/statusblock>/gi;
        var last = 0;
        var m;
        while ((m = re.exec(t)) !== null) {
          if (m.index > last) {
            parts.push({ type: 'text', content: t.substring(last, m.index) });
          }
          parts.push({ type: 'status', content: m[1] });
          last = m.index + m[0].length;
        }
        if (last < t.length) {
          parts.push({ type: 'text', content: t.substring(last) });
        }
        var out = '';
        parts.forEach(function(p) {
          if (p.type === 'status') {
            out += '<div class="sb-wrap">' + parseStatusblock(p.content) + '</div>';
          } else {
            var h = p.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            h = h.replace(/```json\s*([\s\S]*?)```/g, function(_, code) { return '<pre><code>' + code + '</code></pre>'; });
            h = h.replace(/```\w*\s*([\s\S]*?)```/g, function(_, code) { return '<pre><code>' + code + '</code></pre>'; });
            h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
            h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
            h = h.replace(/\n{3,}/g, '\n\n');
            h = h.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
            out += h;
          }
        });
        return out;
      }
      function parseStatusblock(inner) {
        var h = inner.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // Convert details/summary BEFORE unescaping other tags
        h = h.replace(/&lt;details(\s*)(open)?&gt;/g, '<div class="sb-section open"><div class="sb-summary">');
        h = h.replace(/&lt;\/details&gt;/g, '</div></div>');
        h = h.replace(/&lt;summary&gt;&lt;b&gt;([\s\S]*?)&lt;\/b&gt;&lt;\/summary&gt;/g, function(_, title) {
          return '</div><div class="sb-content">';
        });
        h = h.replace(/&lt;summary&gt;([\s\S]*?)&lt;\/summary&gt;/g, function(_, title) {
          return '</div><div class="sb-content">';
        });
        // Unescape safe tags (details/summary already converted above)
        var safeTags = 'ul|ol|li|p|b|br|span|div';
        h = h.replace(new RegExp('&lt;(' + safeTags + ')(\\s[^&>]*)?&gt;','gi'), '<$1$2>');
        h = h.replace(new RegExp('&lt;/(' + safeTags + ')&gt;','gi'), '</$1>');
        h = h.replace(/&lt;button([^&]*)&gt;/g, '<button$1>').replace(/&lt;\/button&gt;/g, '</button>');
        h = h.replace(/(『[^』]+』)/g, '<div class="sb-header">$1</div>');
        h = h.replace(/^(.+?):\s*(.+)$/gm, function(m, k, v) {
          if (k.indexOf('<') >= 0 || v.indexOf('</') >= 0) return m;
          return '<div class="sb-field"><span class="sb-field-label">' + k + ':</span> <span class="sb-field-value">' + v + '</span></div>';
        });
        return h;
      }

      function renderModDash() {
        var dash = doc.getElementById('modDash');
        if (!dash) return;
        var mp = getDetailedModuleProgress();
        var labels = [
          { key: 'axiom', icon: '🏛️', name: '基础公理', group: '常驻' },
          { key: 'soft_rules', icon: '🤝', name: '交互软规则', group: '常驻' },
          { key: 'core_rules', icon: '🔐', name: '核心铁则', group: '常驻' },
          { key: 'near_constraint', icon: '🎯', name: '近场强约束', group: '触发' },
          { key: 'scene_mechanics', icon: '⚔️', name: '场景机制', group: '触发' },
          { key: 'entity_interact', icon: '👥', name: '实体交互', group: '触发' },
          { key: 'narrative_bg', icon: '📖', name: '叙事背景', group: '触发' },
          { key: 'dynamic_adapt', icon: '🔄', name: '动态适配', group: '动态' }
        ];
        var h = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #21262d">';
        var groups = { '常驻': '#3fb950', '触发': '#d2a8ff', '动态': '#f78166' };
        Object.keys(groups).forEach(function(g) {
          h += '<span style="font-size:.62em;color:' + groups[g] + ';background:rgba(255,255,255,.03);padding:1px 6px;border-radius:3px">' + g + '体系</span>';
        });
        h += '</div>';
        labels.forEach(function(l) {
          var val = mp[l.key] || 0;
          var cls = val >= 100 ? 'done' : val > 0 ? 'prog' : 'empty';
          var groupColor = groups[l.group] || '#8b949e';
          h += '<div class="mod-dash-item" data-mod="' + l.key + '" title="' + l.group + '体系">' +
            '<span class="m-icon">' + l.icon + '</span>' +
            '<span class="m-name" style="color:' + groupColor + '">' + l.name + '</span>' +
            '<span class="m-bar-wrap"><span class="m-bar ' + cls + '" style="width:' + val + '%"></span></span>' +
            '<span class="m-pct">' + val + '%</span>' +
          '</div>';
        });
        var body = dash.querySelector('.md-body');
        if (body) body.innerHTML = h;
        var items = dash.querySelectorAll('.mod-dash-item');
        for (var i = 0; i < items.length; i++) {
          items[i].addEventListener('click', function() {
            var mod = this.getAttribute('data-mod');
            if (mod) handleModFocus(mod);
          });
        }
        var header = dash.querySelector('.md-header');
        if (header) {
          header.removeEventListener('click', toggleDash);
          var btn = header.querySelector('.md-analyze-btn');
          if (!btn) {
            btn = doc.createElement('button');
            btn.className = 'md-analyze-btn';
            btn.textContent = '🔍 AI分析';
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              handleAnalyzeProgress();
            });
            header.appendChild(btn);
          }
          header.addEventListener('click', toggleDash);
        }
      }
      async function handleAnalyzeProgress() {
        if (isGenerating) return;
        var entries = (cardData.character_book || {}).entries || [];
        if (entries.length === 0 && !cardData.description) {
          showToast('还没有内容可以分析，请先和AI聊聊', 'warning');
          return;
        }
        isGenerating = true;
        setEnabled(false);
        addTyping();
        try {
          var analyzePrompt = SYS_PROMPT +
            '\n\n=== AI分析指令 ===\n' +
            '请全面分析当前角色卡的内容，完成以下任务：\n' +
            '1. 评估每个体系的完成度，输出到```json代码块中\n' +
            '2. JSON格式：{"axiom":0-100,"soft_rules":0-100,"core_rules":0-100,"near_constraint":0-100,"scene_mechanics":0-100,"entity_interact":0-100,"narrative_bg":0-100,"dynamic_adapt":0-100}\n' +
            '3. 在回复中给出每个体系的改进建议和下一步行动方向\n' +
            '4. 最后给出一条适合用户输入的建议指令（放在<suggestion>标签中）\n\n' +
            '当前内容：\n' +
            (cardData.name ? '- 名称：' + cardData.name + '\n' : '') +
            (cardData.description ? '- 描述：' + cardData.description.substring(0, 500) + '\n' : '') +
            '- 条目数：' + entries.length + '条\n' +
            (entries.length > 0 ? '- 条目摘要：' + entries.map(function(e) { return e.comment + '(' + (e.content||'').length + '字)'; }).join(', ') : '');
          var aiResponse = await callAI(analyzePrompt);
          removeTyping();
          var parsed = extractJSON(aiResponse);
          if (parsed) {
            Object.keys(parsed).forEach(function(k) {
              if (moduleProgress.hasOwnProperty(k) && typeof parsed[k] === 'number') {
                moduleProgress[k] = Math.max(0, Math.min(100, parsed[k]));
              }
            });
          }
          var suggestion = aiResponse.match(/<suggestion>([\s\S]*?)<\/suggestion>/);
          var input = doc.getElementById('chatInput');
          if (suggestion && input) {
            input.value = suggestion[1].trim();
          }
          var dialogue = aiResponse.replace(/```[\s\S]*?```/g, '').replace(/<suggestion>[\s\S]*?<\/suggestion>/g, '').trim();
          if (dialogue) {
            try { addAssistantMsg(dialogue); } catch(e) { console.warn('addAssistantMsg error:', e); }
          } else {
            try { addAssistantMsg(aiResponse); } catch(e) { console.warn('addAssistantMsg error:', e); }
          }
          updateProgress();
          updateQuickActions();
          updateModFocus();
          renderPreview();
          renderModDash();
          saveToStorage();
        } catch(err) {
          removeTyping();
          try { addAssistantMsg('😞 分析失败：' + err.message); } catch(e) {}
        } finally {
          isGenerating = false;
          try { setEnabled(true); } catch(e) {}
        }
      }

      function toggleDash() {
        var dash = doc.getElementById('modDash');
        if (dash) dash.classList.toggle('collapsed');
      }

      function getDetailedModuleProgress() {
        var entries = (cardData.character_book || {}).entries || [];
        var result = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0 };
        var modKeywords = {
          axiom: ['基础公理', '世界元数据', '世界观公理', '力量体系骨架'],
          soft_rules: ['交互软规则', '互动选项', '叙事风格', '剧情引导'],
          core_rules: ['核心铁则', '绝对禁止', '输出格式', 'AI身份', 'post_history'],
          near_constraint: ['近场强约束', '当前局势', '即时状态', '临时任务'],
          scene_mechanics: ['场景机制', '核心玩法', '世界规则', '战斗规则', '修炼', '谈判'],
          entity_interact: ['实体交互', '重要角色', '势力与组织', '物品', '地点场景', 'NPC'],
          narrative_bg: ['叙事背景', '故事发展', '文化与习俗', '历史事件', '主线剧情'],
          dynamic_adapt: ['动态适配', '引导机制', '互动选项', '状态栏', 'alternate', 'depth_prompt']
        };
        Object.keys(modKeywords).forEach(function(mod) {
          var kws = modKeywords[mod];
          var count = 0;
          var totalLen = 0;
          var matched = {};
          entries.forEach(function(e) {
            var comment = e.comment || '';
            var isMatch = kws.some(function(kw) { return comment.indexOf(kw) >= 0; });
            if (isMatch && !matched[comment]) {
              matched[comment] = true;
              count++;
              totalLen += (e.content || '').length;
            }
          });
          if (count >= 2 && totalLen >= 500) result[mod] = 100;
          else if (count >= 1) result[mod] = Math.min(50 + count * 15 + Math.floor(totalLen / 100), 95);
          else result[mod] = 0;
        });
        if (cardData.post_history_instructions && cardData.post_history_instructions.length > 0) {
          result.core_rules = Math.max(result.core_rules, 50);
        }
        if (cardData.extensions && cardData.extensions.depth_prompt && cardData.extensions.depth_prompt.prompt && cardData.extensions.depth_prompt.prompt.length > 0) {
          result.dynamic_adapt = Math.max(result.dynamic_adapt, 30);
        }
        if (cardData.alternate_greetings && cardData.alternate_greetings.length > 0) {
          result.dynamic_adapt = Math.max(result.dynamic_adapt, 30);
        }
        var aiMp = moduleProgress || {};
        Object.keys(aiMp).forEach(function(k) {
          if (aiMp[k] > 0 && result[k] === 0) result[k] = aiMp[k];
        });
        return result;
      }
      function parseModProgress(reply) {
        var modMap = {
          '基础公理': 'axiom',
          '交互软规则': 'soft_rules',
          '核心铁则': 'core_rules',
          '近场强约束': 'near_constraint',
          '场景机制': 'scene_mechanics',
          '实体交互': 'entity_interact',
          '叙事背景': 'narrative_bg',
          '动态适配': 'dynamic_adapt'
        };
        var result = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0 };
        Object.keys(modMap).forEach(function(kw) {
          var key = modMap[kw];
          var re = new RegExp(kw + '[^\\n]*?([✅⏳❌])');
          var m = reply.match(re);
          if (m) {
            var sym = m[1];
            result[key] = sym === '✅' ? 100 : sym === '⏳' ? 50 : 0;
          }
        });
        if (cardData && cardData.character_book && cardData.character_book.entries) {
          var entries = cardData.character_book.entries;
          Object.keys(modMap).forEach(function(kw) {
            var key = modMap[kw];
            var count = 0;
            entries.forEach(function(e) {
              if ((e.comment || '').indexOf(kw) >= 0) count++;
            });
            if (result[key] === 100 && count === 0) result[key] = 0;
            if (result[key] === 100 && count === 1) result[key] = 50;
            if (result[key] === 50 && count === 0) result[key] = 0;
          });
        }
        return result;
      }
      function escHtml(t) {
        if (!t) return '';
        var d = doc.createElement('div');
        d.textContent = t;
        return d.innerHTML;
      }

      var lastUserInput = '';
      async function handleSend() {
        var input = doc.getElementById('chatInput');
        var text = input ? input.value.trim() : '';
        if (!text || isGenerating) return;
        input.value = '';
        lastUserInput = text;
        var genKw = ['生成角色卡','生成完整角色卡','导出角色卡','完整生成'];
        var isGenCmd = genKw.some(function(k) { return text === k || text.indexOf(k) >= 0; });
        if (isGenCmd && progress >= 30) {
          addUserMsg(text);
          await doGenerate();
          return;
        }
        addUserMsg(text);
        await callAIChat();
      }

      // ===== AI回复清理（移除思考链、内部标签等） =====
      function cleanAIReply(text) {
        if (!text) return text;
        var t = text;
        t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        t = t.replace(/<!--\s*End of The ECoT\s*-->/gi, '');
        t = t.replace(/^#\s*果农人格加载[^\n]*\n/gim, '');
        t = t.replace(/\*果农记录[：:][^*]*\*/g, '');
        t = t.replace(/<time_format>[\s\S]*?<\/time_format>/gi, '');
        t = t.replace(/<content>/gi, '').replace(/<\/content>/gi, '');
        t = t.replace(/^\[(语言检定|果农冒泡|NSFW判定|人物逻辑|基调锚定|角色认知迷雾|角色活性与自然回应|风格适配|反思\s*&?\s*设定校对|物理规则|正文字数检测|输出顺序检查|时间地点输出检查|善意视角|防重复|反思)\][^\n]*\n/gim, '');
        t = t.replace(/<角色认知迷雾>[\s\S]*?<\/角色认知迷雾>/gi, '');
        t = t.replace(/<角色活性与自然回应>[\s\S]*?<\/角色活性与自然回应>/gi, '');
        t = t.replace(/\n{4,}/g, '\n\n\n');
        t = t.trim();
        return t;
      }

      // ===== 从AI回复中提取JSON =====
      function extractJSON(text) {
        if (!text) return null;
        var patterns = [
          /```json\s*([\s\S]*?)\s*```/i,
          /```javascript\s*([\s\S]*?)\s*```/i,
          /```js\s*([\s\S]*?)\s*```/i,
          /```\s*([\s\S]*?)\s*```/i,
        ];
        for (var i = 0; i < patterns.length; i++) {
          var m = text.match(patterns[i]);
          if (m) {
            var jsonContent = m[1].trim();
            try { return JSON.parse(jsonContent); } catch(e) {}
            try {
              var fixed = jsonContent
                .replace(/\\\\n/g, '\\n')
                .replace(/\\\\r/g, '\\r')
                .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?\s*:/g, '"$2":')
                .replace(/:\s*'([^']*?)'/g, ':"$1"')
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']');
              return JSON.parse(fixed);
            } catch(e) {}
          }
        }
        var braceStart = text.indexOf('{');
        var braceEnd = text.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
          var candidate = text.substring(braceStart, braceEnd + 1);
          try { return JSON.parse(candidate.trim()); } catch(e) {}
          try {
            var fixed = candidate
              .replace(/\\\\n/g, '\\n')
              .replace(/\\\\r/g, '\\r')
              .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?\s*:/g, '"$2":')
              .replace(/:\s*'([^']*?)'/g, ':"$1"')
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']');
            return JSON.parse(fixed);
          } catch(e) {}
        }
        return null;
      }

      // ===== AI对话调用 =====
      async function callAIChat() {
        if (isGenerating) return;
        isGenerating = true;
        setEnabled(false);
        addTyping();
        try {
          var prompt = buildPrompt(cardData, cardGenerated, messages);
          var aiResponse = await callAI(prompt);
          aiResponse = cleanAIReply(aiResponse);
          removeTyping();
          var parsed = extractJSON(aiResponse);
          if (parsed) {
            var hasData = Object.keys(parsed).filter(function(k) { return k !== '_nochange'; }).length > 0;
            if (hasData) {
              var actuallyModified = mergePartial(parsed, cardData);
              if (actuallyModified) {
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
              }
            }
          }
          if (lastUserInput && (lastUserInput.indexOf('开场白') >= 0 || lastUserInput.indexOf('first_mes') >= 0 || lastUserInput.indexOf('opening') >= 0)) {
            if (parsed && parsed.first_mes && typeof parsed.first_mes === 'string' && parsed.first_mes.trim().length > 50) {
              cardData.first_mes = parsed.first_mes.trim();
              progress = calcProgress();
            }
          }
          var modProg = parseModProgress(aiResponse);
          if (modProg) {
            var entries = (cardData.character_book || {}).entries || [];
            var modMap = {
              '基础公理': 'axiom',
              '交互软规则': 'soft_rules',
              '核心铁则': 'core_rules',
              '近场强约束': 'near_constraint',
              '场景机制': 'scene_mechanics',
              '实体交互': 'entity_interact',
              '叙事背景': 'narrative_bg',
              '动态适配': 'dynamic_adapt'
            };
            Object.keys(modMap).forEach(function(kw) {
              var key = modMap[kw];
              if (modProg[key] === 100) {
                var count = entries.filter(function(e) { return (e.comment || '').indexOf(kw) >= 0; }).length;
                if (count === 0) modProg[key] = 0;
                else if (count === 1) modProg[key] = 50;
              }
              if (modProg[key] === 50) {
                var cnt = entries.filter(function(e) { return (e.comment || '').indexOf(kw) >= 0; }).length;
                if (cnt === 0) modProg[key] = 0;
              }
            });
            moduleProgress = modProg;
          }
          var dialogue = aiResponse.replace(/```[\s\S]*?```/g, '').trim();
          if (dialogue) {
            try { addAssistantMsg(dialogue); } catch(e) { console.warn('addAssistantMsg error:', e); }
          } else {
            try { addAssistantMsg(aiResponse); } catch(e) { console.warn('addAssistantMsg error:', e); }
          }
          updateProgress();
          updateQuickActions();
          updateModFocus();
          renderPreview();
          renderModDash();
          saveToStorage();
        } catch(err) {
          removeTyping();
          try { addAssistantMsg('😞 出错了：' + err.message + '\n\n请检查酒馆是否已连接AI模型，以及JS-Slash-Runner插件是否已启用。'); } catch(e) {}
          try { setEnabled(true); } catch(e) {}
        } finally {
          isGenerating = false;
          try { setEnabled(true); } catch(e) {}
        }
      }

      // ===== 完整生成 =====
      async function doGenerate() {
        if (isGenerating) return;
        isGenerating = true;
        setEnabled(false);
        addTyping();
        try {
          var hasAll = cardData.name && cardData.description && cardData.first_mes && ((cardData.character_book || {}).entries || []).length >= 4;
          if (hasAll) {
            removeTyping();
            cardGenerated = true;
            setProgress(100);
            renderPreview();
            updateModFocus();
            renderModDash();
            addAssistantMsg('🎉 角色卡内容已完整！点击「💾 导出」查看完整JSON。\n\n你也可以继续和我对话，随时修改或补充内容。');
            isGenerating = false;
            setEnabled(true);
            return;
          }
          var genPrompt = SYS_PROMPT +
            '\n\n=== 生成指令 ===\n' +
            '请立即生成完整的角色卡数据，补齐所有缺失的核心字段。\n' +
            '使用标准格式，输出到```json代码块中。\n' +
            'description至少400字，first_mes至少500字，世界书条目至少8条（覆盖六大模块）。\n' +
            '自动生成合适的世界书名称、系统指令、标签。\n\n' +
            '已有内容：\n' +
            (cardData.name ? '- 名称：' + cardData.name + '\n' : '') +
            (cardData.description ? '- 描述：' + cardData.description.substring(0, 300) + '\n' : '') +
            '- 条目数：' + (((cardData.character_book || {}).entries || []).length) + '条\n' +
            (cardData.tags && cardData.tags.length ? '- 标签：' + cardData.tags.join(',') : '');
          var aiResponse = await callAI(genPrompt);
          removeTyping();
          var parsed = extractJSON(aiResponse);
          if (parsed) {
            try {
              if (parsed.spec === 'chara_card_v3' && parsed.data) {
                for (var k in parsed.data) { if (parsed.data.hasOwnProperty(k)) cardData[k] = parsed.data[k]; }
              } else {
                mergePartial(parsed, cardData);
              }
              cardGenerated = true;
              setProgress(100);
              renderPreview();
              updateModFocus();
              renderModDash();
              saveToStorage();
              addAssistantMsg('🎉 角色卡生成成功！点击「💾 导出」查看完整JSON。');
            } catch(e) {
              addAssistantMsg('⚠️ 解析失败，请重试。\n\n错误：' + e.message);
            }
          } else {
            addAssistantMsg('⚠️ 未找到JSON格式，可能需要再补充一些信息。\n\nAI返回前300字：\n' + aiResponse.substring(0, 300));
          }
        } catch(err) {
          removeTyping();
          addAssistantMsg('生成出错：' + err.message);
        } finally {
          isGenerating = false;
          setEnabled(true);
        }
      }

      function setEnabled(enabled) {
        var sendBtn = doc.getElementById('sendBtn');
        var input = doc.getElementById('chatInput');
        if (sendBtn) sendBtn.disabled = !enabled;
        if (input) { input.disabled = !enabled; if (enabled) input.focus(); }
        var qb = doc.querySelectorAll('.quick-btn');
        for (var i = 0; i < qb.length; i++) qb[i].disabled = !enabled;
        updateSendBtnPulse();
      }

      function getModuleProgress() {
        var entries = (cardData.character_book || {}).entries || [];
        var comments = entries.map(function(e) { return (e.comment || ''); });
        var keywords = {
          axiom: ['基础公理', '世界元数据', '世界观公理', '力量体系骨架'],
          soft_rules: ['交互软规则', '互动选项', '叙事风格', '剧情引导'],
          core_rules: ['核心铁则', '绝对禁止', '输出格式', 'AI身份'],
          near_constraint: ['近场强约束', '当前局势', '即时状态', '临时任务'],
          scene_mechanics: ['场景机制', '核心玩法', '世界规则', '战斗规则'],
          entity_interact: ['实体交互', '重要角色', '势力与组织', '物品', '地点场景'],
          narrative_bg: ['叙事背景', '故事发展', '文化与习俗', '历史事件'],
          dynamic_adapt: ['动态适配', '引导机制', '互动选项', '状态栏']
        };
        var result = {};
        Object.keys(keywords).forEach(function(mod) {
          var kws = keywords[mod];
          result[mod] = comments.some(function(c) {
            return kws.some(function(kw) { return c.indexOf(kw) >= 0; });
          });
        });
        if (cardData.post_history_instructions && cardData.post_history_instructions.length > 0) {
          result.core_rules = true;
        }
        if (cardData.extensions && cardData.extensions.depth_prompt && cardData.extensions.depth_prompt.prompt && cardData.extensions.depth_prompt.prompt.length > 0) {
          result.dynamic_adapt = true;
        }
        return result;
      }

      function calcProgress() {
        var score = 0;
        if (cardData.name) score += 8;
        if (cardData.description && cardData.description.length >= 400) score += 15;
        else if (cardData.description && cardData.description.length >= 200) score += 10;
        else if (cardData.description && cardData.description.length > 50) score += 5;
        var entries = (cardData.character_book || {}).entries || [];
        if (entries.length >= 4) {
          if (cardData.first_mes && cardData.first_mes.length >= 500) score += 15;
          else if (cardData.first_mes && cardData.first_mes.length >= 300) score += 8;
        }
        if (cardData.system_prompt && cardData.system_prompt.length >= 20) score += 5;
        score += Math.min(entries.length * 5, 30);
        var mp = getModuleProgress();
        var modKeys = Object.keys(mp);
        var doneCount = modKeys.filter(function(k) { return mp[k] === true; }).length;
        score += doneCount * 5;
        if (cardData.tags && cardData.tags.length >= 2) score += 5;
        if (cardData.creator_notes && cardData.creator_notes.length >= 10) score += 2;
        return Math.min(score, 100);
      }

      function updateProgress() {
        progress = calcProgress();
        var pl = doc.getElementById('phaseLabel');
        if (pl) pl.textContent = progress + '%';
        var cl = doc.getElementById('completionLabel');
        if (cl) cl.textContent = progress + '%';
      }
      function setProgress(val) {
        progress = Math.max(0, Math.min(100, val));
        var pl = doc.getElementById('phaseLabel');
        if (pl) pl.textContent = progress + '%';
        var cl = doc.getElementById('completionLabel');
        if (cl) cl.textContent = progress + '%';
      }

      // ===== 质检弹窗 =====
      function showQualityCheck() {
        if (!cardData.name && !cardData.description) {
          showToast('还没有内容可以质检哦，先和AI聊聊吧', 'warning');
          return;
        }
        var results = runQualityCheck(cardData);
        var passCount = results.filter(function(r) { return r.pass; }).length;
        var coreResults = results.filter(function(r) { return r.category !== '附加检查'; });
        var corePass = coreResults.filter(function(r) { return r.pass; }).length;
        var h = '<div class="modal" id="qcModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">✅ 角色卡质检报告（规范20项 + 附加检查）</h3>' +
            '<p style="font-size:.78em;color:#8b949e;margin-bottom:8px">核心 ' + corePass + '/' + coreResults.length + ' 项达标 · 全部 ' + passCount + '/' + results.length + ' 项达标</p>' +
            '<div class="progress-bar"><div class="progress-bar-fill" style="width:' + Math.round(corePass/coreResults.length*100) + '%"></div></div>' +
            '<div class="modal-body" style="margin-top:10px">';
        var categories = ['基础字段', '高价值字段', '世界书', '运行效果', '附加检查'];
        var catColors = { '基础字段': '#d2a8ff', '高价值字段': '#f78166', '世界书': '#3fb950', '运行效果': '#d29922', '附加检查': '#8b949e' };
        categories.forEach(function(cat) {
          var catResults = results.filter(function(r) { return r.category === cat; });
          if (catResults.length === 0) return;
          var catPass = catResults.filter(function(r) { return r.pass; }).length;
          h += '<div style="margin:8px 0 4px;font-size:.75em;font-weight:600;color:' + (catColors[cat] || '#8b949e') + ';border-bottom:1px solid #21262d;padding-bottom:3px">' + cat + '（' + catPass + '/' + catResults.length + '）</div>';
          catResults.forEach(function(r) {
            h += '<div class="qc-item ' + (r.pass ? 'pass' : 'fail') + '">' +
              '<div class="qc-title ' + (r.pass ? 'qc-pass' : 'qc-fail') + '">' +
                (r.pass ? '✅' : '❌') + ' ' + r.name +
              '</div>' +
              '<div class="qc-desc">' + r.desc + '</div>' +
              '<div class="qc-fix">💡 ' + r.fix + '</div>' +
            '</div>';
          });
        });
        h += '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="qcCloseBtn">关闭</button>' +
            '<button class="btn btn-primary" id="qcOptBtn">🔧 一键优化未达标项</button>' +
          '</div>' +
        '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('qcCloseBtn').addEventListener('click', function() { modalEl.remove(); });
        var optBtn = doc.getElementById('qcOptBtn');
        if (optBtn) {
          optBtn.addEventListener('click', function() {
            modalEl.remove();
            var failed = results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; });
            showOptimizeModal(failed.join('、'));
          });
        }
      }

      // ===== 权重可视化预览（规范4.4） =====
      function showWeightVisual() {
        var entries = (cardData.character_book || {}).entries || [];
        if (entries.length === 0) {
          showToast('还没有世界书条目，先和AI聊聊生成内容吧', 'warning');
          return;
        }
        var permToken = 0, trigToken = 0, totalToken = 0;
        entries.forEach(function(e) {
          var tk = countTokens(e.content || '');
          totalToken += tk;
          if (e.constant) permToken += tk; else trigToken += tk;
        });
        var phiToken = countTokens(cardData.post_history_instructions || '');
        permToken += phiToken;

        var h = '<div class="modal" id="wvModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">📊 权重可视化预览</h3>' +
            '<p style="font-size:.72em;color:#8b949e;margin-bottom:8px">展示每个条目的权重等级、触发逻辑、Token占用（对齐ST注入权重层级）</p>' +
            '<div class="wv-summary">' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#3fb950">' + entries.length + '</span><span class="wv-stat-lbl">条目总数</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#f85149">' + permToken + '</span><span class="wv-stat-lbl">常驻Token</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#d2a8ff">' + trigToken + '</span><span class="wv-stat-lbl">触发Token</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#d29922">' + totalToken + '</span><span class="wv-stat-lbl">总Token</span></div>' +
            '</div>' +
            '<div class="wv-legend">';
        var legendItems = [
          { level: '最高', color: '#f85149', desc: 'post_history/铁则' },
          { level: '极高', color: '#ff7b72', desc: 'position=2/状态栏' },
          { level: '中高', color: '#d29922', desc: 'position=4 触发' },
          { level: '中', color: '#3fb950', desc: '概率触发/动态' },
          { level: '低', color: '#8b949e', desc: 'position=1 常驻' },
          { level: '极低', color: '#6e7681', desc: 'position=0 常驻' }
        ];
        legendItems.forEach(function(l) {
          h += '<span class="wv-legend-item"><span class="wv-legend-dot" style="background:' + l.color + '"></span>' + l.level + '(' + l.desc + ')</span>';
        });
        h += '</div>' +
            '<div class="modal-body">';

        // 按分组展示
        var groupOrder = ['常驻体系', '触发体系', '叙事', '动态系统', '自定义'];
        var groupColors = { '常驻体系': '#3fb950', '触发体系': '#d2a8ff', '叙事': '#f0883e', '动态系统': '#f78166', '自定义': '#8b949e' };
        groupOrder.forEach(function(g) {
          var groupEntries = entries.filter(function(e) {
            var eg = getDisplayGroup(e);
            return eg === g;
          });
          if (groupEntries.length === 0) return;
          var groupTok = 0;
          groupEntries.forEach(function(e) { groupTok += countTokens(e.content || ''); });
          h += '<div class="wv-group-header"><span style="color:' + (groupColors[g] || '#8b949e') + '">' + g + '</span><span class="wv-group-count">' + groupEntries.length + '条 · ' + groupTok + 'T</span></div>';
          // 按权重排序（order越大权重越低，先展示高权重=order小）
          groupEntries.sort(function(a, b) { return (a.insertion_order || 100) - (b.insertion_order || 100); });
          groupEntries.forEach(function(e, idx) {
            var comment = e.comment || ('条目' + (idx + 1));
            var m = comment.match(/^<([^>]+)>/);
            var prefixKey = m ? m[1] : '';
            var wl = WEIGHT_LEVELS[prefixKey] || { level: '中', color: '#3fb950', desc: '自定义' };
            var tk = countTokens(e.content || '');
            var ext = e.extensions || {};
            var tmpl = getEntryTemplate(comment);
            var isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
            var pos = ext.position !== undefined ? ext.position : (tmpl ? tmpl.position : 4);
            var depth = ext.depth !== undefined ? ext.depth : (tmpl ? tmpl.depth : 4);
            var sticky = ext.sticky || 0;
            var cd = ext.cooldown || 0;
            var pr = ext.prevent_recursion;
            var prob = ext.probability !== undefined ? ext.probability : 100;
            var sl = ext.selectiveLogic || 0;

            h += '<div class="wv-entry" style="border-left-color:' + wl.color + '">' +
              '<div class="wv-entry-header">' +
                '<span class="wv-entry-name" title="' + escHtml(comment) + '">' + escHtml(comment) + '</span>' +
                '<span class="wv-entry-level" style="background:' + wl.color + '20;color:' + wl.color + ';border:1px solid ' + wl.color + '50">' + wl.level + '</span>' +
                '<span class="wv-entry-token">' + tk + 'T</span>' +
              '</div>' +
              '<div class="wv-entry-meta">' +
                '<span class="wv-tag ' + (isConst ? 'const' : 'trig') + '">' + (isConst ? '常驻' : '触发') + '</span>' +
                '<span class="wv-tag">pos=' + pos + '</span>' +
                (!isConst ? '<span class="wv-tag">depth=' + depth + '</span>' : '') +
                (sticky ? '<span class="wv-tag dyn">sticky</span>' : '') +
                (cd ? '<span class="wv-tag warn">CD=' + cd + '</span>' : '') +
                (pr ? '<span class="wv-tag const">防递归</span>' : '') +
                (prob < 100 ? '<span class="wv-tag warn">' + prob + '%</span>' : '') +
                (sl ? '<span class="wv-tag trig">SL=' + sl + '</span>' : '') +
                '<span class="wv-tag" style="color:#484f58" title="' + escHtml(wl.desc) + '">' + escHtml(wl.desc) + '</span>' +
              '</div>' +
            '</div>';
          });
        });

        h += '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="wvCloseBtn">关闭</button>' +
          '</div>' +
        '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('wvCloseBtn').addEventListener('click', function() { modalEl.remove(); });
      }

      // ===== 题材预设模板（规范4.4） =====
      function showGenrePresets() {
        var h = '<div class="modal" id="genreModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">🎭 题材预设模板</h3>' +
            '<p style="font-size:.72em;color:#8b949e;margin-bottom:8px">选择题材一键套用最优参数：标签、关键词、核心规则、条目建议</p>' +
            '<div class="genre-preset-grid">';
        Object.keys(GENRE_PRESETS).forEach(function(key) {
          var g = GENRE_PRESETS[key];
          h += '<div class="genre-preset-card" data-genre="' + key + '">' +
            '<div class="gp-icon">' + g.icon + '</div>' +
            '<div class="gp-name">' + key + '</div>' +
            '<div class="gp-desc">' + escHtml(g.desc) + '</div>' +
          '</div>';
        });
        h += '</div>' +
          '<div id="genreDetail" style="display:none;margin-top:8px"></div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="genreCloseBtn">关闭</button>' +
          '</div>' +
        '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('genreCloseBtn').addEventListener('click', function() { modalEl.remove(); });
        var cards = modalEl.querySelectorAll('.genre-preset-card');
        for (var i = 0; i < cards.length; i++) {
          cards[i].addEventListener('click', function() {
            var genre = this.getAttribute('data-genre');
            applyGenrePreset(genre, modalEl);
          });
        }
      }

      function applyGenrePreset(genre, modalEl) {
        var g = GENRE_PRESETS[genre];
        if (!g) return;
        var detail = modalEl.querySelector('#genreDetail');
        if (detail) {
          detail.style.display = 'block';
          detail.innerHTML = '<div class="pv-section" style="margin-top:6px">' +
            '<h3 style="color:#f78166;font-size:.8em;margin-bottom:6px">' + g.icon + ' ' + genre + ' · 详细参数</h3>' +
            '<div style="font-size:.7em;color:#8b949e;line-height:1.6">' +
              '<div style="margin-bottom:4px"><b style="color:#d2a8ff">建议名称：</b>' + escHtml(g.suggestedName) + '</div>' +
              '<div style="margin-bottom:4px"><b style="color:#d2a8ff">标签：</b>' + g.tags.map(escHtml).join(' · ') + '</div>' +
              '<div style="margin-bottom:4px"><b style="color:#d2a8ff">核心铁则：</b>' + escHtml(g.coreRule) + '</div>' +
              '<div style="margin-bottom:4px"><b style="color:#d2a8ff">场景触发词：</b>' + g.sceneKeys.map(escHtml).join('、') + '</div>' +
              '<div style="margin-bottom:8px"><b style="color:#d2a8ff">关键术语：</b>' + g.keyTerms.map(escHtml).join('、') + '</div>' +
              '<div style="display:flex;gap:6px;justify-content:center;margin-top:8px">' +
                '<button class="btn btn-success" id="genreApplyBtn" style="font-size:.8em">✅ 套用此预设</button>' +
                '<button class="btn btn-primary" id="genreAIBtn" style="font-size:.8em">🤖 用此题材开始创作</button>' +
              '</div>' +
            '</div></div>';
          var applyBtn = doc.getElementById('genreApplyBtn');
          if (applyBtn) applyBtn.addEventListener('click', function() {
            // 套用预设参数
            if (!cardData.name) cardData.name = g.suggestedName;
            cardData.tags = (cardData.tags && cardData.tags.length) ? cardData.tags : g.tags.slice();
            if (!cardData.post_history_instructions) cardData.post_history_instructions = g.coreRule;
            cardData.system_prompt = cardData.system_prompt || ('你是「' + g.suggestedName + '」的叙事AI。');
            progress = calcProgress();
            updateProgress();
            renderPreview();
            renderModDash();
            updateModFocus();
            saveToStorage();
            modalEl.remove();
            showToast('已套用「' + genre + '」预设参数', 'success');
          });
          var aiBtn = doc.getElementById('genreAIBtn');
          if (aiBtn) aiBtn.addEventListener('click', function() {
            modalEl.remove();
            if (!cardData.name) cardData.name = g.suggestedName;
            cardData.tags = (cardData.tags && cardData.tags.length) ? cardData.tags : g.tags.slice();
            var input = doc.getElementById('chatInput');
            if (input) {
              input.value = '我想创作一个【' + genre + '】题材的世界，参考预设：' + g.desc + '。\n核心规则：' + g.coreRule + '\n请帮我基于这个题材开始构建世界设定，先从核心铁则和基础公理开始。';
              handleSend();
            }
          });
        }
      }

      // ===== 分组管理（规范4.4：分组自动适配） =====
      function showGroupMgr() {
        var entries = (cardData.character_book || {}).entries || [];
        if (entries.length === 0) {
          showToast('还没有世界书条目', 'warning');
          return;
        }
        var groups = {};
        entries.forEach(function(e) {
          var g = getDisplayGroup(e);
          if (!groups[g]) groups[g] = [];
          groups[g].push(e);
        });
        var groupColors = { '常驻体系': '#3fb950', '触发体系': '#d2a8ff', '叙事': '#f0883e', '动态系统': '#f78166', '自定义': '#8b949e' };
        var h = '<div class="modal" id="groupModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">🗂️ 分组管理</h3>' +
            '<p style="font-size:.72em;color:#8b949e;margin-bottom:8px">每个体系对应一个世界书分组，支持批量开关（对齐ST分组管理功能）</p>' +
            '<div class="group-mgr-list">';
        Object.keys(groups).forEach(function(g) {
          var gEntries = groups[g];
          var gTok = 0;
          gEntries.forEach(function(e) { gTok += countTokens(e.content || ''); });
          var allEnabled = gEntries.every(function(e) { return e.enabled !== false; });
          h += '<div class="group-mgr-item">' +
            '<span class="gm-color" style="background:' + (groupColors[g] || '#8b949e') + '"></span>' +
            '<span class="gm-name">' + escHtml(g) + '</span>' +
            '<span class="gm-count">' + gEntries.length + '条 · ' + gTok + 'T</span>' +
            '<button class="gm-toggle ' + (allEnabled ? 'on' : '') + '" data-group="' + escHtml(g) + '">' + (allEnabled ? '已启用' : '已禁用') + '</button>' +
          '</div>';
        });
        h += '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="groupCloseBtn">关闭</button>' +
            '<button class="btn btn-primary" id="groupReassignBtn">🔄 按前缀重新分组</button>' +
          '</div>' +
        '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('groupCloseBtn').addEventListener('click', function() { modalEl.remove(); });
        var toggles = modalEl.querySelectorAll('.gm-toggle');
        for (var i = 0; i < toggles.length; i++) {
          toggles[i].addEventListener('click', function() {
            var g = this.getAttribute('data-group');
            var turnOn = !this.classList.contains('on');
            entries.forEach(function(e) {
              var eg = getDisplayGroup(e);
              if (eg === g) e.enabled = turnOn;
            });
            this.classList.toggle('on', turnOn);
            this.textContent = turnOn ? '已启用' : '已禁用';
            saveToStorage();
            renderPreview();
            showToast((turnOn ? '已启用' : '已禁用') + '分组：' + g, 'success');
          });
        }
        var reassignBtn = doc.getElementById('groupReassignBtn');
        if (reassignBtn) reassignBtn.addEventListener('click', function() {
          entries.forEach(function(e) {
            var tmpl = getEntryTemplate(e.comment || '');
            if (tmpl) {
              if (!e.extensions) e.extensions = {};
              e.extensions.group = tmpl.group;
            }
          });
          saveToStorage();
          modalEl.remove();
          showGroupMgr();
          showToast('已按条目前缀重新分配分组', 'success');
        });
      }

      // ===== 优化弹窗 =====
      var selectedOptFields = [];
      function showOptimizeModal(presetReq) {
        if (!cardData.name && !cardData.description) {
          showToast('还没有内容可以优化哦', 'warning');
          return;
        }
        var fields = [
          { key: 'name', label: '🌍 世界名称' },
          { key: 'description', label: '📜 世界观描述' },
          { key: 'first_mes', label: '🎬 开场白' },
          { key: 'system_prompt', label: '⚡ 系统指令' },
          { key: 'post_history_instructions', label: '🔐 核心铁则' },
          { key: 'mes_example', label: '💬 对话示例' },
          { key: 'alternate_greetings', label: '🎭 备用开局' },
          { key: 'depth_prompt', label: '🎮 新手引导' },
          { key: 'regex_scripts', label: '🔄 状态正则' },
          { key: 'tags', label: '🏷️ 标签' },
          { key: 'entries', label: '📖 世界书条目' }
        ];
        selectedOptFields = [];
        var h = '<div class="modal" id="optModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#d2a8ff;margin-bottom:4px;font-size:1em">🔧 AI 角色卡优化</h3>' +
            '<p style="font-size:.78em;color:#8b949e;margin-bottom:8px">选择要优化的字段，AI将智能优化并展示对比</p>' +
            '<div class="opt-field-select">';
        fields.forEach(function(f) {
          h += '<span class="opt-field-tag" data-key="' + f.key + '">' + f.label + '</span>';
        });
        h += '</div>' +
            '<textarea class="chat-input" id="optCustom" placeholder="补充优化要求（可选），如：让开场白更有悬疑感、增加仙侠氛围..." rows="2" style="margin:6px 0;min-height:50px">' + (presetReq || '') + '</textarea>' +
            '<div id="optProgress" style="display:none;text-align:center;padding:12px;color:#d2a8ff;font-size:.85em"><span class="typing" style="display:inline"><span>●</span><span>●</span><span>●</span></span> AI正在优化...</div>' +
            '<div id="optResult" class="modal-body" style="display:none"></div>' +
            '<div class="modal-actions">' +
              '<button class="btn btn-ghost" id="optCloseBtn">关闭</button>' +
              '<button class="btn btn-primary" id="startOptBtn">🚀 开始优化</button>' +
            '</div>' +
          '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var optModalEl = tmp.firstElementChild;
        doc.body.appendChild(optModalEl);
        optModalEl.addEventListener('click', function(e) { if (e.target === optModalEl) optModalEl.remove(); });
        doc.getElementById('optCloseBtn').addEventListener('click', function() { optModalEl.remove(); });

        var tags = doc.querySelectorAll('.opt-field-tag');
        for (var i = 0; i < tags.length; i++) {
          tags[i].addEventListener('click', function() {
            this.classList.toggle('selected');
            var k = this.getAttribute('data-key');
            var idx = selectedOptFields.indexOf(k);
            if (idx >= 0) selectedOptFields.splice(idx, 1);
            else selectedOptFields.push(k);
          });
        }
        doc.getElementById('startOptBtn').addEventListener('click', startOptimize);
      }

      async function startOptimize() {
        if (selectedOptFields.length === 0) { showToast('请先点击上方的字段标签选择要优化的字段', 'warning'); return; }
        if (isGenerating) { showToast('AI正在处理中，请稍候...', 'warning'); return; }
        isGenerating = true;
        var customReq = doc.getElementById('optCustom').value.trim();
        var prog = doc.getElementById('optProgress');
        var res = doc.getElementById('optResult');
        var btn = doc.getElementById('startOptBtn');
        if (prog) prog.style.display = 'block';
        if (btn) btn.disabled = true;

        try {
          var cardStr = JSON.stringify(buildExportCard(cardData), null, 2);
          var optPrompt = '你是角色卡优化专家。请针对以下字段优化角色卡，只返回优化后的JSON对象（顶层字段，不需要chara_card_v3包装）。\n\n' +
            '=== 要优化的字段 ===\n' + selectedOptFields.join(', ') + '\n\n' +
            (customReq ? '=== 具体优化要求 ===\n' + customReq + '\n\n' : '') +
            '=== 优化原则（对齐质检标准）===\n' +
            '1. 只优化目标字段，不修改无关内容\n' +
            '2. 保持原有风格和设定，提升质量而非推翻重来\n' +
            '3. description：建议≥400字，增加细节和沉浸感\n' +
            '4. first_mes：建议500-800字，遵循：场景描写→动作驱动→内心独白→自然对话→结尾留钩\n' +
            '5. system_prompt：≤50字，仅AI身份定位，核心规则迁移到post_history_instructions\n' +
            '6. post_history_instructions：≤100字，极度精简，放在常驻最高权重位\n' +
            '7. mes_example：建议生成1-2组对话示例（Few-shot），提升效果\n' +
            '8. alternate_greetings：建议生成3个不同身份/难度的备用开局\n' +
            '9. depth_prompt：生成新手引导内容，默认depth=0\n' +
            '10. regex_scripts：生成基础状态同步正则脚本，无需插件实现动态状态栏。格式规范：\n' +
            '    - findRegex：使用/模式/flags格式，如"/<status>(.*?)</status>/gi"\n' +
            '    - replaceString：替换内容，支持$1-$9捕获组和{{match}}宏\n' +
            '    - placement：[0,1]表示同时作用于用户输入和AI回复\n' +
            '    - runOnEdit：true表示编辑消息时也运行\n' +
            '    - 常用正则示例：\n' +
            '      * 状态栏格式化：findRegex="/<status>(.*?)</status>/gi", replaceString="**状态：**$1"\n' +
            '      * 行动标签：findRegex="/<action>(.*?)</action>/gi", replaceString="**行动：**$1"\n' +
            '      * 数值高亮：findRegex="/(\\d+)(点|级|年|%)/gi", replaceString="**$1$2**"\n' +
            '      * 表情转换：findRegex="/\\[笑\\]/gi", replaceString="😄"\n' +
            '    - 生成3-5条实用正则脚本，覆盖状态格式化、数值高亮、行动标签等场景\n' +
            '11. tags：建议2-12个，精准描述世界题材和风格\n' +
            '12. 世界书条目：优先优化现有条目（用相同comment覆盖），条目内容≥250字，使用<基础公理>等规范前缀，实体类条目开启prevent_recursion，场景类条目开启cooldown\n' +
            '13. first_mes字段必须包含完整的开场白文本，严禁使用占位符\n' +
            '14. 内容尺度跟随用户已有设定，不主动增加NSFW内容\n\n' +
            '=== 当前角色卡 ===\n```json\n' + cardStr + '\n```\n\n' +
            '只输出```json代码块，包含优化后的字段。entries必须放在顶层。extensions字段中的depth_prompt和regex_scripts直接放在顶层输出。';

          var reply = await callAI(optPrompt);
          var optimized = extractJSON(reply);
          if (!optimized) {
            if (prog) prog.style.display = 'none';
            if (res) {
              res.style.display = 'block';
              res.innerHTML = '<div style="padding:12px;text-align:center;color:#f85149">⚠️ AI未返回有效的优化JSON<br><span style="font-size:.7em;color:#8b949e">原始回复：' + escHtml(reply.substring(0, 200)) + '</span></div>';
            }
          } else {
            try {
              if (prog) prog.style.display = 'none';
              if (res) {
                res.style.display = 'block';
                var compH = '';
                selectedOptFields.forEach(function(field) {
                  var beforeV = '';
                  var afterV = '';
                  if (field === 'entries') {
                    beforeV = JSON.stringify(((cardData.character_book || {}).entries || []).slice(0, 3), null, 1);
                    afterV = JSON.stringify((optimized.entries || []).slice(0, 3), null, 1);
                  } else if (field === 'tags') {
                    beforeV = (cardData.tags || []).join(', ');
                    afterV = (optimized.tags || []).join(', ');
                  } else if (field === 'alternate_greetings') {
                    beforeV = (cardData.alternate_greetings || []).join('\n---\n');
                    afterV = (optimized.alternate_greetings || []).join('\n---\n');
                  } else if (field === 'depth_prompt') {
                    var beforeDp = (cardData.extensions || {}).depth_prompt || {};
                    var afterDp = optimized.depth_prompt || {};
                    beforeV = 'prompt: ' + (beforeDp.prompt || '') + '\ndepth: ' + (beforeDp.depth || 4);
                    afterV = 'prompt: ' + (afterDp.prompt || '') + '\ndepth: ' + (afterDp.depth || 4);
                  } else if (field === 'regex_scripts') {
                    var beforeRx = (cardData.extensions || {}).regex_scripts || [];
                    var afterRx = optimized.regex_scripts || [];
                    beforeV = JSON.stringify(beforeRx.slice(0, 2), null, 1);
                    afterV = JSON.stringify(afterRx.slice(0, 2), null, 1);
                  } else {
                    beforeV = cardData[field] || '';
                    afterV = optimized[field] || '';
                  }
                  compH += '<div style="margin-bottom:10px">' +
                    '<div style="font-size:.78em;font-weight:600;color:#d2a8ff;margin-bottom:4px">' + field + '</div>' +
                    '<div class="opt-compare">' +
                      '<div><div class="opt-label before">优化前</div><div class="opt-pane before">' + escHtml(beforeV) + '</div></div>' +
                      '<div><div class="opt-label after">优化后</div><div class="opt-pane after">' + escHtml(afterV) + '</div></div>' +
                    '</div></div>';
                });
                compH += '<div style="text-align:center;margin-top:8px">' +
                  '<button class="btn btn-success" id="applyOptBtn">✅ 应用优化</button>' +
                '</div>';
                res.innerHTML = compH;
                var applyBtn = doc.getElementById('applyOptBtn');
                if (applyBtn) {
                  applyBtn.addEventListener('click', function() {
                    var optModified = mergePartial(optimized, cardData);
                    if (optModified) {
                      progress = calcProgress();
                      updateProgress();
                      renderPreview();
                      doc.getElementById('optModal').remove();
                      showToast('✅ 优化已应用', 'success');
                    } else {
                      showToast('⚠️ 未检测到有效修改', 'warning');
                    }
                  });
                }
              }
            } catch(e) {
              if (prog) prog.style.display = 'none';
              if (res) {
                res.style.display = 'block';
                res.innerHTML = '<div style="padding:12px;text-align:center;color:#f85149">JSON解析失败: ' + escHtml(e.message) + '</div>';
              }
            }
          }
        } catch(err) {
          if (prog) prog.style.display = 'none';
          if (res) {
            res.style.display = 'block';
            res.innerHTML = '<div style="padding:12px;text-align:center;color:#f85149">优化失败: ' + escHtml(err.message) + '</div>';
          }
        } finally {
          isGenerating = false;
          if (btn) btn.disabled = false;
        }
      }

      // ===== 世界书名称编辑 =====
      function editBookName() {
        // 参考文件中 character_book 不含 name 字段，此功能已停用
        showToast('当前模板不支持修改世界书名称', 'info');
      }

      // ===== 预览渲染 =====
      function renderPreview() {
        var body = doc.getElementById('previewBody');
        if (!body) return;
        updateProgress();

        function sec(icon, title, content, rightInfo) {
          var has = content && (typeof content === 'string' ? content.trim().length > 0 : true);
          var dot = has ? 'full' : 'empty';
          var inner = has ? '<div class="pv-content">' + escHtml(typeof content === 'string' ? content : '') + '</div>' : '<div class="pv-empty">待生成...</div>';
          var rightHtml = rightInfo ? '<span class="sec-right">' + rightInfo + '</span>' : '';
          return '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + dot + '"></span>' + icon + ' ' + title + '</span>' + rightHtml + '</h3>' + inner + '</div>';
        }

        var h = '';
        h += sec('🌍', '世界名称', cardData.name);
        h += sec('📜', '世界观描述', cardData.description, cardData.description ? (cardData.description.length + '字') : '');

        // 模块进度
        var mp = getModuleProgress();
        var modLabels = { axiom: '🏛️ 公理', soft_rules: '🤝 软规则', core_rules: '🔐 铁则', near_constraint: '🎯 近场', scene_mechanics: '⚔️ 机制', entity_interact: '👥 实体', narrative_bg: '📖 叙事', dynamic_adapt: '🔄 动态' };
        var modH = '<div class="module-progress">';
        Object.keys(modLabels).forEach(function(k) {
          var cls = mp[k] ? 'done' : 'todo';
          modH += '<div class="module-item ' + cls + '">' + modLabels[k] + '</div>';
        });
        modH += '</div>';

        var entries = cardData.character_book.entries || [];
        var bookName = (cardData.character_book && cardData.character_book.name) || '世界设定集';
        var bookTokCount = 0;
        entries.forEach(function(e) { bookTokCount += countTokens(e.content || ''); });

        if (entries.length > 0) {
          var eH = '';
          for (var i = 0; i < Math.min(entries.length, 6); i++) {
            var e = entries[i];
            var label = e.comment || ('条目' + (i+1));
            eH += '<div class="pv-entry"><div class="pv-entry-title">' + escHtml(label) + '</div><div class="pv-entry-content">' + escHtml((e.content||'').substring(0, 100)) + '</div></div>';
          }
          if (entries.length > 6) eH += '<div class="pv-entry"><div class="pv-entry-title" style="color:#484f58">...还有' + (entries.length - 6) + '条</div></div>';
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>📖 <span class="pv-book-name" id="bookNameEdit" title="点击修改世界书名称">' + escHtml(bookName) + '</span></span><span class="sec-right">' + entries.length + '条 · ~' + bookTokCount + 'T</span></h3>' + modH + eH + '</div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>📖 <span class="pv-book-name" id="bookNameEdit" title="点击修改世界书名称">' + escHtml(bookName) + '</span></span></h3><div class="pv-empty">待生成...</div></div>';
        }

        h += sec('🎬', '开场白', cardData.first_mes, cardData.first_mes ? (cardData.first_mes.length + '字') : '');
        h += sec('⚡', '系统指令', cardData.system_prompt, cardData.system_prompt ? (cardData.system_prompt.length + '字') : '');

        var tags = cardData.tags || [];
        if (tags.length > 0) {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>🏷️ 标签</span><span class="sec-right">' + tags.length + '个</span></h3><div class="pv-content">' + tags.map(function(t) { return escHtml(t); }).join(' · ') + '</div></div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>🏷️ 标签</span></h3><div class="pv-empty">待生成...</div></div>';
        }

        h += sec('📝', '创作者备注', cardData.creator_notes);

        body.innerHTML = h;

        var bnEdit = doc.getElementById('bookNameEdit');
        if (bnEdit) bnEdit.addEventListener('click', editBookName);
      }

      function saveCharacter() {
        if (!cardData.name || !cardData.name.trim()) {
          showToast('请先确定世界/角色名称', 'error');
          return;
        }
        try {
          var exportCard = buildExportCard(cardData);
          showJsonModal(JSON.stringify(exportCard, null, 2));
        } catch(e) {
          showToast('保存失败: ' + e.message, 'error');
        }
      }

      function showJsonModal(jsonStr) {
        var modal = doc.createElement('div');
        modal.className = 'json-modal';
        modal.innerHTML =
          '<div class="json-modal-content">' +
            '<h2 style="color:#d2a8ff;margin-bottom:8px;font-size:1em">✨ 角色卡已生成</h2>' +
            '<p style="color:#8b949e;margin-bottom:8px;font-size:.78em">复制JSON导入酒馆，或下载文件后导入。</p>' +
            '<div style="display:flex;gap:4px;margin-bottom:8px">' +
              '<button class="btn btn-ghost" id="formatV3" style="font-size:.75em;padding:4px 10px">📦 v3格式</button>' +
              '<button class="btn btn-ghost" id="formatV2" style="font-size:.75em;padding:4px 10px">📦 v2格式</button>' +
              '<button class="btn btn-ghost" id="formatLorebook" style="font-size:.75em;padding:4px 10px">📖 世界书</button>' +
            '</div>' +
            '<textarea id="jsonOutput" readonly></textarea>' +
            '<div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">' +
              '<button class="btn btn-ghost" id="closeJsonModal">关闭</button>' +
              '<button class="btn btn-primary" id="copyJson">📋 复制</button>' +
              '<button class="btn btn-success" id="downloadJson">💾 下载</button>' +
            '</div>' +
          '</div>';
        doc.body.appendChild(modal);
        var jsonOutput = doc.getElementById('jsonOutput');
        jsonOutput.value = jsonStr;
        var currentFormat = 'v3';

        function buildV2Card(cd) {
          var book = cd.character_book || {};
          var entries = book.entries || [];
          var toCRLF = function(str) { return str ? str.replace(/\r?\n/g, '\r\n') : str; };
          return JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
              name: cd.name || '',
              description: cd.description || '',
              personality: cd.personality || '',
              scenario: cd.scenario || '',
              first_mes: toCRLF(cd.first_mes || ''),
              mes_example: toCRLF(cd.mes_example || ''),
              system_prompt: toCRLF(cd.system_prompt || ''),
              post_history_instructions: toCRLF(cd.post_history_instructions || ''),
              tags: cd.tags || [],
              creator_notes: cd.creator_notes || '',
              alternate_greetings: (cd.alternate_greetings || []).map(function(g) { return toCRLF(g); }),
              character_book: {
                entries: entries.map(function(e, i) {
                  var ext = e.extensions || {};
                  var rawPos = (e.position !== undefined) ? e.position : (ext.position !== undefined ? ext.position : 0);
                  var posNum = typeof rawPos === 'string'
                    ? (rawPos === 'before_char' || rawPos === '0' ? 0 : 1)
                    : rawPos;
                  var topPosStr = (posNum === 0) ? 'before_char' : 'after_char';
                  var useProbVal = ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : false);
                  var groupWeightVal = ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100);
                  return {
                    id: e.id || (i + 1),
                    keys: e.keys || [],
                    secondary_keys: e.secondary_keys || [],
                    comment: e.comment || '',
                    content: e.content || '',
                    constant: e.constant !== undefined ? e.constant : false,
                    selective: e.selective !== undefined ? e.selective : true,
                    insertion_order: e.insertion_order || 100,
                    enabled: true,
                    position: topPosStr,
                    use_regex: e.use_regex !== undefined ? e.use_regex : true,
                    extensions: {
                      position: posNum,
                      exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : false,
                      display_index: i,
                      probability: ext.probability !== undefined ? ext.probability : 100,
                      useProbability: useProbVal,
                      depth: ext.depth !== undefined ? ext.depth : 4,
                      selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : 0,
                      group: ext.group || '',
                      prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : false,
                      scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : (e.constant ? 0 : 5),
                      match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
                      case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
                      automation_id: '',
                      group_override: false,
                      group_weight: groupWeightVal,
                      delay_until_recursion: ext.delay_until_recursion !== undefined ? !!ext.delay_until_recursion : false,
                      use_group_scoring: false,
                      role: ext.role !== undefined ? ext.role : 0,
                      vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
                      sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
                      cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
                      delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
                      match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
                      match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
                      match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
                      match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
                      match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
                      match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false,
                      outlet_name: '',
                      triggers: [],
                      ignore_budget: false
                    }
                  };
                })
              }
            }
          }, null, 2);
        }

        function buildLorebook(cd) {
          var book = cd.character_book || {};
          return JSON.stringify({
            name: book.name || '世界设定集',
            description: cd.description || '',
            entries: (book.entries || []).map(function(e, i) {
              var ext = e.extensions || {};
              var rawPos = (e.position !== undefined) ? e.position : (ext.position !== undefined ? ext.position : 0);
              var posNum = typeof rawPos === 'string'
                ? (rawPos === 'before_char' || rawPos === '0' ? 0 : 1)
                : rawPos;
              var topPosStr = (posNum === 0) ? 'before_char' : 'after_char';
              var useProbVal = ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : false);
              var groupWeightVal = ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100);
              var delayUntilRecVal = ext.delay_until_recursion !== undefined ? !!ext.delay_until_recursion : false;
              return {
                id: e.id || (i + 1),
                keys: e.keys || [],
                secondary_keys: e.secondary_keys || [],
                comment: e.comment || '',
                content: e.content || '',
                constant: e.constant !== undefined ? e.constant : false,
                selective: e.selective !== undefined ? e.selective : true,
                insertion_order: e.insertion_order || 100,
                enabled: true,
                position: topPosStr,
                use_regex: e.use_regex !== undefined ? e.use_regex : true,
                extensions: {
                  position: posNum,
                  exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : false,
                  display_index: i,
                  probability: ext.probability !== undefined ? ext.probability : 100,
                  useProbability: useProbVal,
                  depth: ext.depth !== undefined ? ext.depth : 4,
                  selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : 0,
                  outlet_name: '',
                  group: ext.group || '',
                  group_override: false,
                  group_weight: groupWeightVal,
                  prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : false,
                  delay_until_recursion: delayUntilRecVal,
                  scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : (e.constant ? 0 : 5),
                  match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
                  use_group_scoring: false,
                  case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
                  automation_id: '',
                  role: ext.role !== undefined ? ext.role : 0,
                  vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
                  sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
                  cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
                  delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
                  triggers: [],
                  ignore_budget: false
                }
              };
            })
          }, null, 2);
        }

        doc.getElementById('formatV3').addEventListener('click', function() {
          currentFormat = 'v3';
          jsonOutput.value = jsonStr;
        });
        doc.getElementById('formatV2').addEventListener('click', function() {
          currentFormat = 'v2';
          jsonOutput.value = buildV2Card(cardData);
        });
        doc.getElementById('formatLorebook').addEventListener('click', function() {
          currentFormat = 'lorebook';
          jsonOutput.value = buildLorebook(cardData);
        });

        function closeModal() {
          try { modal.remove(); } catch(e) {}
          doc.removeEventListener('keydown', escHandler);
        }
        function escHandler(e) { if (e.key === 'Escape') closeModal(); }
        doc.addEventListener('keydown', escHandler);
        modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
        doc.getElementById('closeJsonModal').addEventListener('click', closeModal);
        doc.getElementById('copyJson').addEventListener('click', function() {
          var ta = doc.getElementById('jsonOutput');
          ta.select();
          try { doc.execCommand('copy'); showToast('已复制到剪贴板', 'success'); }
          catch(e) { showToast('复制失败，请手动选择', 'error'); }
        });
        doc.getElementById('downloadJson').addEventListener('click', function() {
          var ta = doc.getElementById('jsonOutput');
          var content = ta ? ta.value : jsonStr;
          if (!content || content.length === 0) {
            showToast('内容为空，无法下载', 'error');
            return;
          }
          var fileName = (cardData.name || 'ModelO角色卡').replace(/[<>:"/\\|?*]/g, '_') + '.json';

          var done = false;

          function tryDownload() {
            if (done) return;
            try {
              var blob = new Blob([content], {type: 'application/json;charset=utf-8'});
              var url = URL.createObjectURL(blob);
              var a = doc.createElement('a');
              a.href = url;
              a.download = fileName;
              a.style.display = 'none';
              doc.body.appendChild(a);
              a.click();
              setTimeout(function() {
                try { doc.body.removeChild(a); } catch(_) {}
                try { URL.revokeObjectURL(url); } catch(_) {}
              }, 5000);
              done = true;
              showToast('下载已开始', 'success');
            } catch(e) { console.warn('blob download failed:', e); }
          }

          function tryParentBlob() {
            if (done) return;
            try {
              var pw = window.parent;
              if (pw && pw !== window) {
                var pBlob = new (pw.Blob)([content], {type: 'application/json;charset=utf-8'});
                var pUrl = (pw.URL || pw.webkitURL).createObjectURL(pBlob);
                var pa = pw.document.createElement('a');
                pa.href = pUrl;
                pa.download = fileName;
                pa.style.display = 'none';
                pw.document.body.appendChild(pa);
                pa.click();
                setTimeout(function() {
                  try { pw.document.body.removeChild(pa); } catch(_) {}
                  try { (pw.URL || pw.webkitURL).revokeObjectURL(pUrl); } catch(_) {}
                }, 5000);
                done = true;
                showToast('下载已开始', 'success');
              }
            } catch(e) { console.warn('parent blob download failed:', e); }
          }

          function tryDataUrl() {
            if (done) return;
            try {
              var dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(content);
              window.open(dataUrl, '_blank');
              done = true;
              showToast('已在新窗口打开，请另存为', 'info');
            } catch(e) { console.warn('dataUrl open failed:', e); }
          }

          tryParentBlob();
          if (!done) tryDownload();
          if (!done) tryDataUrl();
          if (!done) {
            showToast('下载失败，请使用复制按钮', 'error');
          }
        });
      }

      renderWelcome();

    } catch(e) {
      console.error('ModelO Generator Error:', e);
      showToast('打开失败: ' + e.message, 'error');
    }
  }

  function registerButton() {
    try {
      var evtOn = typeof eventOn === 'function' ? eventOn : (typeof window.eventOn === 'function' ? window.eventOn : null);
      var getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : (typeof window.getButtonEvent === 'function' ? window.getButtonEvent : null);
      if (evtOn && getBtnEvt) {
        evtOn(getBtnEvt('ModelO角色卡生成器'), function() { openEditor(); });
        return true;
      }
    } catch(e) {}
    return false;
  }

  function addFloatingButton() {
    try {
      var pDoc = (window.parent && window.parent.document) ? window.parent.document : document;
      var old = pDoc.getElementById(SCRIPT_ID + '-btn');
      if (old) old.remove();
      var btn = pDoc.createElement('button');
      btn.id = SCRIPT_ID + '-btn';
      btn.textContent = '⚡ ModelO';
      btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99998;padding:10px 18px;background:linear-gradient(135deg,#f78166,#da6152);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 4px 15px rgba(247,129,102,.4);transition:all .3s;font-size:14px;';
      btn.onmouseover = function() { btn.style.transform = 'scale(1.05)'; };
      btn.onmouseout = function() { btn.style.transform = 'scale(1)'; };
      btn.onclick = openEditor;
      pDoc.body.appendChild(btn);
      return true;
    } catch(e) { return false; }
  }

  var retryCount = 0;
  function tryInit() {
    if (registerButton()) { return; }
    if (retryCount < 10) { retryCount++; setTimeout(tryInit, 500); }
    else { addFloatingButton(); }
  }

  window.addEventListener('pagehide', closeModal);
  tryInit();
})();
