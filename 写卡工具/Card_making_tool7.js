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
        iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;border:none;z-index:99999;background:#f6f2ea;';
        iframe.addEventListener('load', function() {
          try {
            var d = iframe.contentDocument || iframe.contentWindow.document;
            var s = d.createElement('style');
            s.textContent = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;width:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f2ea;color:#57503f;font-size:14px}
.app{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0)}
.topbar{flex-shrink:0;display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#fffdf8;border-bottom:1px solid #e6dfd0;min-height:46px}
.topbar h1{font-size:1em;color:#8a6d3b;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar .phase{font-size:.75em;color:#b89968;margin-left:8px;flex-shrink:0}
.main{flex:1 1 0;display:flex;min-height:0;overflow:hidden}
.chat-panel{flex:1.4 1 0;display:flex;flex-direction:column;min-width:0;border-right:1px solid #e6dfd0;min-height:0;overflow:hidden}
.preview-panel{flex:1 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:#f9f5ed}
.chat-header{flex-shrink:0;padding:8px 14px;background:#fffdf8;border-bottom:1px solid #efe9dc;font-size:.78em;color:#8a6d3b;display:flex;align-items:center;gap:5px}
.chat-messages{flex:1 1 0;overflow-y:auto;padding:12px 8px;min-height:0;-webkit-overflow-scrolling:touch}
.chat-msg{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;align-items:flex-start}
.chat-msg.user{align-items:flex-end}
.chat-msg .avatar{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.chat-msg.assistant .avatar{background:#efe7d6}
.chat-msg.user .avatar{background:#e6dcc6}
.chat-msg .bubble{max-width:82%;padding:9px 13px;border-radius:12px;font-size:.85em;line-height:1.6;word-break:break-word}
.chat-msg.assistant .bubble{background:transparent;border:none;color:#57503f;font-size:1em;padding:2px 0;max-width:100%;width:100%}
.chat-msg.user .bubble{background:#fffdf8;border:1px solid #e6dfd0;color:#57503f;border-bottom-right-radius:4px}
.chat-msg .bubble b{color:#8a6d3b}
.chat-msg .bubble code{background:#efe7d6;padding:1px 5px;border-radius:4px;font-size:.82em;color:#8a6d3b}
.chat-msg .bubble pre{background:#f9f5ed;border:1px solid #e6dfd0;border-radius:8px;padding:8px;overflow-x:auto;font-size:1em;margin:6px 0;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.html-render-frame{display:block;margin:6px 0}
.typing{color:#8c8472;font-style:italic;font-size:.8em;padding:4px 8px}
.typing span{display:inline-block;animation:blink 1.4s infinite;color:#b89968}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
.quick-actions{flex-shrink:0;display:flex;gap:5px;padding:7px 10px;flex-wrap:wrap;align-items:center;border-top:1px solid #efe9dc;background:#fffdf8;max-height:100px;overflow-y:auto}
.quick-btn{padding:4px 9px;background:#f9f5ed;color:#8c8472;border:1px solid #e6dfd0;border-radius:7px;cursor:pointer;font-size:10.5px;transition:all .2s;white-space:nowrap;flex-shrink:0}
.quick-btn:hover:not(:disabled){background:#fffdf8;color:#8a6d3b;border-color:#d4c4a4}
.quick-btn.hl{border-color:#c9b48f;color:#8a6d3b;background:#f3ead8}
.quick-btn.hl:hover:not(:disabled){background:#fffdf8;color:#8a6d3b;border-color:#d4c4a4}
.quick-btn:disabled{opacity:.4;cursor:not-allowed}
.qa-mini{margin-left:auto;padding:4px 9px;background:#f9f5ed;color:#8c8472;border:1px solid #e6dfd0;border-radius:7px;cursor:pointer;font-size:11px;line-height:1;transition:all .2s;flex-shrink:0}
.qa-mini+.qa-mini{margin-left:0}
.qa-mini:hover:not(:disabled){background:#fffdf8;color:#8a6d3b;border-color:#d4c4a4}
.qa-mini:disabled{opacity:.4;cursor:not-allowed}
.chat-input-area{flex-shrink:0;padding:10px 12px;border-top:1px solid #efe9dc;background:#fffdf8}
.chat-input-row{display:flex;gap:8px;align-items:flex-end}
.chat-input{width:100%;padding:9px 13px;background:#f9f5ed;border:1px solid #e6dfd0;border-radius:10px;color:#57503f;font-size:14px;resize:none;min-height:40px;max-height:90px;font-family:inherit;line-height:1.4}
.chat-input-row .chat-input{flex:1;width:auto}
.chat-input:focus{outline:none;border-color:#c9b48f;box-shadow:0 0 0 3px rgba(184,153,104,.12)}
.chat-input:disabled{opacity:.5}
.btn-send{flex-shrink:0;width:40px;height:40px;border:none;border-radius:10px;background:#b89968;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.btn-send:hover:not(:disabled){background:#a8895a}
.btn-send:disabled{background:#d4c4a4;cursor:not-allowed}
.btn-send svg{display:block}
.send-spinner{animation:spin 0.8s linear infinite}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.chat-send-row{display:flex;gap:6px;margin-top:6px}
.btn{padding:7px 14px;border:none;border-radius:8px;font-size:.8em;cursor:pointer;font-weight:600;transition:all .2s}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:#b89968;color:#fff}
.btn-primary:hover:not(:disabled){background:#a8895a}
.btn-success{background:#8ba888;color:#fff}
.btn-success:hover:not(:disabled){background:#7a9778}
.btn-ghost{background:#f9f5ed;color:#8c8472;border:1px solid #e6dfd0}
.btn-ghost:hover:not(:disabled){background:#fffdf8;color:#8a6d3b;border-color:#d4c4a4}
.btn-warn{background:#cf9f5e;color:#fff}
.btn-warn:hover:not(:disabled){background:#bd8e4d}
.btn-danger{background:#c98b7a;color:#fff}
.btn-danger:hover:not(:disabled){background:#b87a69}
.preview-header{flex-shrink:0;padding:8px 14px;background:#fffdf8;border-bottom:1px solid #efe9dc;font-size:.78em;color:#8a6d3b;display:flex;justify-content:space-between;align-items:center}
.preview-body{flex:1;overflow-y:auto;padding:10px;min-height:0;-webkit-overflow-scrolling:touch}
.pv-section{background:#fffdf8;border:1px solid #efe9dc;border-radius:8px;padding:9px 11px;margin-bottom:8px}
.pv-section h3{font-size:.78em;color:#8a6d3b;margin-bottom:5px;display:flex;align-items:center;gap:4px;justify-content:space-between}
.pv-section h3 .sec-left{display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-section h3 .sec-right{font-size:.68em;color:#8c8472;font-weight:400;flex-shrink:0}
.pv-section .pv-content{font-size:.75em;color:#8c8472;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.pv-section.collapsed .pv-content,.pv-section.collapsed .pv-entry-list,.pv-section.collapsed .pv-sub{max-height:0;overflow:hidden;margin:0;padding:0}
.pv-section .pv-toggle{cursor:pointer;font-size:.68em;color:#b3aa98;user-select:none;flex-shrink:0;padding:0 4px}
.pv-section .pv-toggle::before{content:'▾';display:inline-block;transition:transform .2s}
.pv-section.collapsed .pv-toggle::before{transform:rotate(-90deg)}
.pv-section .pv-empty{color:#b3aa98;font-style:italic;font-size:.72em}
.pv-section .pv-entry{background:#f9f5ed;padding:5px 8px;border-radius:5px;margin-bottom:4px;border-left:2px solid #c9b48f}
.pv-section .pv-entry-title{font-size:.72em;color:#8a6d3b;font-weight:600;margin-bottom:2px}
.pv-section .pv-entry-content{font-size:.7em;color:#8c8472;white-space:pre-wrap;word-break:break-word;line-height:1.5}
.pv-section .pv-code{font-family:Consolas,Menlo,monospace;font-size:.68em;color:#57503f;background:#f9f5ed;border:1px solid #efe9dc;border-radius:5px;padding:6px 8px;white-space:pre-wrap;word-break:break-all;line-height:1.45;max-height:260px;overflow:auto}
.pv-section .pv-code.muted{color:#8c8472;background:#f9f5ed}
.pv-section .pv-tag{display:inline-block;font-size:.62em;padding:1px 6px;border-radius:4px;background:#f3ead8;color:#8a6d3b;border:1px solid #e6dcc6;margin:0 3px 3px 0;white-space:nowrap}
.pv-section .pv-tag.off{color:#b3aa98;background:#f9f5ed;border-color:#efe9dc}
.pv-section .pv-tag.ok{color:#8ba888;background:rgba(139,168,136,.12);border-color:rgba(139,168,136,.3)}
.pv-section .pv-mini-btn{font-size:.66em;padding:2px 8px;border-radius:5px;border:1px solid #e6dcc6;background:#f9f5ed;color:#8a6d3b;cursor:pointer;flex-shrink:0}
.pv-section .pv-mini-btn:hover{background:#fffdf8;border-color:#d4c4a4}
.pv-sub{margin-top:4px}
.pv-book-name{font-size:.72em;color:#8a6d3b;background:#f3ead8;padding:2px 7px;border-radius:5px;cursor:pointer;border:1px dashed transparent;transition:all .2s;display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-book-name:hover{border-color:#c9b48f}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;flex-shrink:0}
.dot.full{background:#8ba888}
.dot.empty{background:#d4c4a4}
.progress-bar{height:4px;background:#efe9dc;border-radius:2px;overflow:hidden;margin:4px 0}
.progress-bar-fill{height:100%;background:linear-gradient(90deg,#b89968,#c9b48f);transition:width .3s}
.module-progress{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px}
.module-item{font-size:.65em;padding:3px 5px;background:#f9f5ed;border-radius:4px;text-align:center}
.module-item.done{color:#8ba888;border:1px solid rgba(139,168,136,.3)}
.module-item.partial{color:#cf9f5e;border:1px solid rgba(207,159,94,.3)}
.module-item.todo{color:#b3aa98;border:1px solid #efe9dc}
.close-btn{position:fixed;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:#fffdf8;border:1px solid #e6dfd0;color:#8a6d3b;font-size:1em;cursor:pointer;z-index:100000;display:flex;align-items:center;justify-content:center;transition:all .3s;flex-shrink:0}
.close-btn:hover{background:#c98b7a;color:#fff;border-color:#c98b7a;transform:rotate(90deg)}
.json-modal,.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(74,67,56,.5);display:flex;align-items:center;justify-content:center;z-index:100001}
.json-modal-content,.modal-content{background:#fffdf8;border:1px solid #e6dfd0;border-radius:12px;padding:14px;width:90%;max-width:800px;max-height:85vh;display:flex;flex-direction:column}
.json-modal-content textarea{width:100%;flex:1;background:#f9f5ed;border:1px solid #e6dfd0;border-radius:8px;color:#57503f;font-family:'Consolas',monospace;font-size:.75em;padding:8px;resize:none;min-height:250px}
.modal-body{flex:1;overflow-y:auto;min-height:200px}
.welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;overflow:auto}
.welcome h2{font-size:1.4em;color:#8a6d3b;margin-bottom:14px}
.welcome p{color:#8c8472;font-size:.88em;line-height:1.8;max-width:460px;margin-bottom:20px}
.welcome .start-btn{padding:12px 32px;background:#b89968;color:#fff;border:none;border-radius:24px;font-size:.95em;font-weight:600;cursor:pointer;transition:all .3s}
.welcome .start-btn:hover{transform:translateY(-2px);background:#a8895a;box-shadow:0 6px 20px rgba(184,153,104,.25)}
.welcome-features{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:16px 0;max-width:460px}
.wf-item{background:#fffdf8;border:1px solid #efe9dc;border-radius:10px;padding:10px;text-align:left}
.wf-icon{font-size:1.3em;margin-bottom:4px}
.wf-title{font-size:.8em;color:#8a6d3b;font-weight:600;margin-bottom:2px}
.wf-desc{font-size:.68em;color:#8c8472;line-height:1.4}
.qc-item{background:#f9f5ed;border:1px solid #efe9dc;border-radius:8px;padding:8px 10px;margin-bottom:6px}
.qc-item.pass{border-color:rgba(139,168,136,.4)}
.qc-item.fail{border-color:rgba(201,139,122,.45);background:rgba(201,139,122,.06)}
.qc-title{font-size:.78em;font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:3px}
.qc-pass{color:#8ba888}
.qc-fail{color:#c98b7a}
.qc-desc{font-size:.7em;color:#8c8472;line-height:1.5}
.qc-fix{font-size:.68em;color:#cf9f5e;margin-top:3px}
.opt-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.opt-pane{background:#f9f5ed;border:1px solid #e6dfd0;border-radius:8px;padding:8px;font-size:.72em;line-height:1.5;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.opt-pane.before{border-color:#e6dfd0}
.opt-pane.after{border-color:rgba(139,168,136,.4)}
.opt-label{font-size:.68em;font-weight:600;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #efe9dc}
.opt-label.before{color:#8c8472}
.opt-label.after{color:#8ba888}
.opt-field-select{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.opt-field-tag{padding:3px 8px;background:#f9f5ed;border:1px solid #e6dfd0;border-radius:5px;font-size:.7em;cursor:pointer;transition:all .2s}
.opt-field-tag.selected{background:#f3ead8;border-color:#c9b48f;color:#8a6d3b}
.modal-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid #efe9dc;flex-shrink:0}
.sb-wrap{display:block;margin-top:8px;padding:10px;background:#f9f5ed;border-radius:8px;font-size:.88em;line-height:1.55;border:1px solid #efe9dc}
.sb-wrap .sb-header{font-size:.95em;color:#cf9f5e;margin-bottom:8px;font-weight:600;text-align:center}
.sb-wrap .sb-section{margin-bottom:4px}
.sb-wrap .sb-summary{cursor:pointer;font-weight:600;color:#8a6d3b;font-size:1em;padding:3px 0;user-select:none}
.sb-wrap .sb-summary::before{content:'▼ ';font-size:.7em;margin-right:2px;transition:transform .2s;display:inline-block}
.sb-wrap .sb-section:not(.open) .sb-summary::before{transform:rotate(-90deg)}
.sb-wrap .sb-content{padding:3px 0 3px 8px;color:#8c8472}
.sb-wrap .sb-field{display:flex;padding:2px 0;border-bottom:1px solid rgba(184,153,104,.08)}
.sb-wrap .sb-field:last-child{border-bottom:none}
.sb-wrap .sb-field-label{color:#8a6d3b;font-weight:600;flex-shrink:0}
.sb-wrap .sb-field-value{color:#8c8472}
.sb-wrap details{margin-bottom:6px}
.sb-wrap summary{cursor:pointer;font-weight:600;color:#8a6d3b;font-size:.95em;padding:3px 0;list-style:none}
.sb-wrap summary::-webkit-details-marker{display:none}
.sb-wrap summary::before{content:'▼ ';font-size:.7em;margin-right:2px;transition:transform .2s;display:inline-block}
.sb-wrap details[open] summary::before{transform:rotate(0deg)}
.sb-wrap details:not([open]) summary::before{transform:rotate(-90deg)}
.sb-wrap ul{margin:4px 0 4px 18px;padding:0}
.sb-wrap ol{margin:4px 0 4px 20px;padding:0}
.sb-wrap li{margin:2px 0;color:#8c8472;font-size:.95em;line-height:1.5}
.sb-wrap li b{color:#57503f}
.sb-wrap p{margin:3px 0;color:#8c8472;font-size:.95em}
.sb-wrap p b{color:#8a6d3b}
.sb-wrap .sb-btn{display:inline-block;padding:4px 10px;margin:2px 3px;background:#fffdf8;border:1px solid #e6dfd0;border-radius:14px;font-size:.88em;color:#57503f;cursor:pointer;transition:all .15s}
.sb-wrap .sb-btn:active{background:#b89968;color:#fff;border-color:#b89968}

.mod-dash{display:block;margin:8px 0;background:#fffdf8;border:1px solid #efe9dc;border-radius:8px;overflow:hidden}
.mod-dash .md-header{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;cursor:pointer;user-select:none;font-size:.75em;color:#8a6d3b}
.mod-dash .md-analyze-btn{font-size:.65em;padding:2px 6px;border-radius:4px;background:#f3ead8;border:1px solid #e6dcc6;color:#8a6d3b;cursor:pointer;transition:all .15s;white-space:nowrap}
.mod-dash .md-analyze-btn:hover{background:#fffdf8;border-color:#d4c4a4}
.mod-dash .md-analyze-btn:active{background:#f3ead8}
.mod-dash .md-header .md-arrow{font-size:.65em;transition:transform .2s;color:#8c8472}
.mod-dash.collapsed .md-header .md-arrow{transform:rotate(-90deg)}
.mod-dash .md-body{padding:0 10px 8px;transition:max-height .3s ease;max-height:420px;overflow-y:auto}
.mod-dash.collapsed .md-body{max-height:0;padding-top:0;padding-bottom:0}
.mod-dash-item{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:.7em;cursor:pointer;padding:3px 5px;border-radius:5px;transition:background .15s}
.mod-dash-item:hover{background:#f9f5ed}
.mod-dash-item .m-icon{width:16px;text-align:center;flex-shrink:0}
.mod-dash-item .m-name{width:52px;flex-shrink:0;color:#8c8472;font-size:.65em}
.mod-dash-item .m-bar-wrap{flex:1;height:4px;background:#f9f5ed;border-radius:2px;overflow:hidden;display:block}
.mod-dash-item .m-bar{height:100%;border-radius:2px;transition:width .4s ease;display:block}
.mod-dash-item .m-bar.done{background:#8ba888}
.mod-dash-item .m-bar.prog{background:#c9b48f}
.mod-dash-item .m-bar.empty{background:#e6dfd0}
.mod-dash-item .m-pct{width:28px;text-align:right;font-size:.6em;color:#8c8472;flex-shrink:0}

.chat-input-char-count{font-size:.65em;color:#b3aa98;text-align:right;padding:2px 6px 0;transition:color .2s}
.chat-input-char-count.warn{color:#cf9f5e}
.chat-input-char-count.over{color:#c98b7a}

.send-btn-pulse{animation:pulse-send 2s infinite;box-shadow:0 0 8px rgba(184,153,104,.3)}
@keyframes pulse-send{0%,100%{box-shadow:0 0 4px rgba(184,153,104,.2)}50%{box-shadow:0 0 12px rgba(184,153,104,.4),0 0 20px rgba(201,180,143,.2)}}

.welcome-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center}
.welcome-actions .btn{flex:1;min-width:120px;max-width:180px}

.scroll-btns{position:absolute;right:12px;bottom:8px;display:flex;flex-direction:column;gap:3px;z-index:10;opacity:0;transition:opacity .2s;pointer-events:none}
.scroll-btns.show{opacity:1;pointer-events:auto}
.scroll-btns button{width:22px;height:22px;border-radius:50%;background:#fffdf8;border:1px solid #e6dfd0;color:#8c8472;font-size:.65em;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1}
.scroll-btns button:active{background:#b89968;color:#fff;border-color:#b89968}

.import-dropzone{padding:20px;text-align:center;border:2px dashed #d4c4a4;border-radius:10px;margin-bottom:10px;cursor:pointer;transition:all .2s}
.import-dropzone:hover{border-color:#b89968;background:rgba(184,153,104,.05)}
.import-dropzone .dz-icon{font-size:2em;margin-bottom:6px}
.import-dropzone .dz-text{font-size:.78em;color:#8c8472}
.import-tabs{display:flex;gap:4px;margin-bottom:10px}
.import-tab{flex:1;padding:6px 8px;background:#f9f5ed;border:1px solid #efe9dc;border-radius:7px;font-size:.72em;color:#8c8472;cursor:pointer;text-align:center;transition:all .15s}
.import-tab.active{background:#f3ead8;border-color:#c9b48f;color:#8a6d3b}

.entry-detail{display:none;margin-top:6px;padding:8px;background:#f9f5ed;border-radius:5px;font-size:.68em}
.entry-detail.open{display:block}
.entry-detail .ext-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:4px}
.entry-detail .ext-item{text-align:center}
.entry-detail .ext-item label{display:block;color:#b3aa98;font-size:.6em;margin-bottom:2px}
.entry-detail .ext-item input,.entry-detail .ext-item select{width:100%;padding:2px 3px;background:#fffdf8;border:1px solid #efe9dc;border-radius:4px;color:#57503f;font-size:.65em;text-align:center;outline:none}
.mod-focus{display:flex;flex-wrap:nowrap;gap:4px;padding:5px 10px;flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;border-bottom:1px solid #efe9dc;background:#fffdf8}
.mod-focus::-webkit-scrollbar{height:0}
.mod-focus-btn{padding:4px 10px;background:#f9f5ed;border:1px solid #e6dfd0;border-radius:14px;font-size:.7em;color:#8c8472;cursor:pointer;white-space:nowrap;transition:all .15s;flex-shrink:0}
.mod-focus-btn:active,.mod-focus-btn.active{background:#b89968;color:#fff;border-color:#b89968}

.wv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
.wv-stat{background:#f9f5ed;border:1px solid #efe9dc;border-radius:8px;padding:6px 8px;text-align:center}
.wv-stat .wv-stat-val{font-size:1.1em;font-weight:700;display:block}
.wv-stat .wv-stat-lbl{font-size:.62em;color:#8c8472;display:block;margin-top:2px}
.wv-legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;font-size:.65em}
.wv-legend-item{display:flex;align-items:center;gap:3px;color:#8c8472}
.wv-legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.wv-entry{background:#f9f5ed;border:1px solid #efe9dc;border-radius:8px;padding:6px 8px;margin-bottom:6px;border-left:3px solid #c9b48f}
.wv-entry-header{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.wv-entry-name{font-size:.78em;font-weight:600;color:#57503f;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-entry-level{font-size:.6em;padding:1px 6px;border-radius:4px;font-weight:600;white-space:nowrap}
.wv-entry-token{font-size:.62em;color:#8c8472;flex-shrink:0}
.wv-entry-meta{display:flex;flex-wrap:wrap;gap:4px;font-size:.6em;color:#8c8472}
.wv-entry-meta .wv-tag{background:#fffdf8;border:1px solid #efe9dc;border-radius:4px;padding:1px 5px;white-space:nowrap}
.wv-entry-meta .wv-tag.const{color:#8ba888;border-color:rgba(139,168,136,.3)}
.wv-entry-meta .wv-tag.trig{color:#8a6d3b;border-color:rgba(184,153,104,.3)}
.wv-entry-meta .wv-tag.dyn{color:#cf9f5e;border-color:rgba(207,159,94,.3)}
.wv-entry-meta .wv-tag.warn{color:#c98b7a;border-color:rgba(201,139,122,.3)}
.wv-group-header{font-size:.7em;font-weight:600;color:#8a6d3b;margin:8px 0 4px;padding-bottom:3px;border-bottom:1px solid #efe9dc;display:flex;justify-content:space-between;align-items:center}
.wv-group-count{font-size:.85em;color:#8c8472;font-weight:400}


.group-mgr-list{margin:8px 0}
.group-mgr-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#f9f5ed;border:1px solid #efe9dc;border-radius:6px;margin-bottom:4px;font-size:.72em}
.group-mgr-item .gm-color{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.group-mgr-item .gm-name{flex:1;color:#57503f;font-weight:600}
.group-mgr-item .gm-count{color:#8c8472;font-size:.85em}
.group-mgr-item .gm-toggle{padding:2px 8px;border-radius:4px;font-size:.85em;cursor:pointer;border:1px solid #e6dfd0;background:#fffdf8;color:#8c8472}
.group-mgr-item .gm-toggle.on{background:rgba(139,168,136,.15);color:#8ba888;border-color:rgba(139,168,136,.3)}
.mobile-tabs{display:none;flex-shrink:0;background:#fffdf8;border-bottom:1px solid #e6dfd0}
.mobile-tab{flex:1;padding:9px 12px;background:transparent;border:none;color:#8c8472;font-size:.85em;cursor:pointer;text-align:center;border-bottom:2px solid transparent;transition:all .15s;font-weight:500}
.mobile-tab.active{color:#b89968;border-bottom-color:#b89968;background:rgba(184,153,104,.06)}
@media(max-width:768px){
  .main{flex-direction:column}
  .mobile-tabs{display:flex}
  .chat-panel,.preview-panel{flex:1 1 0;border:none;min-height:0}
  .preview-panel{display:none}
  .main.tab-preview .preview-panel{display:flex}
  .main.tab-preview .chat-panel{display:none}
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
  .btn-send{width:34px;height:34px}
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
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#d4c4a4;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#c9b48f}
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

  // ===== MVU 美化正则 HTML 模板（纯CSS+emoji实现，无外部依赖）=====
  var MVU_BEAUTIFY_COMPLETE = '<div style="text-align:center;margin:10px 0">\n<div style="display:inline-block;text-align:left">\n  <details class="mvu-done" style="border:none;background:none">\n    <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:0;position:relative;padding:0">\n      <span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:2px solid rgba(76,175,80,0.5);box-shadow:0 0 10px rgba(76,175,80,0.25);flex-shrink:0;z-index:3;position:relative;animation:mvu-done-pulse 2s ease-in-out infinite;background:linear-gradient(135deg,#e8f5e9 0%,#c8e6c9 100%);font-size:22px">✓</span>\n      <span style="display:flex;align-items:center;height:32px;margin-left:-10px;padding:0 20px 0 18px;background:linear-gradient(135deg,#e8f5e9 0%,#d7ecd9 50%,#e8f5e9 100%);border:1.5px solid rgba(76,175,80,0.35);border-radius:0 16px 16px 0;position:relative;z-index:2">\n        <span style="flex:1;font-size:0.9em;font-weight:600;background:linear-gradient(90deg,#2e7d32,#43a047,#2e7d32);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:mvu-text-shimmer 3s linear infinite">变量已更新</span>\n        <small style="color:#2e7d32;font-size:0.75em;opacity:0.7"><span class="mvu-toggle" data-close="展开 ▶" data-open="收起 ▼"></span></small>\n      </span>\n    </summary>\n    <div style="max-height:320px;overflow-y:auto;margin-left:22px;margin-top:6px;padding:12px 18px;color:#33691e;line-height:1.8;white-space:pre-wrap;background:linear-gradient(135deg,rgba(232,245,233,0.7) 0%,rgba(200,230,201,0.4) 100%);border:1.5px solid rgba(76,175,80,0.25);border-radius:12px;font-size:0.9em;max-width:450px">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n<style>.mvu-done summary::marker{display:none}.mvu-done[open]>div{animation:mvu-slide-in .4s ease forwards}.mvu-done[open] .mvu-toggle::after{content:attr(data-open)}.mvu-done:not([open]) .mvu-toggle::after{content:attr(data-close)}@keyframes mvu-done-pulse{0%,100%{transform:scale(1);box-shadow:0 0 10px rgba(76,175,80,0.25)}50%{transform:scale(1.05);box-shadow:0 0 16px rgba(76,175,80,0.4)}}@keyframes mvu-text-shimmer{0%{background-position:0% center}100%{background-position:200% center}}@keyframes mvu-slide-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}</style>';

  var MVU_BEAUTIFY_THINKING = '<div style="text-align:center;margin:10px 0">\n<div style="display:inline-block;text-align:left">\n  <details class="mvu-thinking" style="border:none;background:none">\n    <summary style="list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:0;position:relative;padding:0">\n      <span style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;border:2px solid rgba(33,150,243,0.5);box-shadow:0 0 10px rgba(33,150,243,0.25);flex-shrink:0;z-index:3;position:relative;animation:mvu-spin 1.8s linear infinite;background:linear-gradient(135deg,#e3f2fd 0%,#bbdefb 100%);font-size:20px">⟳</span>\n      <span style="display:flex;align-items:center;height:32px;margin-left:-10px;padding:0 20px 0 18px;background:linear-gradient(135deg,#e3f2fd 0%,#d0e9fc 50%,#e3f2fd 100%);border:1.5px solid rgba(33,150,243,0.35);border-radius:0 16px 16px 0;position:relative;z-index:2;overflow:hidden">\n        <span style="flex:1;font-size:0.9em;font-weight:600;background:linear-gradient(90deg,#1565c0,#1976d2,#1565c0);-webkit-background-clip:text;-webkit-text-fill-color:transparent">变量更新中</span>\n        <span class="mvu-blue-glow" style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(90deg,transparent 0%,rgba(33,150,243,0.1) 50%,transparent 100%);animation:mvu-blue-sweep 2.5s linear infinite;transform:translateX(-100%);pointer-events:none"></span>\n      </span>\n    </summary>\n    <div style="max-height:320px;overflow-y:auto;margin-left:22px;margin-top:6px;padding:12px 18px;color:#0d47a1;line-height:1.8;white-space:pre-wrap;background:linear-gradient(135deg,rgba(227,242,253,0.7) 0%,rgba(187,222,251,0.4) 100%);border:1.5px solid rgba(33,150,243,0.25);border-radius:12px;font-size:0.9em;max-width:450px">\n    $1\n    </div>\n  </details>\n</div>\n</div>\n<style>.mvu-thinking summary::marker{display:none}.mvu-thinking[open]>div{animation:mvu-content-in .4s ease forwards}.mvu-thinking[open] summary .mvu-blue-glow{animation:none!important;opacity:0}@keyframes mvu-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}@keyframes mvu-blue-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes mvu-content-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}</style>';

  // ===== MVU 状态栏 HTML 模板（精美版：低饱和柔灰蓝+毛玻璃+网格布局）=====
  // 用途：渲染 <StatusPlaceHolderImpl/> 占位符为可视化状态栏
  // 配套正则：markdownOnly=true, promptOnly=false, 将占位符替换为此HTML
  // 设计要点（对齐(6)号卡片的美观度标准）：
  //   1. 用 getAllVariables() + _.get(allVars,"stat_data",{}) 读变量（复用酒馆助手稳定API，避免Mvu.getVar时序失效）
  //   2. await waitGlobalInitialized('Mvu') 等待 MVU 模块就绪后再绑定事件
  //   3. $(errorCatched(init)) 全局异常捕获，报错不卡死面板
  //   4. 递归 renderTree(obj, level) 渲染任意深度嵌套对象，按层级缩进
  //   5. 跳过 _ / $ 开头的隐藏变量
  //   6. 严格 typeof val === "number" 检测数值，布尔用 ✓/✕，数组元素独立渲染
  //   7. 分类标题(category-title)带▸图标+底部分隔线，stat-grid自动适应网格布局
  //   8. 深色毛玻璃(backdrop-filter)+柔灰蓝配色护眼，hover高亮+刷新淡入动画
  //   9. <script type="module"> 支持顶层 async/await
  //  10. CSS变量改 :root 即可换主题（var(--accent-blue)等）
  var MVU_STATUS_BAR_HTML = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <style>\n* {\n    margin: 0;\n    padding: 0;\n    box-sizing: border-box;\n}\n\n/* 低饱和柔灰蓝配色 舒适护眼 深色毛玻璃主题 */\n:root {\n    --card-bg: rgba(30, 35, 45, 0.82);\n    --card-border: rgba(100, 116, 139, 0.28);\n    --text-main: #e2e8f0;\n    --text-sub: #94a3b8;\n    --accent-blue: #93c5fd;\n    --accent-green: #86efac;\n    --accent-red: #fca5a5;\n    --line-divider: rgba(148, 163, 184, 0.15);\n    --hover-bg: rgba(148, 163, 184, 0.08);\n}\n\n/* 外层卡片 */\n.mvu-status-card {\n    border: 1px solid var(--card-border);\n    border-radius: 8px;\n    background: var(--card-bg);\n    backdrop-filter: blur(6px);\n    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);\n    margin-bottom: 8px;\n    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;\n    font-size: 12px;\n    color: var(--text-main);\n    overflow: hidden;\n}\n\n/* 内容主体 */\n.card-body {\n    padding: 10px 12px;\n    line-height: 1.45;\n}\n\n/* 分类标题 */\n.category-title {\n    font-size: 12px;\n    font-weight: 600;\n    color: var(--accent-blue);\n    margin: 10px 0 6px;\n    display: flex;\n    align-items: center;\n    gap: 4px;\n    padding-bottom: 3px;\n    border-bottom: 1px solid var(--line-divider);\n}\n.category-title:first-child {\n    margin-top: 0;\n}\n.category-title::before {\n    content: "▸";\n    font-size: 10px;\n    opacity: 0.8;\n}\n\n/* 表格式网格布局 自动适应列数 增大最小列宽 避免挤压 */\n.stat-grid {\n    display: grid;\n    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));\n    gap: 4px 16px;\n}\n\n/* 单行状态项 顶部对齐 支持换行不重叠 */\n.stat-item {\n    display: flex;\n    align-items: flex-start;\n    justify-content: space-between;\n    padding: 4px 6px;\n    border-radius: 4px;\n    transition: background 0.2s ease;\n    gap: 8px;\n}\n.stat-item:hover {\n    background: var(--hover-bg);\n}\n\n/* 层级缩进 优化缩进量 避免挤占内容空间 */\n.indent-1 { padding-left: 8px; }\n.indent-2 { padding-left: 20px; }\n.indent-3 { padding-left: 32px; }\n.indent-4 { padding-left: 44px; }\n\n/* 左侧标签 自动换行 不强制单行 */\n.stat-label {\n    color: var(--text-sub);\n    flex: 1;\n    word-break: break-word;\n    overflow-wrap: break-word;\n}\n\n/* 右侧数值 右对齐 支持换行 不会被挤压消失 */\n.stat-value {\n    font-weight: 500;\n    text-align: right;\n    flex-shrink: 0;\n    max-width: 58%;\n    word-break: break-word;\n    overflow-wrap: break-word;\n}\n.value-number {\n    color: var(--accent-blue);\n    white-space: nowrap;\n}\n.value-true {\n    color: var(--accent-green);\n    white-space: nowrap;\n}\n.value-false {\n    color: var(--accent-red);\n    white-space: nowrap;\n}\n.value-text {\n    color: var(--text-main);\n}\n\n/* 加载状态 */\n.loading-state {\n    text-align: center;\n    padding: 16px 0;\n    color: var(--text-sub);\n    animation: breathe 2s ease-in-out infinite;\n}\n@keyframes breathe {\n    0%, 100% { opacity: 0.5; }\n    50% { opacity: 0.9; }\n}\n\n/* 刷新淡入动画 */\n.flash-update {\n    animation: fadeIn 0.3s ease-out;\n}\n@keyframes fadeIn {\n    from { opacity: 0.6; }\n    to { opacity: 1; }\n}\n  </style>\n  <script defer>\n(function() {\n  var ready = function(fn) {\n    if (document.readyState === \'complete\' || document.readyState === \'interactive\') {\n      setTimeout(fn, 0);\n    } else if (document.addEventListener) {\n      document.addEventListener(\'DOMContentLoaded\', fn);\n    } else {\n      document.attachEvent(\'onreadystatechange\', function() {\n        if (document.readyState === \'complete\') fn();\n      });\n    }\n  };\n  var ec = function(fn) {\n    return function() {\n      try {\n        var r = fn.apply(this, arguments);\n        if (r && r.catch) r.catch(function(e) { console.warn(\'[statusbar] async err:\', e); });\n        return r;\n      } catch(e) { console.warn(\'[statusbar] sync err:\', e); }\n    };\n  };\n  ready(ec(async function init() {\n    if (typeof waitGlobalInitialized === \'function\') { try { await waitGlobalInitialized(\'Mvu\'); } catch(_) {} }\n\n    function refreshStatus() {\n      var allVars = (typeof getAllVariables === \'function\') ? getAllVariables() : {};\n      var sourceData;\n      if (typeof _ !== \'undefined\' && _.get) {\n        sourceData = _.get(allVars, "stat_data", {});\n      } else {\n        sourceData = (allVars && allVars.stat_data) ? allVars.stat_data : {};\n      }\n      if (!sourceData || typeof sourceData !== \'object\') sourceData = {};\n      var htmlStr = \'\';\n\n      function renderTree(obj, level) {\n        level = level || 0;\n        var indentClass = \'indent-\' + Math.min(level, 4);\n        var itemsHtml = \'\';\n        var keys = Object.keys(obj || {});\n        for (var k = 0; k < keys.length; k++) {\n          var key = keys[k];\n          var value = obj[key];\n          if (key.indexOf(\'_\') === 0 || key.indexOf(\'$\') === 0) continue;\n          var isPlainObj = value !== null && typeof value === \'object\' && !Array.isArray(value)\n            && Object.prototype.toString.call(value) === \'[object Object]\';\n          if (isPlainObj) {\n            if (itemsHtml) {\n              htmlStr += \'<div class="stat-grid \' + indentClass + \'">\' + itemsHtml + \'</div>\';\n              itemsHtml = \'\';\n            }\n            if (level > 0) {\n              htmlStr += \'<div class="category-title \' + indentClass + \'">\' + key + \'</div>\';\n            }\n            renderTree(value, level + 1);\n            continue;\n          }\n          itemsHtml += \'<div class="stat-item"><span class="stat-label">\' + key + \'</span><span class="stat-value">\';\n          if (typeof value === \'number\') {\n            itemsHtml += \'<span class="value-number">\' + value + \'</span>\';\n          } else if (typeof value === \'boolean\') {\n            itemsHtml += value ? \'<span class="value-true">✓</span>\' : \'<span class="value-false">✕</span>\';\n          } else if (Array.isArray(value)) {\n            itemsHtml += \'<span class="value-text">[\' + value.join(\', \') + \']</span>\';\n          } else {\n            itemsHtml += \'<span class="value-text">\' + String(value == null ? \'\' : value) + \'</span>\';\n          }\n          itemsHtml += \'</span></div>\';\n        }\n        if (itemsHtml) htmlStr += \'<div class="stat-grid \' + indentClass + \'">\' + itemsHtml + \'</div>\';\n      }\n\n      renderTree(sourceData, 0);\n\n      var root = document.getElementById(\'render-root\') || document.querySelector(\'.card-body\') || document.body;\n      if (root) {\n        root.innerHTML = htmlStr;\n        try { root.classList.add(\'flash-update\'); } catch(_) {}\n        setTimeout(function() { try { root.classList.remove(\'flash-update\'); } catch(_) {} }, 300);\n      }\n    }\n\n    refreshStatus();\n    setTimeout(refreshStatus, 1000);\n    setTimeout(refreshStatus, 2500);\n    if (typeof eventOn === \'function\' && typeof Mvu !== \'undefined\' && Mvu && Mvu.events) {\n      try { eventOn(Mvu.events.VARIABLE_INITIALIZED, refreshStatus); } catch(_) {}\n      try { eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, refreshStatus); } catch(_) {}\n    }\n  }));\n})();\n  <\\/script>\n</head>\n<body>\n\n<div class="mvu-status-card">\n    <div class="card-body" id="render-root">\n        <div class="loading-state">正在加载状态数据...</div>\n    </div>\n</div>\n\n</body>\n</html>';

  var ENTRY_TEMPLATES = {
    '基础公理': { constant: true, selective: false, position: 0, depth: 0, order: 250, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '核心铁则': { constant: true, selective: false, position: 0, depth: 0, order: 250, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
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
    '自定义条目': { constant: false, selective: true, position: 1, depth: 4, order: 55, cooldown: null, delay: null, sticky: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 5, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100 },
    '[InitVar]初始变量': { constant: true, selective: false, position: 4, depth: 4, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100, enabled: false },
    '变量列表': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量更新规则': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量输出格式': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100 },
    '变量输出格式强调': { constant: true, selective: false, position: 4, depth: 0, order: 200, prevent_recursion: true, exclude_recursion: false, delay_until_recursion: 0, cooldown: null, delay: null, sticky: null, use_regex: true, match_whole_words: null, scan_depth: 0, selectiveLogic: 0, probability: 100, useProbability: false, group: '', group_weight: 100, enabled: false },
    '状态变量输出': { constant: false, selective: true, position: 2, depth: 2, order: 45, sticky: null, cooldown: null, delay: null, prevent_recursion: false, exclude_recursion: false, delay_until_recursion: 0, use_regex: true, match_whole_words: null, scan_depth: 3, selectiveLogic: 0, probability: 100, useProbability: true, group: '', group_weight: 100, secondary_keys: [] }
  };

  // ===== 权重等级映射（用于权重可视化预览） =====
  // 权重从低到高：极低/低/中低/中/中高/高/极高/最高
  // 注意：核心铁则通过post_history_instructions字段实现（最高权重），不在世界书条目中
  var WEIGHT_LEVELS = {
    '基础公理': { level: '极低', color: '#b3aa98', desc: 'position=0 常驻，世界元数据锚定' },
    '世界元数据': { level: '极低', color: '#b3aa98', desc: 'position=0 常驻，底层背景' },
    '交互软规则': { level: '低', color: '#8c8472', desc: 'position=1 常驻，角色卡之后注入' },
    '近场强约束': { level: '极高', color: '#c98b7a', desc: 'position=2 触发，用户输入之前' },
    '当前局势': { level: '极高', color: '#c98b7a', desc: 'position=2 触发，sticky粘性' },
    '场景机制': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发' },
    '核心玩法': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发' },
    '世界规则': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=4 触发' },
    '实体交互': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发，防递归' },
    '重要角色': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发，防递归' },
    '势力与组织': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发，防递归' },
    '物品': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发，防递归' },
    '地点场景': { level: '中高', color: '#cf9f5e', desc: 'position=1 depth=3 触发，防递归' },
    '叙事背景': { level: '中', color: '#8ba888', desc: 'position=4 depth=5 概率触发' },
    '故事发展': { level: '中', color: '#8ba888', desc: 'position=4 depth=5 概率触发' },
    '文化与习俗': { level: '中', color: '#8ba888', desc: 'position=4 depth=5 概率触发' },
    '历史事件': { level: '中', color: '#8ba888', desc: 'position=4 depth=6 概率触发' },
    '动态适配': { level: '中', color: '#8ba888', desc: 'position=1 depth=4 动态系统，按需加载' },
    '引导机制': { level: '中', color: '#8ba888', desc: 'position=1 depth=4 动态系统，按需加载' },
    '互动选项': { level: '中', color: '#8ba888', desc: 'position=1 depth=4 动态系统，按需加载' },
    '状态栏': { level: '极高', color: '#c98b7a', desc: 'position=2 depth=2 sticky粘性' },
    '统一输出格式': { level: '极低', color: '#b3aa98', desc: 'position=0 常驻' },
    '角色边界': { level: '极低', color: '#b3aa98', desc: 'position=0 常驻' },
    '禁止项': { level: '极低', color: '#b3aa98', desc: 'position=0 常驻，禁止规则' },
    '自定义条目': { level: '中', color: '#8ba888', desc: '用户自定义' },
    '[InitVar]初始变量': { level: '极低', color: '#b3aa98', desc: 'position=4(at_depth d=4) 常驻(enabled=false)，MVU变量初始化YAML' },
    '变量列表': { level: '极低', color: '#b3aa98', desc: 'position=4(at_depth d=0) 常驻，注入当前变量值给LLM' },
    '变量更新规则': { level: '低', color: '#8c8472', desc: 'position=4(at_depth d=0) 常驻，MVU变量更新分析规则' },
    '变量输出格式': { level: '低', color: '#8c8472', desc: 'position=4(at_depth d=0) 常驻，定义<UpdateVariable>输出格式' },
    '变量输出格式强调': { level: '低', color: '#8c8472', desc: 'position=4(at_depth d=0) 默认关闭，AI不输出<UpdateVariable>时启用' },
    '状态变量输出': { level: '中', color: '#8ba888', desc: 'position=2 触发，输出当前变量状态给LLM' }
  };


  function getEntryTemplate(comment) {
    if (!comment) return null;
    // 1. 支持 [InitVar]xxx 前缀格式（MVU变量系统，兼容大小写）
    var commentLower = comment.toLowerCase();
    if (commentLower.indexOf('[initvar]') === 0) {
      return ENTRY_TEMPLATES['[InitVar]初始变量'];
    }
    // 2. 支持 <xxx> 前缀格式（标准条目）
    var m = comment.match(/^<([^>]+)>/);
    if (m) {
      var key = m[1];
      if (ENTRY_TEMPLATES[key]) return ENTRY_TEMPLATES[key];
      var fuzzyMatch = Object.keys(ENTRY_TEMPLATES).find(function(k) { return key.indexOf(k) >= 0 || k.indexOf(key) >= 0; });
      if (fuzzyMatch) return ENTRY_TEMPLATES[fuzzyMatch];
    }
    // 3. 支持 MVU 变量系统条目（无需前缀，直接匹配关键字）
    if (commentLower.indexOf('[mvu_update]') >= 0) {
      if (comment.indexOf('变量更新规则') >= 0) return ENTRY_TEMPLATES['变量更新规则'];
      if (comment.indexOf('变量输出格式强调') >= 0) return ENTRY_TEMPLATES['变量输出格式强调'];
      if (comment.indexOf('变量输出格式') >= 0) return ENTRY_TEMPLATES['变量输出格式'];
    }
    if (comment.indexOf('变量列表') >= 0) return ENTRY_TEMPLATES['变量列表'];
    if (comment.indexOf('状态变量输出') >= 0) return ENTRY_TEMPLATES['状态变量输出'];
    if (comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0) return ENTRY_TEMPLATES['变量更新规则'];
    // 4. 通用匹配：遍历模板键找最长匹配
    var keys = Object.keys(ENTRY_TEMPLATES);
    var bestKey = null;
    var bestLen = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (comment.indexOf(k) >= 0 && k.length > bestLen) {
        bestKey = k;
        bestLen = k.length;
      }
    }
    if (bestKey) return ENTRY_TEMPLATES[bestKey];
    return null;
  }

  // 判断条目是否属于MVU变量系统
  // 兼容大小写前缀：[InitVar]/[initvar]、[mvu_update] 等
  function isMVUEntry(comment) {
    var c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
           c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0 ||
           c.indexOf('状态变量输出') >= 0 || c.indexOf('updatevariable') >= 0 ||
           c.indexOf('变量分段') >= 0 || c.indexOf('分段提示') >= 0 ||
           c.indexOf('ejs') >= 0;
  }

  // 判断是否为MVU核心条目（五大核心：[initvar]/变量列表/变量更新规则/变量输出格式/变量输出格式强调）
  function isMVUCoreEntry(comment) {
    var c = (comment || '').toLowerCase();
    return c.indexOf('[initvar]') >= 0 || c.indexOf('变量列表') >= 0 ||
           c.indexOf('变量更新规则') >= 0 || c.indexOf('变量输出格式') >= 0;
  }

  // ST规范：转换 regex_scripts 格式（导入/导出共用）
  function normalizeRegexScripts(rxScripts) {
    if (!rxScripts || !Array.isArray(rxScripts)) return [];
    return rxScripts.map(function(script, idx) {
      var findRegex = script.findRegex || script.find_regex || script.find || '';
      var replaceString = script.replaceString || script.replace_string || script.replace || '';
      var rawPlacement = script.placement !== undefined ? script.placement :
                         (script.source ? (function(s) {
                           var arr = [];
                           if (s.user_input) arr.push(1);
                           if (s.ai_output) arr.push(2);
                           if (s.slash_command) arr.push(3);
                           if (s.world_info) arr.push(4);
                           return arr.length ? arr : [2];
                         })(script.source) : 2);
      var placement = Array.isArray(rawPlacement) ? rawPlacement : [rawPlacement];
      // 兼容 destination 字段（部分实现用 destination.display/prompt 而非 markdownOnly/promptOnly）
      var dest = script.destination || {};
      var markdownOnly = script.markdownOnly !== undefined ? script.markdownOnly :
                         (script.markdown_only !== undefined ? script.markdown_only :
                         (dest.display !== undefined ? !!dest.display : false));
      var promptOnly = script.promptOnly !== undefined ? script.promptOnly :
                       (script.prompt_only !== undefined ? script.prompt_only :
                       (dest.prompt !== undefined ? !!dest.prompt : false));
      return {
        id: script.id || ('regex_script_' + Date.now() + '_' + idx),
        scriptName: script.scriptName || script.script_name || script.name || '正则脚本',
        findRegex: findRegex,
        replaceString: replaceString,
        trimStrings: script.trimStrings || script.trim_strings || [],
        placement: placement,
        disabled: script.disabled !== undefined ? script.disabled : (script.enabled !== undefined ? !script.enabled : false),
        markdownOnly: markdownOnly,
        promptOnly: promptOnly,
        runOnEdit: script.runOnEdit !== undefined ? script.runOnEdit : (script.run_on_edit !== undefined ? script.run_on_edit : true),
        substituteRegex: script.substituteRegex !== undefined ? script.substituteRegex : (script.substitute_regex !== undefined ? script.substitute_regex : 0),
        minDepth: script.minDepth !== undefined ? script.minDepth : (script.min_depth !== undefined ? script.min_depth : null),
        maxDepth: script.maxDepth !== undefined ? script.maxDepth : (script.max_depth !== undefined ? script.max_depth : null)
      };
    });
  }

  // UI显示分组（基于条目类型，非ST group字段）
  function getDisplayGroup(e) {
    var comment = e.comment || '';
    // 变量系统优先判断（避免被 constant=true 的常驻体系拦截）
    if (isMVUEntry(comment)) return '变量系统';
    // 常驻体系判断
    var tmpl = getEntryTemplate(comment);
    var isConst = e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false);
    if (isConst) return '常驻体系';
    var m = comment.match(/^<([^>]+)>/);
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
    ],
    variable: [
      { key: 'init_var', name: '初始变量', icon: '📊', weight: 100, position: 0, order: 245 },
      { key: 'var_update_rule', name: '变量更新规则', icon: '📝', weight: 100, position: 1, order: 145 }
    ]
  };

  // ===== 系统提示词（ST权重分层8体系 + MVU变量系统） =====
  var SYS_PROMPT = '你是一位专业的世界模式角色卡创作大师，基于SillyTavern原生机制和ST权重分层8体系（+MVU变量系统可选），通过自然对话引导用户创建完整的世界模式角色卡。\n\n' +
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
    '4. 世界书条目：用顶层 "entries" 数组，通过 comment 智能匹配覆盖（相同comment=精确更新；相同<前缀>且同类型单条=自动更新；内容相似度>35%同前缀=智能更新）\n' +
    '5. ⚠️【删除铁律 - 最高优先级 - 不遵守则你的修改无效】\n' +
    '   删除条目**必须使用以下任一方式**，不写删除动作=只加不删=用户骂你！\n' +
    '   · 方式A：顶层 "_delete" / "delete" / "remove" 数组，值为 ["character_book.entries.<精确comment>"] 或 ["character_book.entries.<关键词包含匹配>"]\n' +
    '   · 方式B（⭐AI最容易写对⭐）：在 entries 数组内该条目加上 { "_action":"delete" , "comment":"<要删的comment>" }\n' +
    '   · 方式C："deleted_entries" 数组，值为 comment 列表\n' +
    '6. ⚠️【修改铁律 - 不遵守则变成叠加】\n' +
    '   修改条目=**先删旧条目+再加新条目**，或确保新条目comment与旧条目精确完全一致（字符级匹配，空格标点都要相同）\n' +
    '   用户说"修改/优化/重写XX条目"时，绝不能只加一条新的！必须删除旧条目后再新增，或用完全相同comment覆盖\n' +
    '7. 无变化：{"_nochange":true}\n' +
    '8. JSON前1-2句说明，JSON后不解释\n' +
    '9. **严禁输出完整 chara_card_v3 JSON**（除非用户说"生成角色卡"）\n\n' +
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
    '**第三部分：1套动态适配系统 + 1套变量系统**\n\n' +
    '### 8. 动态适配系统\n' +
    '- ST能力：alternate_greetings + depth_prompt + regex_scripts + 内置宏变量\n' +
    '- 内容：\n' +
    '  1. 多开局分支：3个不同身份/难度的备用开场白\n' +
    '  2. 渐进引导：前10轮自动注入新手提示，达到深度后自动消失\n' +
    '  3. 变量模板：全内容适配ST原生宏变量（{{user}}/{{random:A,B}}/{{roll:XdY}}/{{date}}/{{time}}）\n' +
    '  4. 状态正则：基础状态自动同步脚本\n' +
    '- 条目前缀：<动态适配>、<引导机制>、<互动选项>、<状态栏>\n\n' +
    '### 9. MVU变量系统（MagVarUpdate zod，进阶可选）\n' +
    '- 核心脚本：在角色卡局部脚本(tavern_helper.scripts)中添加 import bundle.js（写卡器自动注入）\n' +
    '- 工作原理：每次LLM生成完消息后，MVU扫描回复末尾的<UpdateVariable>段中的JSON Patch命令，更新stat_data变量\n' +
    '- 五大核心组件（写卡器自动注入脚本和正则1-5，世界书条目和正则6需AI生成）：\n' +
    '  1. [InitVar]初始变量：世界书条目（enabled必须=false禁用），YAML格式定义所有变量的初始值\n' +
    '     · YAML用缩进表示层级，冒号后空格建立从属关系\n' +
    '     · 三种基本类型：数值(number)、文本(string)、真假值(boolean)\n' +
    '     · 示例：\n' +
    '       白娅:\n' +
    '         依存度: 35\n' +
    '         着装:\n' +
    '           上装: 深蓝色校服外套\n' +
    '         受孕: false\n' +
    '       主角:\n' +
    '         物品栏:\n' +
    '           薄荷糖:\n' +
    '             描述: 提神用薄荷糖\n' +
    '             数量: 1\n' +
    '  2. 变量列表：世界书条目（constant=true, depth=0），通过宏注入当前变量值给LLM\n' +
    '     · 固定内容：---\\n<status_current_variable>\\n{{format_message_variable::stat_data}}\\n</status_current_variable>\n' +
    '     · {{format_message_variable::stat_data}} 是酒馆助手宏，发送时被替换为最新楼层的全部变量值\n' +
    '     · 插入位置必须D1或D0，让AI知道变量值对应最新剧情\n' +
    '  3. [mvu_update]变量更新规则：世界书条目（constant=true），告诉LLM如何分析变量变化\n' +
    '     · YAML格式，沿用变量结构层级，每变量含以下字段（按需选用）：\n' +
    '       - type: 变量类型（string类型可省略此字段；number/boolean直接写；复杂类型用 |- 多行TypeScript类型块）\n' +
    '       - range: 数值范围（如 0~100）\n' +
    '       - format: 字符串格式要求（如 ${xx历}-${YYYY/MM/DD}-${HH:MM}）\n' +
    '       - category: 数值分段语义（如 20~40: 普通人 / 40~70: 冒险者）\n' +
    '       - check: 更新规则（核心字段，用自然语言说明何时更新、更新成什么值）\n' +
    '     · ⚠️注意：变量结构脚本(zod)是对变量的硬性要求，更新规则中的type/range/format/category是对AI的希望建议\n' +
    '     · 同类型合并：固定键用 ${力量|敏捷|体质|感知} 写法，动态键放进type的index signature\n' +
    '     · 同对象字段嵌套以减少token；_前缀字段是只读，AI不可更新\n' +
    '     · 示例：\n' +
    '       ---\\n变量更新规则:\\n  白娅:\\n    依存度:\\n      type: number\\n      range: 0~100\\n      category:\\n        0~20: 陌生\\n        80~100: 深爱\\n      check:\\n        - 单次互动最多+1，同一剧情日累计最多+5\\n  世界:\\n    当前时间:\\n      format: ${xx历}-${YYYY/MM/DD}-${HH:MM}\\n      check:\\n        - 每次事件推进后更新\n' +
    '  4. [mvu_update]变量输出格式：世界书条目（constant=true, depth=0），定义<UpdateVariable>段的输出格式\n' +
    '     · 采用JSON Patch (RFC 6902)标准，AI输出<Analysis>思维链+<JSONPatch>命令数组\n' +
    '     · 支持操作：replace(替换)/delta(数值增减)/insert(插入)/remove(删除)/move(移动)\n' +
    '     · 格式模板：\n' +
    '       ---\\n变量输出格式:\\n  rule:\\n    - you must output the update analysis and the actual update commands at once in the end of the next reply\\n    - the update commands works like the JSON Patch standard, must be a valid JSON array containing operation objects\\n    - supported ops: replace, delta, insert, remove, move\\n    - don\'t update field names starts with `_` as they are readonly\\n  format: |-\\n    <UpdateVariable>\\n    <Analysis>$(IN ENGLISH, no more than 80 words)\\n    - ${calculate time passed: ...}\\n    - ${decide whether dramatic updates are allowed as it\'s in a special case or the time passed is more than usual: yes/no}\\n    - ${check affection caps: every single interaction may increase at most +1, and the same in-story day may increase at most +5}\\n    - ${analyze every variable based on its corresponding check, according only to current reply: ...}\\n    </Analysis>\\n    <JSONPatch>\\n    [\\n      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },\\n      { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },\\n      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },\\n      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },\\n      { "op": "remove", "path": "${/path/to/object/key}" },\\n      { "op": "remove", "path": "${/path/to/array/0}" },\\n      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" }\\n    ]\\n    </JSONPatch>\\n    </UpdateVariable>\n' +
    '     · AI实际输出示例：\n' +
    '       <UpdateVariable>\\n<Analysis>\\n- Time advanced by 10 minutes\\n- 白娅.依存度: 接受薄荷糖，情感冲击显著，应增加\\n- 主角.物品栏.薄荷糖: 已送出，应删除\\n</Analysis>\\n<JSONPatch>\\n[\\n { "op": "replace", "path": "/白娅/依存度", "value": 40 },\\n { "op": "remove", "path": "/主角/物品栏/薄荷糖" }\\n]\\n</JSONPatch>\\n</UpdateVariable>\n' +
    '     · [mvu_update]前缀适配两种更新方式：随AI输出(全部发送) / 额外模型解析(只发给变量更新AI)\n' +
    '  5. 变量结构脚本：tavern_helper.scripts脚本（写卡器自动注入），用zod 4库定义变量结构并registerMvuSchema注册\n' +
    '     · 数值用z.coerce.number()（非z.number()，防AI把数值更新成文本）；但布尔直接用z.boolean()，不要用z.coerce.boolean()\n' +
    '     · 范围限制用.transform(v => _.clamp(v, 0, 100))（非.min().max()，后者会拒绝超范围值，用户期望部分更新而非整体丢弃）\n' +
    '     · 默认值用.prefault(默认值)（非z.default；AI漏写字段时自动填充）；复合类型若用prefault，其所有子字段也必须prefault\n' +
    '     · 幂等性要求（核心）：Schema.parse(Schema.parse(input)) 必须等于 Schema.parse(input)；z.transform需谨慎，不可破坏幂等性\n' +
    '     · z.transform限制：fn只能接收解析后的output，绝不可以用context；例 z.object({好感度:z.coerce.number()}).transform(d=>({好感度:_.clamp(d.好感度,0,100)}))\n' +
    '     · z.prefault限制：value必须是该schema自身的合法input；可以是值或函数（如 .prefault(()=>Date.now())）\n' +
    '     · z.extend限制：只有z.object/z.looseObject/z.strictObject能被extend；z.object(...).prefault({})不能再extend\n' +
    '     · ⚠️禁止使用z.passthrough/z.strict（不存在，永远不要用）\n' +
    '     · 5种对象场景（按需选用）：\n' +
    '       (a) 固定必填键+同类型值：z.record(z.enum([\'上装\',\'下装\']), z.string())\n' +
    '       (b) 固定可选键+同类型值：z.partialRecord(z.enum([...]), 值类型)\n' +
    '       (c) 动态可选键+同类型值：z.record(z.string(), 值类型)\n' +
    '       (d) 固定必填键+不同类型值：z.object({ key1: 类型1, key2: 类型2 })\n' +
    '       (e) 部分必填+动态同类型：z.intersection(z.object({必填字段}), z.record(z.string(), 值类型))\n' +
    '     · 可清除对象（会被remove op删除的）：用 z.object({字段:类型.prefault(...)}).prefault({}) 而非 z.object({...}).optional()\n' +
    '     · 枚举限制用z.enum([\'值1\',\'值2\',...])（如状态/品质/属性/阵营）\n' +
    '     · 联合类型用z.union([z.literal(\'待初始化\'), z.coerce.number()])（允许"待初始化"或数值）\n' +
    '     · 格式化字符串优先用z.templateLiteral([z.literal(\'D\'), z.coerce.number(), ...])（优于正则或手动解析）\n' +
    '     · 字段含义用.describe(\'描述\')（仅当字段名无法自解释时用，如z.record的key类型；字段名已说明用途时不要画蛇添足）\n' +
    '     · 插入顺序：若需按插入时间管理key，用_(data).entries()（按插入序列出）；配合 $time: z.coerce.number().prefault(()=>Date.now()) 自动时间戳\n' +
    '     · AI不可更新字段用 _ 前缀（如_当前回合），schema中添加注释；AI不可见字段用 $ 前缀\n' +
    '     · transform 后处理可实现：称号数量依赖依存度、物品数量<=0自动过滤等动态规则\n' +
    '     · 完整示例：\n' +
    '       import { registerMvuSchema } from \'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js\';\n' +
    '       export const Schema = z.object({\n' +
    '         世界: z.object({\n' +
    '           当前时间: z.string(),\n' +
    '           近期事务: z.record(z.string().describe(\'事务名\'), z.string().describe(\'事务描述\')),\n' +
    '         }),\n' +
    '         白娅: z.object({\n' +
    '           依存度: z.coerce.number().transform(v => _.clamp(v, 0, 100)),\n' +
    '           着装: z.record(z.enum([\'上装\',\'下装\',\'内衣\']), z.string().describe(\'服装描述\')),\n' +
    '         }),\n' +
    '         主角: z.object({\n' +
    '           物品栏: z.record(z.string().describe(\'物品名\'), z.object({\n' +
    '             描述: z.string(), 数量: z.coerce.number(),\n' +
    '           })).transform(d => _.pickBy(d, ({数量}) => 数量 > 0)),\n' +
    '         }),\n' +
    '       });\n' +
    '       $(() => { registerMvuSchema(Schema); })\n' +
    '  6. 酒馆助手脚本 API（可选，用于状态栏渲染和事件响应）：\n' +
    '     · 事件：Mvu.events.VARIABLE_INITIALIZED（initvar 加载完成）、Mvu.events.VARIABLE_UPDATE_ENDED（每次更新结束）\n' +
    '     · 读取（状态栏渲染推荐）：getAllVariables() + _.get(allVars,"stat_data",{}) —— 复用酒馆助手稳定API，避免时序失效\n' +
    '     · 读取（通用）：Mvu.getVar("stat_data") / Mvu.getMvuData() / Mvu.getVar("stat_data.角色.好感度")\n' +
    '     · 写入：Mvu.setVar("stat_data.角色.好感度", 80) / Mvu.patchVar([{op:"replace",...}])\n' +
    '     · 等待初始化：waitGlobalInitialized("Mvu") —— 状态栏渲染必须先 await 此函数再绑定事件\n' +
    '     · 异常捕获：$(errorCatched(fn)) 包裹init函数，报错不卡死面板\n' +
    '     · 典型场景：在VARIABLE_UPDATE_ENDED回调中递归遍历stat_data渲染状态栏HTML\n' +
    '  7. EJS 动态模板（可选，根据变量值发送不同提示词给AI）：\n' +
    '     · 使用 getvar("stat_data.角色.好感度") 读取变量值，按阈值分段\n' +
    '     · 示例：<% if (getvar("stat_data.白娅.好感度") >= 50) { %>温柔依赖模式<% } %>\n' +
    '     · 分段建议：≥80深爱 / ≥50好感 / ≥20熟识 / <20陌生\n' +
    '     · 典型场景：根据好感度/剧情日切换角色语气、称呼、行为\n' +
    '  8. 正则脚本：6个必备正则\n' +
    '     · 正则1：仅格式思维链 - 从提示词移除<Analysis>段（AI思维链无需重复发送）【写卡器自动注入】\n' +
    '     · 正则2：[不发送]只发送最新2楼的变量更新 - 移除旧消息的<UpdateVariable>段（仅格式提示词，minDepth=4保留最近2楼）【写卡器自动注入】\n' +
    '     · 正则3：[美化]变量完成 - 美化已完成的<UpdateVariable>显示（仅格式显示，折叠样式）【写卡器自动注入】\n' +
    '     · 正则4：[美化]变量更新中 - 美化正在输出的<UpdateVariable>（仅格式显示，流式动画）【写卡器自动注入】\n' +
    '     · 正则5：[不发送]隐藏状态栏标记 - 从提示词移除<StatusPlaceHolderImpl/>占位符（AI不需要看到它）【写卡器自动注入】\n' +
    '     · 正则6：[美化]MVU状态栏 - 将<StatusPlaceHolderImpl/>替换为状态栏HTML（仅格式显示，渲染可视化状态栏）【⚠️AI必须根据用户需求生成！】\n' +
    '- 三版正则选择：promptOnly版只影响发送给AI的内容；markdownOnly版只影响显示；全局版（无promptOnly/markdownOnly）影响所有内容\n' +
    '- 开局变量初始化：\n' +
    '  1. [InitVar] 条目定义默认初始值（enabled=false，仅初始化时读取一次）\n' +
    '  2. 若需开局动态设置（根据玩家选择），在alternate_greetings中嵌入<UpdateVariable><initvar>YAML</initvar></UpdateVariable>覆盖\n' +
    '  3. 初始化后变量可在状态栏玩家直接修改（通过酒馆助手UI）\n' +
    '- 状态栏占位符：<StatusPlaceHolderImpl/> 由写卡器导出时自动追加到开场白末尾；正则5从提示词移除占位符（自动注入）；正则6在显示时替换为状态栏HTML（监听MVU VARIABLE_INITIALIZED/VARIABLE_UPDATE_ENDED事件动态填充stat_data）\n' +
    '- ⚠️【重中之重】正则6（美化状态栏）必须由AI根据用户需求生成！严格配置要求：\n' +
    '  · findRegex: "/<StatusPlaceHolderImpl\\\\/>/g"\n' +
    '  · replaceString: 必须是完整HTML结构，用 ```html 代码块包裹\n' +
    '  · 完整HTML结构：<!doctype html> → <html> → <head><style>全局样式</style></head> → <body>页面DOM + <script type="module">渲染逻辑</script></body> → </html>\n' +
    '  · 包裹格式: "```html\\n<!doctype html>\\n<html>\\n<head>\\n  <style>...</style>\\n</head>\\n<body>\\n  ...DOM结构...\\n  <script type="module">...渲染逻辑...</script>\\n</body>\\n</html>\\n```"\n' +
    '  · placement: [2]（AI输出）\n' +
    '  · markdownOnly: true, promptOnly: false（仅格式显示，不影响发给AI的提示词）\n' +
    '  · runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null\n' +
    '  · ⚠️必须用以下稳定API读取变量（不要用Mvu.getVar，有时序失效问题）：\n' +
    '    const allVars = getAllVariables();\n' +
    '    const statData = _.get(allVars, "stat_data", {});\n' +
    '  · ⚠️必须异步等待MVU就绪后再绑定事件，否则首屏空白：\n' +
    '    async function init() {\n' +
    '      await waitGlobalInitialized(\'Mvu\');\n' +
    '      refreshMvuPanel();\n' +
    '      eventOn(Mvu.events.VARIABLE_INITIALIZED, refreshMvuPanel);\n' +
    '      eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, refreshMvuPanel);\n' +
    '    }\n' +
    '    $(errorCatched(init));  // 全局异常捕获，报错不卡死面板\n' +
    '  · ⚠️必须用递归函数 renderVarTree 渲染任意深度嵌套对象（不要只渲染1层）：\n' +
    '    for (const [key, val] of Object.entries(obj)) {\n' +
    '      if (key.startsWith("_") || key.startsWith("$")) continue;  // 跳过隐藏变量\n' +
    '      if (typeof val === "object" && val !== null) → 递归 renderVarTree(val)\n' +
    '      else if (typeof val === "number") → 进度条+数值（严格typeof，不要把字符串当数字）\n' +
    '      else → 布尔显示✅/❌，其他显示文本值\n' +
    '    }\n' +
    '  · 数值变量百分比：默认0-100范围；心跳速率用60-180并加❤️跳动图标；体温用35-42；其他特殊变量按真实范围\n' +
    '  · 布尔变量：仅显示✅/❌图标（不要加"是/否"文字）\n' +
    '  · <script> 必须用 type="module" 以支持顶层 async/await\n' +
    '  · 配色用 CSS 变量（:root里定义--c-light/--c-main/--c-dark/--bg-soft/--text-gray），AI改主题只改:root即可\n' +
    '  · 根据用户需求（如修仙境界、末世生存、校园好感度等）设计匹配主题的状态栏配色和布局\n' +
    '- 更新铁则：AI不得修改 _ 开头的只读字段；使用 delta 操作进行数值增减；使用 replace 进行文本/对象替换；remove 删除物品；insert 添加新物品/条目\n' +
    '- 条目前缀：[InitVar]初始变量、变量列表、变量分段提示（EJS模板）、[mvu_update]变量更新规则、[mvu_update]变量输出格式、[mvu_update]变量输出格式强调\n\n' +
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
    '**群聊角色排除（Character Exclusion，群聊专用）**：\n' +
    '- character_exclusion：角色排除列表（数组），列表中的角色不会触发此条目\n' +
    '  - 用途：在群聊中控制条目只被特定角色触发，避免不相关角色触发\n' +
    '  - 例：Jamie和Bill群聊，条目设置了character_exclusion=["Bill"]，则只有Jamie能触发此条目\n' +
    '  - 典型场景：角色专属背景只在角色自己说话时触发，避免其他角色无意间触发\n' +
    '  - 注意：这是角色级别的过滤，与关键词触发是独立的两个条件\n\n' +
    '**分组互斥类（Inclusion Group，高级功能，强烈推荐使用）**：\n' +
    '- group：互斥分组标签（逗号分隔，一条目可属多个组），同组多条目同时触发时仅选1条注入\n' +
    '  - 场景变体：同一场景的不同描述，随机选一个增加多样性和新鲜感\n' +
    '  - 难度分层：新手/普通/困难三种规则，按进度选择不同深度的规则\n' +
    '  - 时间分支：白天/夜晚/黄昏/凌晨不同场景描述和氛围\n' +
    '  - 心情状态：平静/愤怒/悲伤/喜悦等不同状态下的角色行为差异\n' +
    '  - 多选组：一条目属于多个组时（如group="天气,事件"），它的触发会禁用所有相关组的其他条目\n' +
    '    · 例：条目A的group="天气,季节"，条目B的group="天气"，条目C的group="季节"\n' +
    '    · 当A触发时，B和C都会被禁用（因为A属于天气组和季节组）\n' +
    '    · 当B触发时，A会被禁用（A属于天气组），但C不受影响\n' +
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
    '  - 完整示例：\n' +
    '    · 组"歌曲"有两条条目：\n' +
    '      - 条目1：keys=["song", "sing", "黑猫"], group="歌曲", group_weight=100\n' +
    '      - 条目2：keys=["song", "sing", "幽灵"], group="歌曲", group_weight=100\n' +
    '    · 用户输入"我在唱黑猫之歌" → 条目1匹配3个key，条目2匹配2个key\n' +
    '    · use_group_scoring=true时：只保留条目1（匹配数最多），直接注入\n' +
    '    · use_group_scoring=false时：两条都保留，按group_weight随机选\n' +
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
    '- automation_id：自动化触发ID（进阶功能）\n' +
    '  - 设置后，当此条目被激活时，会自动执行同名STscript脚本\n' +
    '  - 用途：条目触发时自动执行复杂逻辑（如更新变量、发送通知、触发其他操作）\n' +
    '  - 例：automation_id="combat_start" → 条目激活时自动执行/combat_start脚本\n' +
    '  - 不需要自动化功能时留空\n' +
    '- per-entry scan_depth：条目级扫描深度覆盖（覆盖全局设置）\n' +
    '  - 最大值：1000（足够扫描整个长对话）\n' +
    '  - 用途：某些条目需要扫描更远历史（如追溯剧情伏笔）或更近历史（如即时反应）\n' +
    '  - 例：常驻条目设为0（不扫描历史），事件触发条目设为10-20\n' +
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
    '**全局预算与激活控制（用户侧设置，生成角色卡时需了解）**：\n' +
    '- Budget Cap（预算上限）：世界书总token上限，防止注入过多内容撑爆上下文\n' +
    '  - 通常设为1024或2048，取决于模型上下文长度\n' +
    '  - 角色卡设计原则：常驻条目总token≤500，确保有足够预算给触发条目\n' +
    '- Min Activations（最小激活数）：确保至少激活N条条目的全局设置\n' +
    '  - 设为非零值时，即使scan_depth内没找到关键词，也会向后搜索直到激活指定数量的条目\n' +
    '  - 用途：确保关键信息不被遗漏（如每次生成都注入一些世界背景）\n' +
    '  - 注意：仍受Budget Cap和Max Depth限制\n' +
    '  - 生成角色卡时无需设置此值，但需了解用户可能使用此功能\n' +
    '- Extension Prompts扫描：世界书可扫描扩展提示词（如Chat Lore、Persona Lore等）\n' +
    '  - 这些内容不在聊天消息中，但在上下文中存在\n' +
    '  - 生成角色卡时无需关心此设置\n\n' +
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
    '- 正则脚本按顺序执行，前一个的输出是后一个的输入\n' +
    '- **脚本类型**：\n' +
    '  · Global脚本：全局生效，保存在settings.json，适用于所有角色卡\n' +
    '  · Scoped脚本：仅对当前角色卡生效，保存在角色卡数据中\n' +
    '  · 生成角色卡时使用Scoped脚本（保存在extensions.regex_scripts中）\n' +
    '- **脚本执行顺序**：按脚本列表顺序执行，前一个的输出是后一个的输入\n' +
    '- **Ephemerality临时性设置**（控制是否写入聊天文件）：\n' +
    '  · promptOnly=true：只修改发送给模型的提示词，不改变显示，不写入聊天文件\n' +
    '    用途：偷偷给模型加规则/改格式，用户看不到变化\n' +
    '  · 默认（都不设置）：直接修改聊天内容，显示和模型一致，永久保存\n' +
    '  · 注意：promptOnly模式用户和模型看到的内容不同，需谨慎使用\n\n' +
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
    '  - 支持 {{match}} 宏引用整个匹配（与$&等效，但更直观）\n' +
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
    '      placement=[0,1]\n' +
    '  13. HTML/CSS样式注入（彩色标签）：\n' +
    '      findRegex="/<status>([\\s\\S]*?)</status>/gi"\n' +
    '      replaceString="<div style=\\"background:#1a1a2e;padding:8px 12px;border-radius:8px;border-left:4px solid #e94560;color:#e0e0e0;\\">$1</div>"\n' +
    '      placement=[1]\n' +
    '      注意：需要在用户设置中关闭"Show <tags> in responses"\n' +
    '  14. STscript布尔判断（配合斜杠命令）：\n' +
    '      findRegex="/<action>([^<]+)</action>/gi"\n' +
    '      replaceString="ACTION_MATCH_FOUND"\n' +
    '      disabled=true（默认禁用，通过STscript按需触发）\n' +
    '      用途：在STscript中判断是否匹配成功，执行条件分支\n' +
    '  15. MVU-移除旧变量更新(提示词)（AI输出，仅格式提示词，minDepth=4）：\n' +
    '      findRegex="/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm"\n' +
    '      replaceString=""\n' +
    '      placement=[2]（AI输出）, markdownOnly=false, promptOnly=true, minDepth=4\n' +
    '      用途：只从depth>=4的旧消息提示词中移除<UpdateVariable>段，保留最近2楼让AI看到变量更新历史\n' +
    '  16. MVU-移除变量更新(显示)（AI输出，仅格式显示）：\n' +
    '      findRegex="/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm"\n' +
    '      replaceString=""\n' +
    '      placement=[2]（AI输出）, markdownOnly=true, promptOnly=false\n' +
    '      用途：从所有消息的显示中移除<UpdateVariable>段，用户不需要看到变量更新代码\n' +
    '  17. MVU-对AI隐藏状态栏（AI输出，仅格式提示词）：\n' +
    '      findRegex="/<StatusPlaceHolderImpl\\/>/g"\n' +
    '      replaceString=""\n' +
    '      placement=[2]（AI输出）, markdownOnly=false, promptOnly=true\n' +
    '      用途：不让模型看到状态栏占位符，避免干扰生成（注意：不勾选仅格式显示）\n' +
    '  18. MVU-状态栏美化显示（AI输出，仅格式显示）【⚠️此正则必须由AI根据用户需求生成，显示所有可见变量】：\n' +
    '      findRegex="/<StatusPlaceHolderImpl\\/>/g"\n' +
    "      replaceString=\"```html\\n<!doctype html>\\n<html>\\n<head>\\n  <style>全局样式(CSS变量配色)</style>\\n</head>\\n<body>\\n  页面DOM结构\\n  <script type=\"module\">异步等待MVU+递归遍历stat_data渲染</script>\\n</body>\\n</html>\\n```\"\n" +
    '      placement=[2]（AI输出）, markdownOnly=true, promptOnly=false, runOnEdit=true, substituteRegex=0, minDepth=null, maxDepth=null\n' +
    '      用途：在渲染阶段将占位符替换为完整HTML状态栏，递归遍历stat_data所有可见变量动态渲染\n' +
    "      注意：HTML必须是完整结构（<!doctype html>+html+head(style)+body(script type=module)），用```html包裹\n" +
    '      ⚠️生成前引导流程（按需询问，不强制一步步；用户明确要"直接生成"时可跳过询问）：\n' +
    '        第1步：请用户提供MVU变量结构脚本（zod schema代码块），识别变量路径/核心字段/数据组织方式\n' +
    '        第2步：询问用户想显示哪些变量（可按类别分组：核心状态/世界状态/角色状态等）\n' +
    '        第3步：询问UI风格（简约黑色卡片/赛博朋克霓虹/古风水墨/科幻全息/游戏UI仪表盘/极简线条，或"简单就行"），按用户要求自由设计\n' +
    '        第4步：进入代码生成（⚠️使用下方的8步分模块流程；⚠️严格每次只生成一个模块，禁止一次生成多个模块，禁止一口气生成完整状态栏）\n' +
    '\n' +
    '      ╔══════════════════════════════════════════════════════════════╗\n' +
    '      ║  ⚠️核心机制：8步分模块生成 + 严格单模块交付 + 拼接合并       ║\n' +
    '      ║  设计目标：让最弱的模型也能分步骤生成最好的状态栏             ║\n' +
    '      ║  核心原则：每个Step职责单一、有明确示例、按需伸缩            ║\n' +
    '      ║  ⚠️铁律：一次回答只能生成/修改一个模块，禁止生成多个模块     ║\n' +
    '      ║  ⚠️铁律：生成模块前必须与已有模块对照，相互印证确保可行       ║\n' +
    '      ║  ⚠️铁律：生成模块时禁止输出其他代码块，只输出该模块本身       ║\n' +
    '      ║  ⚠️铁律：每次输出模块后结尾必须提醒用户接下来该干什么         ║\n' +
    '      ║  ⚠️铁律：禁止AI一口气生成完整状态栏                          ║\n' +
    '      ║  ⚠️铁律：修改模块前先用<clear_statusbar>清空待改模块         ║\n' +
    '      ║  ⚠️铁律：6个模块全部齐全才会拼接保存，确保状态栏完整可用     ║\n' +
    '      ╚══════════════════════════════════════════════════════════════╝\n' +
    '\n' +
    '      【机制1：渐进式分模块收集（严格单模块交付，像角色卡一样一点一点收集，最后拼在一起）】\n' +
    '      写卡器会跨多轮对话逐步收集各Step代码模块，用户每说一次"继续"你就生成下一个模块。\n' +
    '      每个模块用 `/* === Step N: 标题 === */` 标记+代码块输出，写卡器自动提取并累积保存。\n' +
    '      ⚠️严格单模块交付原则（核心铁律，不可违反）：\n' +
    '        · ⛔一次回答只能生成或修改一个模块（一个Step），绝对禁止在同一个回答中输出多个Step的代码块\n' +
    '        · ⛔禁止AI一口气生成完整状态栏——必须分7次以上交付（Step 1到Step 7各一次），Step 8仅确认不输出代码\n' +
    '        · ⛔生成模块时禁止输出任何其他代码块——回答中只能有当前这一个Step的 ``` 代码块，绝对不能附带以下任何内容：\n' +
    '          - 世界书条目代码块（```json格式的条目JSON、character_book片段）\n' +
    '          - 其他JS脚本代码块（非当前Step的JavaScript/TypeScript代码）\n' +
    '          - <statusblock>包裹的进度信息块或任何statusblock标签\n' +
    '          - 完整HTML代码块（<!doctype或<html开头的完整页面）\n' +
    '          - YAML/TOML配置代码块\n' +
    '          - 任何非当前Step的 ``` 代码块\n' +
    '          如果需要补充说明，用纯文字写，不要用代码块包裹\n' +
    '          ⚠️写卡器会自动截断第一个代码块之后的多余内容，多余的代码块会被丢弃\n' +
    '        · ✅生成模块前必须与已有模块对照、相互印证，确保可行：\n' +
    '          - 生成Step 3骨架前，对照Step 1变量表的路径和分组，确保每个变量都有对应节点\n' +
    '          - 生成Step 4样式前，对照Step 3骨架的class/id命名，确保选择器一一对应\n' +
    '          - 生成Step 5读取前，对照Step 1变量表的路径，确保_.get路径完全一致\n' +
    '          - 生成Step 6渲染前，对照Step 3的id命名和Step 5的返回值结构，确保DOM操作目标存在\n' +
    '          - 生成Step 7入口前，对照Step 6的函数名和Step 5的函数名，确保调用正确\n' +
    '        · ✅每次输出模块后，结尾必须提醒用户接下来该干什么（如"下一步是Step N: XXX，请说继续"）\n' +
    '        · 用户要"分步骤看"或"我先确认变量表" → 只做当前Step，停下问"OK吗？"\n' +
    '        · 用户只说"改配色/改样式/改渲染逻辑" → 只做涉及的那个Step，其他不动\n' +
    '        · 用户语义涉及多个Step（如"换UI风格"涉及配色+骨架+样式）→ ⚠️仍然一次只做一个Step，先做Step 2，然后提醒"接下来需要改Step 3骨架和Step 4样式，请说继续"\n' +
    '        · 用户语义模糊（如"让状态栏更好看"）→ AI先列出打算改的Step清单给用户确认，然后逐个生成\n' +
    '      ⚠️各Step代码块用 /* === Step N: 标题 === */ 标记，写卡器自动提取拼接，不需要AI输出完整HTML\n' +
    '      ⚠️写卡器会在每轮对话后显示收集进度（✅已收集/⬜还缺），并提示下一步该生成什么\n' +
    '      ⚠️完整性保障：6个模块（Step 2-7）全部收集完毕后，写卡器才会自动拼接保存到角色卡\n' +
    '         缺任何一个模块都不会保存，避免生成残缺不可用的状态栏\n' +
    '         修改时旧状态栏保持不变，直到新模块全部收集完毕才覆盖\n' +
    '\n' +
    '      ▶ Step 1：变量盘点表（纯文本，非代码，先理清思路）\n' +
    '        产出：表格 | 路径 | 类型 | 分组 | 显示名 |\n' +
    '        范围：从用户zod schema提取所有要显示的变量，跳过_/$开头的\n' +
    '        类型识别：number/boolean/string/array/object\n' +
    '        示例：\n' +
    '          | stat_data.角色.好感度 | number | 核心状态 | 好感度 |\n' +
    '          | stat_data.世界.时间 | string | 世界状态 | 时间 |\n' +
    '          | stat_data.背包 | array | 物品栏 | 背包 |\n' +
    '        用途：后续Step全部基于此表，路径和类型不得偏离\n' +
    '        交付：展示表格，问"这些变量都显示吗？要加/减/改分组的告诉我"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 2: 配色方案，请说继续"\n' +
    '\n' +
    '      ▶ Step 2：配色方案（仅CSS :root变量块）\n' +
    '        产出：仅一段 `:root { --xxx: 颜色; }`，不含任何选择器规则\n' +
    '        内容：根据UI风格定主色/辅色/背景/文字/边框/成功/警告/危险等变量\n' +
    '        示例：\n' +
    '          :root {\n' +
    '            --card-bg: rgba(20,20,30,0.85);\n' +
    '            --accent-blue: #93c5fd;\n' +
    '            --text-main: #e2e8f0;\n' +
    '          }\n' +
    '        交付：展示配色，问"配色OK吗？"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 3: HTML结构骨架，请说继续"\n' +
    '\n' +
    '      ▶ Step 3：HTML结构骨架（仅<body>内DOM，含静态假数据，无CSS无JS）\n' +
    '        产出：纯DOM结构，每个变量节点预留唯一id\n' +
    '        规则：\n' +
    '          · id命名：stat-<分组>-<字段>（如 id="stat-core-hp"）\n' +
    '          · 用Step 1表格的假数据填充，让用户直观看效果\n' +
    '          · 不写style属性、不写script\n' +
    '        示例片段：\n' +
    '          <div class="card" id="card-core">\n' +
    '            <div class="cat-title">核心状态</div>\n' +
    '            <div class="stat-row"><span class="label">好感度</span><span class="value" id="stat-core-hp">35</span></div>\n' +
    '          </div>\n' +
    '        交付：展示骨架，问"结构和分组OK吗？"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 4: CSS样式表，请说继续"\n' +
    '\n' +
    '      ▶ Step 4：CSS样式表（仅<style>内规则，不含:root，不含HTML）\n' +
    '        产出：基于Step 3结构写所有选择器规则，引用Step 2的CSS变量\n' +
    '        必含：卡片容器、分类标题、stat-row布局、数值着色、加载动画、刷新淡入\n' +
    '        ⚠️布局约束（强制）：禁用vh（用width+aspect-ratio）、避min-height/overflow:auto、禁position:absolute、适配容器宽度、卡片形状不加背景色\n' +
    '        交付：展示样式，问"样式OK吗？要调字号/间距/配色告诉我"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 5: 变量读取函数，请说继续"\n' +
    '\n' +
    '      ▶ Step 5：变量读取函数（仅JS function，纯函数无副作用）\n' +
    '        产出：`function loadVars() { ... return data; }` 单个函数\n' +
    '        规则：\n' +
    '          · 用 _.get(getAllVariables(), "stat_data.xxx", 默认值)\n' +
    '          · 每个Step 1表格的路径都要读取\n' +
    '          · 禁止Mvu.getVar，禁止在此函数操作DOM\n' +
    '        示例：\n' +
    '          function loadVars() {\n' +
    '            const all = getAllVariables();\n' +
    '            return {\n' +
    '              hp: _.get(all, "stat_data.角色.好感度", 0),\n' +
    '              time: _.get(all, "stat_data.世界.时间", "未知"),\n' +
    '              bag: _.get(all, "stat_data.背包", [])\n' +
    '            };\n' +
    '          }\n' +
    '        交付：展示函数，简要说明读取了哪些路径\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 6: 渲染函数，请说继续"\n' +
    '\n' +
    '      ▶ Step 6：渲染函数（仅JS function，处理类型+写DOM）\n' +
    '        产出：`function renderVars(data) { ... }` 单个函数\n' +
    '        规则：\n' +
    '          · 遍历Step 1表格，按类型分支处理：number→进度条/数值、boolean→✓/✕、string→文本、array→列表、object→递归\n' +
    '          · DOM必须用jquery（$("#id").text/html/addClass），禁止原生DOM\n' +
    '          · 嵌套对象用renderVarTree递归\n' +
    '          · 跳过key以_/$开头的\n' +
    '          · 注释只能用 /* */，禁止 //\n' +
    '        交付：展示函数，问"渲染逻辑OK吗？"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 7: 事件绑定+入口，请说继续"\n' +
    '\n' +
    '      ▶ Step 7：事件绑定+入口（仅JS入口代码，无函数定义）\n' +
    '        产出：\n' +
    '          async function init() {\n' +
    '            await waitGlobalInitialized(\'Mvu\');\n' +
    '            renderVars(loadVars());\n' +
    '            eventOn(Mvu.events.VARIABLE_INITIALIZED, () => renderVars(loadVars()));\n' +
    '            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, () => renderVars(loadVars()));\n' +
    '          }\n' +
    '          $(errorCatched(init));\n' +
    '        规则：仅入口，禁止Mvu.watch等不存在接口；errorCatched包裹；$(() => {})加载\n' +
    '        交付：展示入口，问"事件绑定OK吗？"\n' +
    '        ⏭️结尾提醒：输出后必须告知用户"下一步是 Step 8: 拼接合并+自查，请说继续"\n' +
    '\n' +
    '      ▶ Step 8：拼接合并+自查（最后一步，仅确认不输出代码）\n' +
    '        ⚠️重要：拼接由写卡器自动完成，AI不需要重新输出完整HTML！\n' +
    '        AI只需确认各Step模块已就绪，写卡器会自动提取各Step代码块并拼接成完整HTML保存。\n' +
    '        这样各模块可以任意大，拼接不受AI单次输出长度限制。\n' +
    '        AI在Step 8需要做的：\n' +
    '          ① 确认 Step 2-7 的代码块都已输出（每个Step用 /* === Step N: 标题 === */ 标记+代码块）\n' +
    '          ② 模块间交叉对照自查（发现问题回到对应Step修正——但每次只能重新输出一个Step）：\n' +
    '            a. HTML结构：Step 3骨架是合法HTML片段\n' +
    '            b. 注释规范：全文无 // 注释，仅 /* */\n' +
    '            c. DOM规范：无原生DOM，全部jquery\n' +
    '            d. 变量路径：所有_.get路径以 stat_data 开头，与Step 1表一致\n' +
    '            e. 类型安全：typeof number检测、布尔✓/✕、跳过_/$变量\n' +
    '            f. 异步安全：waitGlobalInitialized + errorCatched + $(()=>{})\n' +
    '            g. 布局安全：无vh单位、无position:absolute、无min-height/overflow:auto\n' +
    '            h. 事件绑定：VARIABLE_INITIALIZED + VARIABLE_UPDATE_ENDED 均已绑定\n' +
    '            i. 隐藏接口：未使用Mvu.watch等不存在的接口\n' +
    '            j. ⚠️模块间一致性对照（核心）：\n' +
    '               - Step 3的id命名 vs Step 6的DOM操作目标 → 必须一一对应\n' +
    '               - Step 5的return字段名 vs Step 6的data.xxx引用 → 必须完全一致\n' +
    '               - Step 2的CSS变量名 vs Step 4的var(--xxx)引用 → 必须完全一致\n' +
    '               - Step 3的class命名 vs Step 4的选择器 → 必须一一对应\n' +
    '               - Step 1的变量路径 vs Step 5的_.get路径 → 必须完全一致\n' +
    '          ③ 告知用户"写卡器已自动拼接保存，可点预览查看效果"\n' +
    '        ⚠️禁止在Step 8重新输出各模块代码——写卡器会自动从之前各Step的代码块中提取拼接\n' +
    '        ⚠️Step 8不输出任何代码块，仅做文字确认和自查报告\n' +
    '\n' +
    '      【机制3：AI触发状态栏预览命令】\n' +
    '        当AI需要向用户展示当前已收集的状态栏效果时，在消息中输出 `<preview_statusbar>` 标记。\n' +
    '        写卡器会自动检测此标记，用当前已收集的模块拼接成完整HTML并在聊天界面中直接渲染。\n' +
    '        这样AI不需要在消息中输出冗长的HTML代码，用户也能实时看到效果。\n' +
    '        使用时机：模块收集完成后、用户说"让我看看""预览一下""效果如何"时。\n' +
    '\n' +
    '      【机制4：按语义精准修改】（核心！清空→逐个重新生成）\n' +
    '      当用户要求修改时，AI先识别涉及哪些Step，然后：\n' +
    '        ① 先输出清空标记 `<clear_statusbar>N1,N2,N3</clear_statusbar>`（N为Step号，逗号分隔）\n' +
    '           写卡器会立即清空这些模块，旧状态栏保持不变直到新模块全部完成\n' +
    '        ② 然后在同一个回答中生成第一个需要修改的模块（⚠️只能一个）\n' +
    '        ③ 后续模块等用户说"继续"后逐个生成\n' +
    '      示例：\n' +
    '        · 用户说"改配色" → 清空Step 2 → 生成新的Step 2\n' +
    '          AI输出：<clear_statusbar>2</clear_statusbar> + Step 2代码块\n' +
    '        · 用户说"换UI风格" → 清空Step 2+3+4 → 先生成Step 2，提醒"接下来需改Step 3和4，请说继续"\n' +
    '          AI输出：<clear_statusbar>2,3,4</clear_statusbar> + Step 2代码块\n' +
    '        · 用户说"渲染逻辑有bug" → 清空Step 6 → 生成新的Step 6\n' +
    '          AI输出：<clear_statusbar>6</clear_statusbar> + Step 6代码块\n' +
    '        · 用户说"加个新变量" → 清空Step 1+3+5+6 → 先生成Step 1，提醒"接下来需改Step 3/5/6"\n' +
    '          AI输出：<clear_statusbar>3,5,6</clear_statusbar> + Step 1变量表（Step 1是纯文本表格不需要清空）\n' +
    '      ⚠️修改前必须与已有模块对照、相互印证，确保修改后的模块与其他模块兼容\n' +
    '      ⚠️修改时同样禁止输出多个代码块，回答中只能有当前修改的那一个Step的代码块\n' +
    '      ⚠️修改后结尾同样必须提醒用户接下来该干什么\n' +
    '      ⚠️禁止"因为改一处就重写全部8步"——这是失败模式，会浪费token且引入新bug\n' +
    '      ⚠️修改后6个模块重新齐全时，写卡器自动拼接覆盖旧状态栏\n' +
    '\n' +
    '      【机制5：弱模型友好设计 + 完整性保障】\n' +
    '        · 每个Step都有明确示例，弱模型可直接套模板\n' +
    '        · 每个Step职责单一，代码量按需决定（简单状态栏每个Step可≤30行；超大型/复杂状态栏单个Step可上百行，不设上限）\n' +
    '        · 用户要"分步骤看"时，每步交付后停下等用户确认，避免长上下文丢失\n' +
    '        · ⚠️每次只做一个Step，禁止一次做多个——弱模型上下文短，单模块输出质量更高\n' +
    '        · Step 1是纯文本表格，不涉及代码，让弱模型先理清变量结构\n' +
    '        · Step 8由写卡器自动拼接，AI不需要重新输出代码，避免输出长度限制\n' +
    '        · 超大型状态栏建议：把变量按模块分组（核心状态/世界状态/角色关系/物品栏/技能栏/任务进度等），每个模块独立成块，便于扩展\n' +
    '        · ⚠️每个Step生成前，AI需在文字中简述"我将对照Step X的XXX来确保一致"，然后再输出代码块\n' +
    '        · ⚠️不管小型还是大型状态栏，都必须走完Step 2-7全部6个模块\n' +
    '        · ⚠️6个模块全部齐全后写卡器自动拼接保存，确保最终状态栏结构完整、样式完整、逻辑完整\n' +
    '        · ⚠️大型状态栏的优势：每个Step可以写很多代码（上百行），不受单次输出限制，复杂度由Step内部承担\n' +
    '\n' +
    '      ⚠️通用关键实现要求（每个Step都适用）：\n' +
    '        · 可用库：jquery、jqueryui、lodash、yaml、zod、toastr（无需import，直接使用）\n' +
    '        · 读变量：_.get(getAllVariables(), "stat_data", {}) （不要用Mvu.getVar，有时序失效问题）\n' +
    '        · 异步等待：await waitGlobalInitialized(\'Mvu\') 仅入口调用，此外禁止使用Mvu.watch等不存在的接口\n' +
    '        · DOM操作：必须用jquery（$(\'#id\').text/html/addClass），禁止原生document.getElementById/innerHTML/classList\n' +
    '        · 注释：只能用 /* 注释 */，禁止 // 注释（会导致渲染失败）\n' +
    '        · 异常捕获：函数经errorCatched包装后放入 $(() => {}) 加载，报错不卡死面板\n' +
    '        · 递归渲染：renderVarTree 递归处理任意深度嵌套对象（不要只渲染1层）\n' +
    '        · 跳过隐藏变量：key以 _ 或 $ 开头的 continue 跳过\n' +
    '        · 严格类型检测：typeof val === "number" 才画进度条（不要把字符串当数字）\n' +
    '        · 布尔仅✅/❌：不要加"是/否"文字\n' +
    '        · script标签：推荐 type="module" 支持顶层async/await；也可用 <script defer> 包IIFE兼容更老环境\n' +
    '      ⚠️CSS/布局约束（避免渲染异常）：\n' +
    '        · 禁用vh等受宿主高度影响的单位，用width+aspect-ratio让高度随宽度自适应\n' +
    '        · 避免 min-height、overflow:auto 等会强制撑高父容器的元素\n' +
    '        · 主体内容禁用 position:absolute 等脱离文档流的样式（页面必须有外部支撑）\n' +
    '        · 页面整体适配容器宽度，不产生横向滚动条\n' +
    '        · 卡片形状优先：除非用户明确要求，不要加背景颜色\n\n' +
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
    '        {"scriptName":"行动标签","findRegex":"/<action>(.*?)</action>/gi","replaceString":"**行动：**$1","placement":[0,1],"runOnEdit":true,"substituteRegex":0,"disabled":false},\n' +
    '        {"scriptName":"[美化]MVU状态栏","findRegex":"/<StatusPlaceHolderImpl\\\\/>/g","replaceString":"```html\\n<!doctype html>\\n<html>\\n<head>\\n  <style>...CSS变量配色...</style>\\n</head>\\n<body>\\n  <script type=\\"module\\">await waitGlobalInitialized(\'Mvu\')+getAllVariables()+递归renderVarTree+errorCatched</script>\\n</body>\\n</html>\\n```","placement":[2],"markdownOnly":true,"promptOnly":false,"runOnEdit":true,"substituteRegex":0,"minDepth":null,"maxDepth":null,"disabled":false}\n' +
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
    '- <自定义条目>：用户自定义内容\n' +
    '- [InitVar]初始变量：MVU变量系统初始值YAML（缩进表示层级，enabled=false禁用）\n' +
    '- 变量列表：MVU当前变量注入（含{{format_message_variable::stat_data}}宏）\n' +
    '- 变量更新规则：MVU变量更新分析规则（check条件、取值范围等）\n' +
    '- 变量输出格式：MVU<UpdateVariable>段输出格式定义（含JSON Patch命令）\n' +
    '- <状态变量输出>：输出当前变量状态给LLM的触发条目\n\n' +
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
    '| [InitVar]初始变量 | true | false | 4 | 4 | 200 | 0 | 0 | true | 100 | false | (空) | false | enabled=false |\n' +
    '| 变量列表 | true | false | 4 | 0 | 200 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| 变量更新规则 | true | false | 4 | 0 | 200 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| 变量输出格式 | true | false | 4 | 0 | 200 | 0 | 0 | true | 100 | false | (空) | false |\n' +
    '| <状态变量输出> | false | true | 2 | 2 | 45 | 0 | 3 | false | 100 | true | (空) | false |\n' +
    '注1：order=insertion_order，数字越大越靠后（影响越大）\n' +
    '注2：delay_until_recursion=true 表示仅在递归中触发，不直接触发\n' +
    '注3：叙事类条目开启delay_until_recursion，作为背景补充被其他条目递归带出\n' +
    '注4：<核心铁则>不放在世界书条目中，而是放入post_history_instructions字段（最高权重位）\n' +
    '注5：[InitVar]条目必须enabled=false（禁用），MVU只读取禁用的initvar条目进行初始化\n' +
    '注6：MVU脚本（bundle.js/zod schema）和正则1-5由写卡器自动注入，无需AI生成；正则6（美化状态栏）和世界书条目需AI生成\n\n' +
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
    '- 正则脚本可通过 placement=[4] (World Info) 处理世界书条目注入前的内容\n' +
    '- placement 值定义：1=用户输入, 2=AI输出, 3=斜杠命令, 4=世界书\n' +
    '- 典型协同场景：\n' +
    '  1. 模板变量替换：WI条目中写{{玩家名}}，用正则替换为{{user}}\n' +
    '     findRegex="/\\{\\{玩家名\\}\\}/gi", replaceString="{{user}}", placement=[4], substituteRegex=1\n' +
    '  2. 统一格式化：WI条目内容风格不统一时，用正则自动调整格式\n' +
    '     如自动给所有"规则:"开头的行加粗：findRegex="/^(规则[:：].*)$/gm", replaceString="**$1**", placement=[4]\n' +
    '  3. 敏感内容过滤：WI条目中包含需要过滤的词汇\n' +
    '     findRegex="/(禁词)/gi", replaceString="***", placement=[4]\n' +
    '  4. 动态状态注入：WI触发后，用正则在AI回复中检测并格式化状态信息\n' +
    '     WI条目注入"战斗规则" → 正则在AI回复中格式化战斗结果\n' +
    '- 注意事项：\n' +
    '  · placement=[4]的正则需要"Alter Outgoing Prompt"开启（即promptOnly不单独勾选）\n' +
    '  · 正则处理WI内容的执行顺序：WI条目注入 → 正则处理 → 最终提示词组装\n' +
    '  · 一个正则脚本可同时处理多个位置（如placement=[1,2,4]）\n\n' +
    '**🔗 MVU变量系统设计模式（MagVarUpdate zod，进阶可选）**：\n' +
    '- 模式1：分层变量结构\n' +
    '  · 原理：按角色/世界/物品等分类用YAML缩进嵌套，如 白娅:\\n  依存度: 35\\n  着装:\\n    上装: 校服\n' +
    '  · 优势：结构清晰，LLM更容易理解变量归属和关系，引导更准确的变量更新\n' +
    '  · 注意：YAML用缩进表示层级，冒号后空格建立从属；数值/文本/真假值三种基本类型\n' +
    '- 模式2：开局变量初始化\n' +
    '  · 原理：在额外问候语(alternate_greetings)中加入<UpdateVariable><initvar>块，覆盖[InitVar]默认值\n' +
    '  · 格式：<UpdateVariable>\\n<initvar>\\n白娅:\\n  依存度: 15\\n</initvar>\\n</UpdateVariable>\n' +
    '  · 用途：不同开局有不同的初始变量（如不同身份有不同道具/属性）\n' +
    '- 模式3：变量驱动的分段内容\n' +
    '  · 原理：用提示词模板语法 + getvar("stat_data") 实现根据变量值显示不同内容\n' +
    '  · 格式：<% if (getvar("stat_data.白娅.依存度") >= 50) { %>...<% } %>\n' +
    '  · 注意：第一个if用 typeof 检查变量是否初始化完成，避免模板报错\n' +
    '- 模式4：状态栏占位符\n' +
    '  · 原理：变量输出格式定义AI输出<StatusPlaceHolderImpl/>，正则替换为状态栏HTML\n' +
    '  · 用途：状态栏自动显示当前变量值，无需AI输出完整状态栏文本\n' +
    '- 模式5：变量更新回调（高阶，需JS能力）\n' +
    '  · 原理：监听 mag_variable_updated / mag_variable_update_ended 事件\n' +
    '  · 用途：LLM忘记更新时自动补全（如日期自动+1）、触发特殊逻辑\n' +
    '  · 参考：MagVarUpdate example_src\n' +
    '- MVU zod安装清单：\n' +
    '  1. MVU本体脚本：import \'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js\'【写卡器自动注入】\n' +
    '  2. 世界书调用脚本(WTC)：用 <observed_piece class="剧情/设定"> 包裹世界书内容，让AI区分剧情与设定【写卡器自动注入】\n' +
    '  3. 变量结构脚本：zod 4 schema + registerMvuSchema 注册【写卡器自动注入】\n' +
    '  4. 正则脚本：正则1-5由写卡器自动注入（思维链移除/变量更新截断/变量美化×2/状态栏隐藏）；正则6（美化状态栏）⚠️必须由AI生成\n' +
    '  5. 开场白占位符：<StatusPlaceHolderImpl/> 自动追加到 first_mes【写卡器自动注入】\n' +
    '  6. 世界书条目：[InitVar]初始变量(YAML) + 变量列表 + [mvu_update]变量更新规则 + [mvu_update]变量输出格式【AI生成】\n\n' +
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
    '**步骤7：配变量系统**（MVU变量系统，进阶可选）\n' +
    '- 确定是否需要MVU变量系统（如需复杂状态管理、好感度系统等）\n' +
    '- 设计变量结构（按角色/物品/状态分层嵌套）\n' +
    '- 编写[InitVar]初始变量YAML\n' +
    '- 编写变量更新规则条目\n' +
    '- 正则1-5（思维链移除/变量更新截断/变量美化×2/状态栏隐藏）由写卡器自动注入，无需生成\n' +
    '- ⚠️【重中之重】生成正则6（美化状态栏）：必须按以下UI/UX规范生成，美观度对齐参考卡片，严禁敷衍：\n' +
    '  · 【配置固定】findRegex="/<StatusPlaceHolderImpl\\\\/>/g", placement=[2], markdownOnly=true, promptOnly=false, runOnEdit=true, substituteRegex=0\n' +
    '  · 【包裹格式】replaceString必须是完整HTML结构（<!doctype html>→html→head(style)→body(script type=module)），用```html代码块包裹\n' +
    '  · 【读变量】getAllVariables() + _.get(allVars,"stat_data",{})（不要用Mvu.getVar，有时序失效问题）\n' +
    '  · 【异步等待】await waitGlobalInitialized(\'Mvu\') 后再绑定 Mvu.events.VARIABLE_INITIALIZED + VARIABLE_UPDATE_ENDED 两个事件\n' +
    '  · 【异常捕获】$(errorCatched(init)) 包裹，报错不卡死面板\n' +
    '  · 【配色主题（核心！必须用CSS变量）】建议用低饱和柔色系（深色毛玻璃/浅色系二选一），:root定义变量便于换主题：\n' +
    '    - 深色毛玻璃主题（推荐）：--card-bg: rgba(30,35,45,0.82); backdrop-filter: blur(6px); 搭配 --accent-blue:#93c5fd / --accent-green:#86efac / --accent-red:#fca5a5 / --text-sub:#94a3b8\n' +
    '    - 浅色舒适主题：--card-bg: linear-gradient(145deg,#f7f9fc,#eef2f7); 搭配柔和主色蓝/紫/绿色系\n' +
    '  · 【布局结构（核心！严禁平铺直叙）】：\n' +
    '    - 必须用 CSS Grid 响应式布局：.stat-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 4px 16px; }\n' +
    '    - 分类标题：.category-title { font-weight:600; 带▸图标 + border-bottom分隔线; 区分不同对象分组 }\n' +
    '    - 层级缩进：.indent-1/2/3/4 { padding-left: 8px/20px/32px/44px; } 按嵌套深度缩进\n' +
    '    - 单行项：.stat-item  flex + justify-content: space-between + align-items: flex-start + gap:8px + hover背景高亮(.hover-bg)\n' +
    '  · 【递归渲染规范（核心！严禁只遍历一层）】：\n' +
    '    - function renderTree(obj, level) { level = level || 0; }\n' +
    '    - 过滤 if (key.startsWith(\'_\') || key.startsWith(\'$\')) continue; // 跳过隐藏变量\n' +
    '    - 嵌套对象：先flush当前itemsHtml为.stat-grid，再输出.category-title（level>0时），然后递归renderTree(value, level+1)\n' +
    '    - 数值typeof==="number" → .value-number着色（蓝/主题色）\n' +
    '    - 布尔typeof==="boolean" → value-true ✓ / value-false ✕（绿/红分色，不用emoji✅❌）\n' +
    '    - 数组Array.isArray(value) → .value-text 显示 [a, b, c]\n' +
    '    - 其他字符串/null/undefined → .value-text 文本显示\n' +
    '  · 【动效（点睛）】：\n' +
    '    - 加载中：.loading-state text-align:center + @keyframes breathe 呼吸动画（opacity 0.5↔0.9）\n' +
    '    - 刷新：.flash-update + @keyframes fadeIn（opacity 0.6→1） + setTimeout 300ms 移除class\n' +
    '    - hover过渡：transition: background/color 等加 0.2s ease\n' +
    '  · 【类型检测】严格 typeof value === "number" 严格检测，禁止字符串数字判断\n' +
    '  · 【根据题材定制】修仙（修仙→境界灵力条/末世→生命物资条/校园→好感度条/校园恋爱→心形好感度图标，但默认数值着色也行，务必主题风格统一\n' +
    '  · 【严禁偷工减料检查】输出前自查：有没有 Grid布局✓、分类标题✓、indent缩进类✓、hover✓、Array处理✓、两个事件绑定✓、flash更新动画✓、loading动画✓\n' +
    '- 生成[InitVar]初始变量、变量更新规则、变量输出格式条目\n\n' +
    '=== 质量检查标准（32项核心 + 6项附加） ===\n\n' +
    '**基础字段检查（8项）：**\n' +
    '- [ ] name：世界名称明确，体现核心主题\n' +
    '- [ ] description：包含世界核心设定（400字以上）\n' +
    '- [ ] personality：空字符串""（世界模式强制留空）\n' +
    '- [ ] scenario：空字符串""（世界模式强制留空）\n' +
    '- [ ] first_mes：开场白（500字以上）\n' +
    '- [ ] system_prompt：身份定位（50字以内）\n' +
    '- [ ] post_history_instructions：核心铁则（100字以内，最高权重）\n' +
    '- [ ] tags：2-12个标签\n\n' +
    '**高价值字段检查（4项）：**\n' +
    '- [ ] mes_example：1-2组对话示例\n' +
    '- [ ] alternate_greetings：3个差异化开局\n' +
    '- [ ] depth_prompt：新手引导内容（depth=0）\n' +
    '- [ ] regex_scripts：基础状态同步正则\n\n' +
    '**世界书基础检查（6项）：**\n' +
    '- [ ] 条目数：12-30条\n' +
    '- [ ] 触发词覆盖率：≥50%\n' +
    '- [ ] 条目内容：≥250字/条\n' +
    '- [ ] 条目命名规范：≥50%使用规范前缀\n' +
    '- [ ] 权重合理：核心规则在高权重位\n' +
    '- [ ] content自包含性：无"如上所述"等上下文依赖词\n\n' +
    '**世界书高级功能检查（8项，进阶可选）：**\n' +
    '- [ ] 递归链条：实体条目关联背景叙事条目（delay_until_recursion）\n' +
    '- [ ] 分组机制：场景变体/难度分层使用group分组\n' +
    '- [ ] 次级键过滤：复杂条件条目使用secondary_keys + selectiveLogic\n' +
    '- [ ] 概率事件：随机天气/彩蛋/遭遇使用probability\n' +
    '- [ ] 正则触发：需要精确匹配说话者时使用\\x01正则键\n' +
    '- [ ] 组评分：大分组条目使用use_group_scoring提升精准度\n' +
    '- [ ] sticky/cooldown冲突：不同时在一条目设置两者\n' +
    '- [ ] position配置：constant条目position≤1，position=6/7需配对应字段\n\n' +
    '**正则脚本检查（6项）：**\n' +
    '- [ ] 脚本功能单一：每个脚本只做一件事\n' +
    '- [ ] 正则标志正确：全局匹配加g，中文场景加i\n' +
    '- [ ] 非贪婪匹配：使用.*?避免过度匹配\n' +
    '- [ ] placement配置：至少设置1个应用位置\n' +
    '- [ ] substituteRegex范围：在0-2范围内\n' +
    '- [ ] runOnEdit：状态栏类脚本建议开启\n\n' +
    '**运行效果检查（3项）：**\n' +
    '- [ ] 常驻Token总量：≤500\n' +
    '- [ ] 递归安全：实体类条目开启prevent_recursion\n' +
    '- [ ] 冷却防抖：场景类条目开启cooldown\n\n' +
    '**附加检查（6项，不计入核心）：**\n' +
    '- [ ] 触发词精准度：无"的""是"等泛用词\n' +
    '- [ ] 上下文占用估算：8k窗口≤60%\n' +
    '- [ ] 中文适配：match_whole_words未错误开启\n' +
    '- [ ] 创作者备注≤100字\n' +
    '- [ ] 常驻条目group冲突检测\n' +
    '- [ ] Outlet限制检查（如有）\n\n' +
    '**MVU变量系统检查（7项，进阶可选）：**\n' +
    '- [ ] 初始变量：[InitVar]条目存在，YAML格式合法（缩进表示层级）\n' +
    '- [ ] InitVar禁用：[InitVar]条目enabled=false（MVU只读禁用条目做初始化）\n' +
    '- [ ] 变量格式：每个变量有明确初始值，变量名以_/$前缀标注可见性\n' +
    '- [ ] 变量列表：含{{format_message_variable::stat_data}}宏\n' +
    '- [ ] 变量更新规则：<变量更新规则>条目存在，格式说明清晰\n' +
    '- [ ] 变量输出格式：定义<UpdateVariable>段的输出格式\n' +
    '- [ ] 变量分层：变量结构按角色/物品/状态等合理分层嵌套\n' +
    '- [ ] 美化状态栏正则：regex_scripts中含StatusPlaceHolderImpl的markdownOnly正则（正则6，AI生成）\n' +
    '注：脚本（bundle.js/zod schema）、正则1-5、StatusPlaceHolderImpl占位符由写卡器导出时自动注入；正则6（美化状态栏）必须由AI生成\n\n' +
    '=== MVU 酒馆助手脚本 API ===\n\n' +
    '**脚本侧变量约定**：\n' +
    '- 变量名以 `_` 开头：AI 不可更新（仅脚本能改），如 `_internal_state`\n' +
    '- 变量名以 `$` 开头：AI 不可见（不发给 AI），如 `$secret_flag`\n\n' +
    '**MVU 事件系统**：\n' +
    '- `Mvu.events.VARIABLE_INITIALIZED`：变量初始化完成（仅新开聊天时触发）\n' +
    '- `Mvu.events.VARIABLE_UPDATE_STARTED`：变量更新开始\n' +
    '- `Mvu.events.COMMAND_PARSED`：变量更新命令解析完成（可修复命令）\n' +
    '- `Mvu.events.VARIABLE_UPDATE_ENDED`：变量更新结束（可做后处理）\n' +
    '- `Mvu.events.BEFORE_MESSAGE_UPDATE`：变量存入楼层前\n\n' +
    '**核心 API**：\n' +
    '- `Mvu.getMvuData({type, message_id})`：获取指定楼层的变量数据\n' +
    '- `Mvu.replaceMvuData(data, {type, message_id})`：写回变量到楼层\n' +
    '- `Mvu.parseMessage(text, data)`：解析文本中的<JSONPatch>更新命令\n' +
    '- `Mvu.getVar(path)`：获取当前变量路径值\n' +
    '- `injectPrompts([...])`：注入仅用于绿灯激活的提示词（含 filter 条件）\n\n' +
    '**典型脚本示例**：\n' +
    '```javascript\n' +
    'await waitGlobalInitialized("Mvu");\n' +
    '// 监听变量更新结束，限制好感度单次变动幅度\n' +
    'eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (new_vars, old_vars) => {\n' +
    '  const old_val = _.get(old_vars, "stat_data.白娅.依存度");\n' +
    '  _.update(new_vars, "stat_data.白娅.依存度", v => _.clamp(v, old_val - 3, old_val + 3));\n' +
    '});\n' +
    '// 用变量值激活绿灯\n' +
    'eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, vars => {\n' +
    '  const val = _.get(vars, "stat_data.白娅.依存度");\n' +
    '  injectPrompts([{id:"激活-依存度", content:"白娅阶段" + (val<40?"二":val<60?"三":val<80?"四":"五"), position:"none", depth:0, should_scan:true}]);\n' +
    '});\n' +
    '```\n\n' +
    '=== 状态栏格式（9体系） ===\n\n' +
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
    '<li><b>📊 变量系统</b>：[✅/⏳/❌] - [摘要]（进阶可选）</li>\n' +
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

  // ===== 提取条目的规范前缀（用于智能匹配） =====
  function extractEntryPrefix(comment) {
    if (!comment) return '';
    var m = String(comment).match(/^<([^>]+)>/);
    if (m) return m[1];
    var m2 = String(comment).match(/^\[([^\]]+)\]/);
    if (m2) return '[' + m2[1] + ']';
    return '';
  }

  // ===== 智能查找匹配条目：精确匹配 -> 同类型单条匹配 -> 内容相似度匹配 =====
  function findMatchingEntry(newEntry, existingArr) {
    if (!newEntry || !existingArr || !existingArr.length) return -1;
    var neComment = newEntry.comment || '';
    var neContent = (newEntry.content || '').trim();
    var nePrefix = extractEntryPrefix(neComment);

    // 第1优先级：精确 comment 匹配（最可靠）
    var exactIdx = existingArr.findIndex(function(e) { return (e.comment || '') === neComment; });
    if (exactIdx >= 0) return { index: exactIdx, mode: 'exact' };

    // 第2优先级：同规范前缀下只有1条现有条目（AI改了comment后缀但前缀一致，如<基础公理>世界→<基础公理>力量体系）
    if (nePrefix) {
      var samePrefixEntries = existingArr.map(function(e, i) {
        return { i: i, p: extractEntryPrefix(e.comment), c: (e.content || '').trim() };
      }).filter(function(x) { return x.p === nePrefix; });
      if (samePrefixEntries.length === 1) {
        return { index: samePrefixEntries[0].i, mode: 'prefix-single' };
      }
      // 第3优先级：同前缀下内容相似度最高（Jaccard字符集重合度>0.4）
      if (samePrefixEntries.length > 1 && neContent.length > 20) {
        var neCharSet = {};
        for (var ci = 0; ci < neContent.length; ci++) neCharSet[neContent[ci]] = true;
        var best = null;
        samePrefixEntries.forEach(function(x) {
          var inter = 0, uni = 0;
          var exSet = {};
          for (var cj = 0; cj < x.c.length; cj++) exSet[x.c[cj]] = true;
          for (var k in neCharSet) { if (neCharSet.hasOwnProperty(k)) { if (exSet[k]) inter++; uni++; } }
          for (var k2 in exSet) { if (exSet.hasOwnProperty(k2) && !neCharSet[k2]) uni++; }
          var sim = uni > 0 ? inter / uni : 0;
          if (sim > 0.35 && (!best || sim > best.sim)) best = { i: x.i, sim: sim };
        });
        if (best) return { index: best.i, mode: 'prefix-similarity' };
      }
    }
    return { index: -1, mode: 'none' };
  }

  // ===== 增量合并（修复版：智能匹配 + 变更记录 + 删改可追溯） =====
  function mergePartial(partial, cd, options) {
    if (!partial || typeof partial !== 'object') return false;
    options = options || {};
    var modified = false;
    var changeLog = { added: 0, updated: 0, deleted: 0, fieldUpdates: 0 };

    if (partial.character && !partial.spec) {
      var ch = partial.character;
      delete partial.character;
      for (var k in ch) { if (ch.hasOwnProperty(k)) partial[k] = ch[k]; }
    }

    // ---- 支持多种删除语法 ----
    var deletePaths = [];
    if (partial.deleted_entries && Array.isArray(partial.deleted_entries)) {
      partial.deleted_entries.forEach(function(c) { deletePaths.push('character_book.entries.' + c); });
      delete partial.deleted_entries;
    }
    // 兼容 AI 可能写的其他字段名
    ['_delete', 'delete', 'deletes', 'remove', 'removes'].forEach(function(dk) {
      if (partial[dk] && Array.isArray(partial[dk])) {
        deletePaths = deletePaths.concat(partial[dk]);
        delete partial[dk];
      }
    });
    // 兼容 entries 内单条的 { ..., "_action":"delete" } 语法（AI最容易写成这样）
    var inlineEntryDeletes = [];
    var scanInlineDeletes = function(arr) {
      if (!arr || !Array.isArray(arr)) return;
      for (var di = arr.length - 1; di >= 0; di--) {
        if (arr[di] && (arr[di]._action === 'delete' || arr[di]._action === 'remove' || arr[di].delete === true)) {
          if (arr[di].comment) inlineEntryDeletes.push(arr[di].comment);
          arr.splice(di, 1);
        }
      }
    };
    scanInlineDeletes(partial.entries);
    if (partial.character_book && partial.character_book.entries) scanInlineDeletes(partial.character_book.entries);
    inlineEntryDeletes.forEach(function(ic) { deletePaths.push('character_book.entries.' + ic); });

    // ---- 执行删除 ----
    if (deletePaths.length > 0) {
      var entryPrefix = 'character_book.entries.';
      var fieldDeletes = [];
      // 收集所有数字索引，稍后降序处理避免位移
      var numericIndices = [];
      deletePaths.forEach(function(path) {
        if (String(path).indexOf(entryPrefix) === 0) {
          var entryKey = String(path).slice(entryPrefix.length);
          if (cd.character_book && cd.character_book.entries) {
            var beforeLen = cd.character_book.entries.length;
            var idx = parseInt(entryKey);
            if (!isNaN(idx) && String(idx) === entryKey && idx >= 0 && idx < beforeLen) {
              // 数字索引：先收集，稍后统一降序删除避免位移
              numericIndices.push(idx);
            } else {
              // 安全删除策略：精确匹配优先，模糊匹配仅作兜底且有严格保护
              var exactMatches = [];
              var fuzzyMatches = [];
              cd.character_book.entries.forEach(function(e, i) {
                var ec = e.comment || '';
                if (ec === entryKey) {
                  exactMatches.push(i);
                } else if (entryKey.length >= 6 && ec.length >= 6) {
                  // 模糊匹配：仅「现有comment包含entryKey」单向匹配，不再反向匹配
                  // 且要求关键词≥6字（避免"基础设定"这种4字短词误删多条）
                  if (ec.indexOf(entryKey) >= 0) fuzzyMatches.push(i);
                }
              });
              var toDelete = [];
              if (exactMatches.length > 0) {
                // 精确匹配命中→只删精确匹配的，不动模糊匹配（防止误删同名前缀的其他条目）
                toDelete = exactMatches;
              } else if (fuzzyMatches.length === 1) {
                // 没有精确匹配，模糊匹配恰好1条→安全删除
                toDelete = fuzzyMatches;
              } else if (fuzzyMatches.length > 1) {
                // 模糊匹配多条→不删！防止多删。记录警告
                console.warn('[mergePartial] 删除关键词"' + entryKey + '"模糊匹配到' + fuzzyMatches.length + '条条目，为防止误删已跳过。请使用精确comment。');
              }
              // 没有精确也没有模糊→静默不删（可能comment拼写错误）
              if (toDelete.length > 0) {
                // 降序删除避免索引位移
                toDelete.sort(function(a, b) { return b - a; });
                for (var di = 0; di < toDelete.length; di++) {
                  cd.character_book.entries.splice(toDelete[di], 1);
                }
                modified = true;
                changeLog.deleted += toDelete.length;
              }
            }
          }
        } else {
          // 裸字符串（无 character_book.entries. 前缀）
          // 安全处理：如果看起来像条目名（不含.且非已知顶层字段），尝试作为comment匹配
          var rawPath = String(path);
          var knownTopFields = ['name','description','first_mes','system_prompt','personality','scenario','creator_notes','mes_example','post_history_instructions','tags','alternate_greetings'];
          if (rawPath.indexOf('.') < 0 && knownTopFields.indexOf(rawPath) < 0 && cd.character_book && cd.character_book.entries) {
            // 当作条目comment处理
            var foundIdx = -1;
            for (var fi = 0; fi < cd.character_book.entries.length; fi++) {
              if ((cd.character_book.entries[fi].comment || '') === rawPath) { foundIdx = fi; break; }
            }
            if (foundIdx >= 0) {
              cd.character_book.entries.splice(foundIdx, 1);
              modified = true; changeLog.deleted++;
            }
          } else {
            fieldDeletes.push(path);
          }
        }
      });
      // 数字索引降序删除
      if (numericIndices.length > 0) {
        numericIndices.sort(function(a, b) { return b - a; });
        // 去重
        var uniqueIdx = [];
        numericIndices.forEach(function(n) { if (uniqueIdx.indexOf(n) < 0) uniqueIdx.push(n); });
        uniqueIdx.forEach(function(idx) {
          if (idx < cd.character_book.entries.length) {
            cd.character_book.entries.splice(idx, 1);
            modified = true; changeLog.deleted++;
          }
        });
      }
      fieldDeletes.forEach(function(p) {
        var parts = String(p).split('.');
        var node = cd;
        for (var i = 0; i < parts.length - 1; i++) {
          if (!node || typeof node !== 'object' || !(parts[i] in node)) { node = null; break; }
          node = node[parts[i]];
        }
        if (node && typeof node === 'object' && parts[parts.length - 1] in node) {
          delete node[parts[parts.length - 1]];
          modified = true; changeLog.deleted++;
        }
      });
    }
    delete partial._nochange;

    // 世界书名称字段已移除
    if (partial.character_book) {
      delete partial.character_book.name;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }

    // ---- 处理 entries（修复：智能匹配+content过短时也允许更新非content字段） ----
    var processEntriesFn = function(newEntries) {
      if (!newEntries || !Array.isArray(newEntries)) return;
      cd.character_book = cd.character_book || { entries: [] };
      var existing = cd.character_book.entries || [];
      newEntries.forEach(function(ne) {
        if (!ne || typeof ne !== 'object') return;
        var hasComment = !!(ne.comment && String(ne.comment).trim());
        var hasMeaningfulContent = !!(ne.content && String(ne.content).trim().length >= 20);
        // 至少要有 comment，或（有 content 且 >20字）—— 两者全无才跳过
        if (!hasComment && !hasMeaningfulContent) return;

        var tmpl = getEntryTemplate(ne.comment || '');
        ne.enabled = (tmpl && tmpl.enabled !== undefined) ? tmpl.enabled : true;
        if (String(ne.comment || '').indexOf('变量列表') >= 0 && typeof ne.content === 'string') {
          ne.content = normalizeVarListContent(ne.content);
        }
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
        if (!ne.keys) ne.keys = [];
        if (!ne.secondary_keys) ne.secondary_keys = [];

        var match = findMatchingEntry(ne, existing);
        if (match.index >= 0) {
          // 更新：深合并content优先（如果新content有内容就覆盖，没内容保留旧content）
          var oldEntry = existing[match.index];
          if (ne.content === undefined || String(ne.content).trim().length === 0) {
            // 新条目没提供content，保留旧的
            var tmpContent = oldEntry.content;
            existing[match.index] = Object.assign({}, oldEntry, ne);
            existing[match.index].content = tmpContent;
          } else {
            existing[match.index] = Object.assign({}, oldEntry, ne);
          }
          modified = true; changeLog.updated++;
        } else {
          existing.push(ne);
          modified = true; changeLog.added++;
        }
      });
      cd.character_book.entries = existing;
    };

    // 顶层 entries 优先处理
    if (partial.entries && Array.isArray(partial.entries)) {
      processEntriesFn(partial.entries);
      delete partial.entries;
    }
    // character_book.entries 后处理（避免与顶层重复：如果顶层已处理，此处跳过）
    if (partial.character_book && partial.character_book.entries && Array.isArray(partial.character_book.entries)) {
      processEntriesFn(partial.character_book.entries);
      // 不删除整个 character_book，只删除 entries 字段，避免其他信息丢失
      delete partial.character_book.entries;
      if (Object.keys(partial.character_book).length === 0) delete partial.character_book;
    }
    var fields = ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','tags','creator','character_version','alternate_greetings','group_only_greetings'];
    fields.forEach(function(f) {
      if (partial[f] !== undefined) {
        var val = partial[f];
        var oldVal = cd[f];
        if (f === 'first_mes' || f === 'description') {
          // 放宽占位符过滤：只有同时满足「文本非常短(<80字)」+「整段内容几乎全是占位词」时才跳过
          if (typeof val === 'string') {
            var vTrim = val.trim();
            if (vTrim.length < 80) {
              var hasPlaceholder = /正文已在上方|见上方|参见上文|见上文|已在上方|请见上文/.test(vTrim);
              var isOnlyPlaceholder = vTrim.length < 30 && hasPlaceholder;
              if (isOnlyPlaceholder) return;
            }
          }
          // 极短内容且仅含"输出"提示词时跳过（长度<30字+含「已输出/上文输出/见上文输出」）
          if (typeof val === 'string' && val.trim().length < 30 && /(已输出|上文输出|见上文.*输出)/.test(val)) {
            return;
          }
        }
        if (JSON.stringify(oldVal) !== JSON.stringify(val)) {
          cd[f] = val;
          modified = true; changeLog.fieldUpdates++;
        }
      }
    });

    if (partial.depth_prompt !== undefined) {
      cd.extensions = cd.extensions || {};
      cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
      cd.depth_prompt = cd.depth_prompt || { prompt: '', depth: 0, role: 'system' };
      var dp = partial.depth_prompt;
      var dpModified = false;
      if (typeof dp === 'string') {
        if (dp.trim().length > 0 && cd.extensions.depth_prompt.prompt !== dp) {
          cd.extensions.depth_prompt.prompt = dp;
          cd.depth_prompt.prompt = dp;
          dpModified = true;
        }
      } else if (dp && typeof dp === 'object') {
        if (dp.prompt !== undefined && typeof dp.prompt === 'string') {
          // 放宽：允许空字符串（显式清空），只有 undefined 才跳过
          if (cd.extensions.depth_prompt.prompt !== dp.prompt) {
            cd.extensions.depth_prompt.prompt = dp.prompt;
            cd.depth_prompt.prompt = dp.prompt;
            dpModified = true;
          }
        }
        if (dp.depth !== undefined && typeof dp.depth === 'number' && dp.depth >= 0 && cd.extensions.depth_prompt.depth !== dp.depth) {
          cd.extensions.depth_prompt.depth = dp.depth;
          cd.depth_prompt.depth = dp.depth;
          dpModified = true;
        }
        if (dp.role !== undefined && ['system', 'user', 'assistant', 0, 1, 2].indexOf(dp.role) >= 0 && cd.extensions.depth_prompt.role !== dp.role) {
          cd.extensions.depth_prompt.role = dp.role;
          cd.depth_prompt.role = dp.role;
          dpModified = true;
        }
      }
      if (dpModified) { modified = true; changeLog.fieldUpdates++; }
      delete partial.depth_prompt;
    }

    // ---- 智能合并 regex_scripts：支持增量更新、按名替换、_action:delete ----
    var mergeRegexScripts = function(newRxList) {
      if (!Array.isArray(newRxList)) return;
      cd.extensions = cd.extensions || {};
      var existingRx = cd.extensions.regex_scripts || [];
      var beforeSnapshot = JSON.stringify(existingRx);
      newRxList.forEach(function(s) {
        if (!s || typeof s !== 'object') return;
        // 删除：_action:delete 或 delete:true
        if (s._action === 'delete' || s._action === 'remove' || s.delete === true) {
          var beforeLen = existingRx.length;
          existingRx = existingRx.filter(function(es) {
            if (s.id && es.id === s.id) return false;
            if (s.scriptName && es.scriptName === s.scriptName) return false;
            if (s.name && !es.scriptName && es.name === s.name) return false;
            // 关键词匹配删除
            if (s.findRegex && es.findRegex === s.findRegex) return false;
            return true;
          });
          if (existingRx.length !== beforeLen) { changeLog.deleted += (beforeLen - existingRx.length); }
          return;
        }
        if (!s.findRegex || !String(s.findRegex).trim()) return;
        if (s.replaceString === undefined) return;
        // 更新/新增：按 id 或 scriptName/name 或 findRegex 匹配
        var idx = existingRx.findIndex(function(es) {
          if (s.id && es.id === s.id) return true;
          if (s.scriptName && es.scriptName === s.scriptName) return true;
          if (s.name && !es.scriptName && es.name === s.name) return true;
          if (s.findRegex && es.findRegex === s.findRegex) return true;
          return false;
        });
        if (idx >= 0) {
          existingRx[idx] = Object.assign({}, existingRx[idx], s);
          delete existingRx[idx]._action;
          changeLog.updated++;
        } else {
          existingRx.push(s);
          changeLog.added++;
        }
      });
      cd.extensions.regex_scripts = existingRx;
      if (JSON.stringify(existingRx) !== beforeSnapshot) modified = true;
    };

    if (partial.regex_scripts !== undefined) {
      mergeRegexScripts(partial.regex_scripts);
      delete partial.regex_scripts;
    }

    // 名称变化时自动更新世界书名称
    if (partial.name && cd.character_book) {
      // 参考文件中 character_book 不包含 name 字段，此处无需更新
    }

    if (partial.extensions) {
      cd.extensions = cd.extensions || {};
      var extProcessedKeys = {}; // 防止与顶层重复处理
      for (var ek in partial.extensions) {
        if (partial.extensions.hasOwnProperty(ek)) {
          if (ek === 'depth_prompt') {
            // 顶层已处理过 depth_prompt（delete partial.depth_prompt 已执行），这里仅当 partial.extensions 有独立配置时处理
            cd.extensions.depth_prompt = cd.extensions.depth_prompt || { prompt: '', depth: 0, role: 'system' };
            var dp2 = partial.extensions.depth_prompt;
            var beforeDp = JSON.stringify(cd.extensions.depth_prompt);
            if (typeof dp2 === 'string') {
              if (dp2.trim().length > 0) cd.extensions.depth_prompt.prompt = dp2;
            } else if (dp2 && typeof dp2 === 'object') {
              if (dp2.prompt !== undefined) cd.extensions.depth_prompt.prompt = dp2.prompt;
              if (dp2.depth !== undefined && typeof dp2.depth === 'number' && dp2.depth >= 0) cd.extensions.depth_prompt.depth = dp2.depth;
              if (dp2.role !== undefined) cd.extensions.depth_prompt.role = dp2.role;
            }
            if (JSON.stringify(cd.extensions.depth_prompt) !== beforeDp) { modified = true; changeLog.fieldUpdates++; }
          } else if (ek === 'regex_scripts') {
            // 顶层已处理，此处仅当顶层未处理（没有顶层 regex_scripts 字段）时处理
            if (partial['regex_scripts'] === undefined) mergeRegexScripts(partial.extensions.regex_scripts);
          } else if (ek === 'tavern_helper') {
            // 修复版：支持脚本删除 / 按 id/name 替换，不再只追加
            if (partial.extensions[ek] && typeof partial.extensions[ek] === 'object') {
              cd.extensions = cd.extensions || {};
              if (!cd.extensions[ek]) cd.extensions[ek] = { scripts: [], variables: {} };
              var thBefore = JSON.stringify(cd.extensions[ek]);
              // === scripts：支持替换/删除/追加 ===
              var thScripts = cd.extensions[ek].scripts || [];
              var newTHScripts = partial.extensions[ek].scripts || [];
              // 如果 AI 明确输出 _action:reset 或 scripts 显式置空数组，允许清空（用于「重写 tavern_helper」场景）
              var resetScripts = partial.extensions[ek]._action === 'reset' || partial.extensions[ek].reset_scripts === true;
              if (resetScripts) { thScripts = []; }
              newTHScripts.forEach(function(ns) {
                if (!ns || typeof ns !== 'object') return;
                if (ns._action === 'delete' || ns._action === 'remove' || ns.delete === true) {
                  thScripts = thScripts.filter(function(es) {
                    if (ns.id && es.id === ns.id) return false;
                    if (ns.name && es.name === ns.name) return false;
                    return true;
                  });
                  return;
                }
                var existsIdx = thScripts.findIndex(function(es) {
                  return (ns.id && es.id === ns.id) || (ns.name && es.name === ns.name);
                });
                if (existsIdx >= 0) {
                  thScripts[existsIdx] = Object.assign({}, thScripts[existsIdx], ns);
                  delete thScripts[existsIdx]._action;
                } else {
                  thScripts.push(ns);
                }
              });
              cd.extensions[ek].scripts = thScripts;
              // === variables：支持删除/替换 ===
              if (partial.extensions[ek].variables) {
                var vars = partial.extensions[ek].variables;
                if (vars && typeof vars === 'object') {
                  var curVars = cd.extensions[ek].variables || {};
                  // 支持 { key: null } 或 { key: {_action:"delete"} } 表示删除
                  Object.keys(vars).forEach(function(vk) {
                    if (vars[vk] === null || vars[vk] === undefined || (vars[vk] && typeof vars[vk] === 'object' && (vars[vk]._action === 'delete' || vars[vk].delete === true))) {
                      if (vk in curVars) delete curVars[vk];
                    } else {
                      curVars[vk] = vars[vk];
                    }
                  });
                  cd.extensions[ek].variables = curVars;
                }
              }
              if (JSON.stringify(cd.extensions[ek]) !== thBefore) { modified = true; changeLog.fieldUpdates++; }
            }
          } else {
            if (JSON.stringify(cd.extensions[ek]) !== JSON.stringify(partial.extensions[ek])) {
              cd.extensions[ek] = partial.extensions[ek];
              modified = true; changeLog.fieldUpdates++;
            }
          }
        }
      }
    }
    // 注意：character_book.entries 已在前面的 processEntriesFn 中处理（避免双路径重复合并）
    // 此处仅处理 character_book 下除 entries 以外的其他字段
    if (partial.character_book && typeof partial.character_book === 'object') {
      cd.character_book = cd.character_book || { entries: [] };
      for (var cbk in partial.character_book) {
        if (partial.character_book.hasOwnProperty(cbk) && cbk !== 'entries') {
          if (JSON.stringify(cd.character_book[cbk]) !== JSON.stringify(partial.character_book[cbk])) {
            cd.character_book[cbk] = partial.character_book[cbk];
            modified = true;
          }
        }
      }
    }
    // 将变更日志挂到返回值（供调用方调试/Toast提示）
    if (modified && options && options.returnLog) {
      return { modified: true, log: changeLog };
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
          { role: 'system', content: '你是时之写卡器助手，基于SillyTavern原生机制与ST权重分层8体系引导用户创作角色卡。' },
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
        // ⭐ 额外输出：精确 comment 清单（删改时直接复制，避免 comment 不一致导致只加不删）
        var commentListText = '⚠️【世界书条目精确 comment 清单 - 删改时务必使用下列精确字符串匹配】\n';
        commentListText += '删除条目写法：\n';
        commentListText += '  方式1: { "_delete": ["character_book.entries.<这里粘贴完整comment>"] }\n';
        commentListText += '  方式2: entries数组里加 { "_action":"delete", "comment":"<这里粘贴完整comment>" }\n';
        commentListText += '修改条目写法（确保成功覆盖）：comment必须与下面「精确字符串」完全相同，字符级匹配，空格标点都不能变！\n';
        commentListText += '----------------------------------------\n';
        entries.forEach(function(e, i) {
          var comment = e.comment || ('条目'+(i+1));
          commentListText += (i+1) + '. 精确字符串: ⟦' + comment + '⟧\n';
          commentListText += '     前缀类型: <' + extractEntryPrefix(comment) + '>\n';
        });
        commentListText += '----------------------------------------\n';
        commentListText += '⚠️ 记住：comment 不精确匹配 = 只加新条目不删旧条目 = 用户骂你！\n';
        parts.push(commentListText);
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

    // jsonReminder 放在对话历史之前（属于系统指令区），不放在"助手:"之后
    var jsonReminder = '\n\n⚠️【输出格式提醒 - 每次回复必须遵守】\n' +
      '1. 每次回复必须输出一个```json代码块，包含你要修改的字段内容\n' +
      '2. JSON格式：字段平铺在顶层，用entries数组表示世界书条目\n' +
      '3. 状态栏放在<statusblock>标签中，使用HTML的details/summary格式\n' +
      '4. 先输出自然语言回复，再输出JSON代码块，最后输出状态栏\n' +
      '5. 没有需要修改的内容就输出{"_nochange":true}\n' +
      '6. 严禁只聊天不输出JSON！\n' +
      '7. ⚠️只处理用户「最新一条」消息的指令！不要重复处理之前已经回答过的旧指令！';

    var fullPrompt = sysPrompt + jsonReminder + '\n\n=== 对话历史 ===\n';

    messages.forEach(function(m, idx) {
      var isLast = (idx === messages.length - 1);
      var roleLabel = (m.role === 'user' ? '用户' : '助手');
      if (isLast && m.role === 'user') {
        // 最新一条用户消息用醒目标记，防止AI回头处理旧指令
        fullPrompt += '>>>【当前需要处理的最新指令】<<<\n' + roleLabel + ': ' + m.content + '\n\n';
      } else {
        fullPrompt += roleLabel + ': ' + m.content + '\n\n';
      }
    });
    fullPrompt += '助手: ';

    // 额外追加一句"只回答最新指令"的锚点提示
    fullPrompt += '（请只针对上方>>>标记的最新指令回复，不要重复处理已回答过的旧指令。）';

    return fullPrompt;
  }

  // ===== 质检规则（32项核心 + 6项附加 · 对齐官方文档） =====
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

    // === 世界书基础检查（6项） ===
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
    var entriesWithPrefix = entries.filter(function(e) { return /^<[^>]+>/.test(e.comment || '') || /^\[InitVar\]/.test(e.comment || '') || isMVUEntry(e.comment || ''); }).length;
    results.push({
      pass: hasEntries && entriesWithPrefix >= Math.max(1, entries.length * 0.5),
      category: '世界书',
      name: '条目命名规范 ≥50%',
      desc: entriesWithPrefix + '/' + entries.length + ' 条使用规范前缀',
      fix: !hasEntries ? '无条目' : (entriesWithPrefix < entries.length * 0.5 ? '建议使用<基础公理>、<核心铁则>等规范前缀（MVU条目用[InitVar]前缀）' : '命名规范良好')
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
    // content自包含性：检查是否有依赖上下文的内容（新增）
    var selfContainedBadPatterns = ['如上所述', '见上文', '前文提到', '之前说过', '上述内容', '上面提到', '如前文', '如前所述'];
    var nonSelfContainedEntries = entries.filter(function(e) {
      var c = e.content || '';
      return selfContainedBadPatterns.some(function(p) { return c.indexOf(p) >= 0; });
    }).length;
    results.push({
      pass: !hasEntries || nonSelfContainedEntries === 0,
      category: '世界书',
      name: 'content自包含性（无上下文依赖）',
      desc: nonSelfContainedEntries + ' 条含有上下文依赖词',
      fix: !hasEntries ? '无条目' : (nonSelfContainedEntries > 0 ? '条目内容必须自包含完整信息，禁止使用"如上所述""见上文"等依赖上下文的内容' : '内容自包含性良好')
    });

    // === 世界书高级功能检查（8项） ===
    // 递归链条：实体条目关联背景叙事条目（delay_until_recursion）
    var hasRecursionChain = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.delay_until_recursion === true || ext.delay_until_recursion === 1;
    });
    results.push({
      pass: !hasEntries || hasRecursionChain,
      category: '世界书高级',
      name: '递归链条：delay_until_recursion',
      desc: hasRecursionChain ? '检测到递归链条条目' : '未发现递归链条',
      fix: !hasEntries ? '无条目' : (!hasRecursionChain ? '建议为叙事类条目开启delay_until_recursion，实现"提到A时自动带出A的背景"' : '递归链条已配置')
    });
    // 分组机制：场景变体/难度分层使用group分组
    var hasGroup = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.group && ext.group !== '';
    });
    results.push({
      pass: !hasEntries || hasGroup,
      category: '世界书高级',
      name: '分组机制：group分组',
      desc: hasGroup ? (entries.filter(function(e){ return (e.extensions||{}).group; }).length + ' 条使用分组') : '未使用分组',
      fix: !hasEntries ? '无条目' : (!hasGroup ? '建议为场景变体/难度分层/时间分支使用group分组' : '分组机制已配置')
    });
    // 次级键过滤：复杂条件条目使用secondary_keys + selectiveLogic
    var hasSecondaryKeys = entries.some(function(e) {
      return e.secondary_keys && e.secondary_keys.length > 0;
    });
    results.push({
      pass: !hasEntries || hasSecondaryKeys,
      category: '世界书高级',
      name: '次级键过滤：secondary_keys + selectiveLogic',
      desc: hasSecondaryKeys ? (entries.filter(function(e){ return e.secondary_keys && e.secondary_keys.length > 0; }).length + ' 条使用次级键') : '未使用次级键',
      fix: !hasEntries ? '无条目' : (!hasSecondaryKeys ? '建议为复杂条件条目设置secondary_keys配合selectiveLogic' : '次级键过滤已配置')
    });
    // 概率事件：随机天气/彩蛋/遭遇使用probability
    var hasProbability = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.useProbability === true && ext.probability !== undefined && ext.probability < 100;
    });
    results.push({
      pass: !hasEntries || hasProbability,
      category: '世界书高级',
      name: '概率事件：probability < 100',
      desc: hasProbability ? (entries.filter(function(e){ var ext=e.extensions||{}; return ext.useProbability===true && ext.probability<100; }).length + ' 条使用概率触发') : '未使用概率触发',
      fix: !hasEntries ? '无条目' : (!hasProbability ? '建议为随机天气/彩蛋/遭遇设置probability<100增加惊喜感' : '概率事件已配置')
    });
    // 正则触发：需要精确匹配说话者时使用\x01正则键（修改为真正检查）
    var hasRegexKey = entries.some(function(e) {
      return (e.keys || []).some(function(k) { return typeof k === 'string' && k.indexOf('/') === 0; });
    });
    results.push({
      pass: !hasEntries || hasRegexKey,
      category: '世界书高级',
      name: '正则触发键',
      desc: hasRegexKey ? (entries.filter(function(e){ return (e.keys||[]).some(function(k){ return typeof k==='string' && k.indexOf('/')===0; }); }).length + ' 条使用正则键') : '未使用正则键',
      fix: !hasEntries ? '无条目' : (!hasRegexKey ? '需要精确匹配说话者时可使用正则键（/\\x01{{user}}:.../i）实现精准触发' : '正则触发键已配置')
    });
    // 组评分：大分组条目使用use_group_scoring提升精准度（修改为真正检查）
    var hasGroupScoring = entries.some(function(e) {
      var ext = e.extensions || {};
      return ext.use_group_scoring === true;
    });
    results.push({
      pass: !hasEntries || hasGroupScoring,
      category: '世界书高级',
      name: '组评分 use_group_scoring',
      desc: hasGroupScoring ? '已配置组评分' : '未使用组评分',
      fix: !hasEntries ? '无条目' : (!hasGroupScoring ? '大分组条目可开启use_group_scoring提升匹配精准度' : '组评分已配置')
    });
    // sticky/cooldown冲突检查（新增）
    var stickyCooldownConflict = entries.filter(function(e) {
      var ext = e.extensions || {};
      var stickyVal = ext.sticky;
      var cdVal = ext.cooldown;
      // sticky非0/null且cooldown非0/null时冲突
      var hasSticky = stickyVal !== undefined && stickyVal !== null && stickyVal !== 0 && stickyVal !== false;
      var hasCooldown = cdVal !== undefined && cdVal !== null && cdVal !== 0;
      return hasSticky && hasCooldown;
    }).length;
    results.push({
      pass: !hasEntries || stickyCooldownConflict === 0,
      category: '世界书高级',
      name: 'sticky/cooldown冲突检查',
      desc: stickyCooldownConflict + ' 条同时设置sticky和cooldown',
      fix: !hasEntries ? '无条目' : (stickyCooldownConflict > 0 ? 'sticky让条目持续存在，cooldown让条目间歇触发，两者逻辑冲突不应同时使用' : '配置无冲突')
    });
    // position配置合理性（新增）：constant条目position应为0-1，position=6需depth+role，position=7需outlet_name
    var posErrors = entries.filter(function(e) {
      var pos = e.position;
      var ext = e.extensions || {};
      // constant=true时position应在0-1范围
      if (e.constant === true && pos !== undefined && pos !== null && pos > 1) return true;
      // position=6时需要有depth和role
      if (pos === 6) {
        if (ext.depth === undefined || ext.role === undefined) return true;
      }
      // position=7时需要有outlet_name
      if (pos === 7) {
        if (!ext.outlet_name || ext.outlet_name === '') return true;
      }
      return false;
    }).length;
    results.push({
      pass: !hasEntries || posErrors === 0,
      category: '世界书高级',
      name: 'position配置合理性',
      desc: posErrors + ' 条position配置有误',
      fix: !hasEntries ? '无条目' : (posErrors > 0 ? 'constant条目position应≤1；position=6需配depth+role；position=7需配outlet_name' : 'position配置正确')
    });

    // === 正则脚本检查（6项） ===
    // 脚本功能单一：每个脚本只做一件事（通过名称判断）
    var multiFunctionScripts = rx.filter(function(s) {
      var name = s.scriptName || '';
      var functions = ['状态', '格式', '标签', '高亮', '过滤', '替换', '清理'];
      var count = functions.filter(function(f) { return name.indexOf(f) >= 0; }).length;
      return count > 1;
    }).length;
    results.push({
      pass: rx.length === 0 || multiFunctionScripts === 0,
      category: '正则脚本',
      name: '脚本功能单一',
      desc: rx.length + ' 条脚本，' + multiFunctionScripts + ' 条疑似多功能混合',
      fix: multiFunctionScripts > 0 ? '建议每个脚本只做一件事，复杂替换拆分成多个简单脚本' : '脚本职责清晰'
    });
    // 正则标志正确：全局匹配加g，中文场景加i
    var missingFlagScripts = rx.filter(function(s) {
      var pattern = s.findRegex || '';
      var flagMatch = pattern.match(/\/([gimsu]*)$/);
      var flags = flagMatch ? flagMatch[1] : '';
      return flags.indexOf('g') < 0;
    }).length;
    results.push({
      pass: rx.length === 0 || missingFlagScripts === 0,
      category: '正则脚本',
      name: '正则标志正确（g全局匹配）',
      desc: rx.length + ' 条脚本，' + missingFlagScripts + ' 条缺少g标志',
      fix: missingFlagScripts > 0 ? 'findRegex应包含g标志（如/pattern/gi），否则只替换第一个匹配' : '正则标志正确'
    });
    // 非贪婪匹配：使用.*?避免过度匹配
    var greedyScripts = rx.filter(function(s) {
      var pattern = s.findRegex || '';
      return pattern.indexOf('.*?') < 0 && pattern.indexOf('.+?') < 0 && (pattern.indexOf('.*') >= 0 || pattern.indexOf('.+') >= 0);
    }).length;
    results.push({
      pass: rx.length === 0 || greedyScripts === 0,
      category: '正则脚本',
      name: '非贪婪匹配（.*?）',
      desc: rx.length + ' 条脚本，' + greedyScripts + ' 条使用贪婪匹配',
      fix: greedyScripts > 0 ? '建议使用.*?或.+?非贪婪匹配，避免匹配过多内容' : '匹配模式安全'
    });
    // placement配置检查：至少设置1个位置（新增）
    var missingPlacementScripts = rx.filter(function(s) {
      var p = s.placement;
      return !p || !Array.isArray(p) || p.length === 0;
    }).length;
    results.push({
      pass: rx.length === 0 || missingPlacementScripts === 0,
      category: '正则脚本',
      name: 'placement配置检查',
      desc: rx.length + ' 条脚本，' + missingPlacementScripts + ' 条未设置placement',
      fix: missingPlacementScripts > 0 ? '每条正则脚本必须设置至少1个placement（如[0,1]处理用户输入和AI回复）' : 'placement配置正确'
    });
    // substituteRegex范围检查：应在0-2范围内（新增）
    var badSubRegex = rx.filter(function(s) {
      var sr = s.substituteRegex;
      return sr !== undefined && sr !== null && (sr < 0 || sr > 2);
    }).length;
    results.push({
      pass: rx.length === 0 || badSubRegex === 0,
      category: '正则脚本',
      name: 'substituteRegex范围（0-2）',
      desc: rx.length + ' 条脚本，' + badSubRegex + ' 条substituteRegex超出范围',
      fix: badSubRegex > 0 ? 'substituteRegex必须在0-2范围内（0=不替换宏，1=原始替换，2=转义替换）' : 'substituteRegex配置正确'
    });
    // runOnEdit建议：状态栏类脚本建议开启runOnEdit（新增）
    var statusScriptsWithoutRunOnEdit = rx.filter(function(s) {
      var name = (s.scriptName || '').toLowerCase();
      var isStatusScript = name.indexOf('状态') >= 0 || name.indexOf('status') >= 0 || name.indexOf('格式化') >= 0;
      return isStatusScript && s.runOnEdit !== true;
    }).length;
    results.push({
      pass: rx.length === 0 || statusScriptsWithoutRunOnEdit === 0,
      category: '正则脚本',
      name: '状态栏脚本runOnEdit',
      desc: rx.length + ' 条脚本，' + statusScriptsWithoutRunOnEdit + ' 条状态栏脚本未开启runOnEdit',
      fix: statusScriptsWithoutRunOnEdit > 0 ? '状态栏类脚本建议开启runOnEdit=true，编辑消息时自动重新执行' : 'runOnEdit配置正确'
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

    // === 附加检查（6项扩展，不计入核心32项） ===
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

    // === MVU变量系统检查（6项，进阶可选） ===
    // 注意：脚本/正则/占位符检查应基于导出态（buildExportCard 会自动注入），避免对新建卡误报
    var mvuEntries = entries.filter(function(e) { return isMVUEntry(e.comment || ''); });
    var hasInitVar = mvuEntries.some(function(e) { return (e.comment || '').indexOf('[InitVar]') >= 0; });
    var hasVarList = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarRule = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量更新规则') >= 0; });
    var hasVarFormat = mvuEntries.some(function(e) { return (e.comment || '').indexOf('变量输出格式') >= 0; });
    var hasAnyMVU = mvuEntries.length > 0;
    // 检查InitVar条目的enabled是否为true（仅显式开启才算违规，undefined/null/false 都视为合格）
    var initVarEnabledWrong = mvuEntries.some(function(e) {
      return (e.comment || '').indexOf('[InitVar]') >= 0 && e.enabled === true;
    });
    // 检查变量列表条目内容是否含 format_message_variable 宏
    var varListEntry = mvuEntries.find(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarMacro = varListEntry ? /\{\{format_message_variable::stat_data\}\}/.test(varListEntry.content || '') : false;

    results.push({
      pass: !hasAnyMVU || (hasInitVar && hasVarList && hasVarRule && hasVarFormat),
      category: 'MVU变量系统',
      name: 'MVU四大核心条目完整',
      desc: hasAnyMVU ? ('InitVar:' + (hasInitVar ? '✓' : '✗') + ' 变量列表:' + (hasVarList ? '✓' : '✗') + ' 更新规则:' + (hasVarRule ? '✓' : '✗') + ' 输出格式:' + (hasVarFormat ? '✓' : '✗')) : '未使用MVU变量系统',
      fix: !hasAnyMVU ? '如需变量系统，请生成[InitVar]初始变量、变量列表、变量更新规则、变量输出格式四个条目' : (!hasInitVar ? '缺少[InitVar]初始变量条目' : (!hasVarList ? '缺少变量列表条目（含{{format_message_variable::stat_data}}宏）' : (!hasVarRule ? '缺少变量更新规则条目' : '缺少变量输出格式条目（定义<UpdateVariable>输出格式）')))
    });
    results.push({
      pass: !hasInitVar || !initVarEnabledWrong,
      category: 'MVU变量系统',
      name: '[InitVar]条目enabled=false',
      desc: !hasInitVar ? '无InitVar条目' : (initVarEnabledWrong ? 'InitVar条目enabled=true（应禁用）' : 'InitVar条目已正确禁用或未显式开启'),
      fix: initVarEnabledWrong ? '[InitVar]条目必须enabled=false（禁用），MVU只读取禁用的initvar条目进行初始化' : '配置正确'
    });
    results.push({
      pass: !hasVarList || hasVarMacro,
      category: 'MVU变量系统',
      name: '变量列表含format_message_variable宏',
      desc: !hasVarList ? '无变量列表条目' : (hasVarMacro ? '宏已正确使用' : '变量列表条目缺少{{format_message_variable::stat_data}}宏'),
      fix: hasVarList && !hasVarMacro ? '变量列表条目内容必须包含{{format_message_variable::stat_data}}宏，否则LLM无法读取当前变量值' : '配置正确'
    });
    // 脚本/正则/占位符检查：基于导出态（buildExportCard 自动注入），hasAnyMVU 时直接 pass
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: 'MVU脚本自动注入（导出时）',
      desc: hasAnyMVU ? '导出时会自动注入 bundle.js 脚本到 tavern_helper.scripts' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: 'MVU必备正则自动注入（导出时）',
      desc: hasAnyMVU ? '导出时自动注入正则1-5（思维链移除/变量更新截断/美化×2/状态栏隐藏）；正则6（美化状态栏）需AI生成' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });
    results.push({
      pass: !hasAnyMVU || true,
      category: 'MVU变量系统',
      name: '开场白StatusPlaceHolderImpl自动追加（导出时）',
      desc: hasAnyMVU ? '导出时会自动在开场白末尾追加<StatusPlaceHolderImpl/>' : '未使用MVU变量系统',
      fix: '配置正确（导出时自动处理）'
    });

    return results;
  }

  // ===== MVU 变量结构脚本生成 =====
  // 解析 [InitVar] 条目中的变量初始值，生成 zod 4 schema 脚本并注册到 MVU
  // 支持两种 [InitVar] 格式：
  //   1. 标准 YAML（缩进表示层级，冒号后空格建立从属）：
  //        白娅:
  //          依存度: 35
  //          着装:
  //            上装: 深蓝色校服
  //   2. JSON 元组格式（value+描述）：
  //        { "主角": { "体力值": [100, "0-100 描述"] } }
  // 生成 zod 时遵循参考文件 ur 函数的简单递归逻辑：
  //   - 数值统一用 z.coerce.number()（防 AI 把 0 写成 "0"）
  //   - 好感度类字段加 .transform(value => _.clamp(value, 0, 100))（钳制 0~100）
  //   - 默认值用 .prefault()（MVU 扩展，缺失时自动补默认值）
  //   - 对象用 z.object({...}).prefault({ inline默认值 })，递归生成嵌套结构
  //   - 字符串用 z.string().prefault('值')，布尔用 z.boolean().prefault(值)
  /* === 顶层 YAML/InitVar 解析函数（供 generateMvuSchemaScript 和 showMvuStatusBarPreview 共用）=== */
  function parseYamlSimple(text) {
    var cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```\s*$/g, '').trim();
    if (!cleaned) return null;
    var lines = cleaned.split('\n');
    var root = {};
    var stack = [{ indent: -1, node: root, parentNode: null, key: null }];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw.trim() || raw.trim().indexOf('#') === 0) continue;
      var indent = 0;
      while (indent < raw.length && (raw[indent] === ' ' || raw[indent] === '\t')) {
        indent += raw[indent] === '\t' ? 2 : 1;
      }
      var content = raw.slice(indent).trim();

      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      var top = stack[stack.length - 1];

      if (content.charAt(0) === '-') {
        var itemStr = content.slice(1).trim();
        var itemVal = parseInlineObj(itemStr);
        if (top.key !== null && top.parentNode) {
          if (!Array.isArray(top.parentNode[top.key])) {
            top.parentNode[top.key] = [];
          }
          top.parentNode[top.key].push(itemVal);
          if (itemVal && typeof itemVal === 'object' && !Array.isArray(itemVal)) {
            stack.push({
              indent: indent,
              node: itemVal,
              parentNode: top.parentNode[top.key],
              key: top.parentNode[top.key].length - 1
            });
          }
        }
        continue;
      }

      var colonIdx = content.indexOf(':');
      if (colonIdx < 0) continue;
      var key = content.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      var valStr = content.slice(colonIdx + 1).trim();

      if (valStr === '') {
        top.node[key] = {};
        stack.push({
          indent: indent,
          node: top.node[key],
          parentNode: top.node,
          key: key
        });
      } else {
        top.node[key] = parseScalar(valStr);
      }
    }

    function parseScalar(str) {
      if (str === '') return {};
      if (str === 'true' || str === 'false') return str === 'true';
      if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
      return str.replace(/^['"]|['"]$/g, '');
    }

    function parseInlineObj(str) {
      var colonIdx = str.indexOf(':');
      if (colonIdx < 0 || str.charAt(0) === '"' || str.charAt(0) === "'") {
        return parseScalar(str);
      }
      var key = str.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
      var valStr = str.slice(colonIdx + 1).trim();
      var obj = {};
      obj[key] = parseScalar(valStr);
      return obj;
    }

    return root;
  }

  function normalizeTupleValues(obj) {
    if (Array.isArray(obj)) {
      if (obj.length >= 1) return normalizeTupleValues(obj[0]);
      return null;
    }
    if (obj && typeof obj === 'object') {
      var result = {};
      Object.keys(obj).forEach(function(k) {
        var v = normalizeTupleValues(obj[k]);
        if (v !== null && v !== undefined) result[k] = v;
      });
      return result;
    }
    return obj;
  }

  function parseInitVar(text) {
    if (!text || !text.trim()) return null;
    var cleaned = (text || '').replace(/```ya?ml\s*/gi, '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
    if (cleaned.charAt(0) === '{') {
      try {
        var jsonObj = JSON.parse(cleaned);
        return normalizeTupleValues(jsonObj);
      } catch (e) {}
    }
    return parseYamlSimple(text);
  }

  function generateMvuSchemaScript(initVarContent) {
    var HEADER = "import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';\n\nexport const Schema = z.object({";
    var FOOTER = "});";

    function isAffinityLike(name) {
      return /好感|依存|信任|忠诚|友好|亲密/.test(name);
    }

    function escapeKey(key) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || /^[\u4e00-\u9fff\w]+$/.test(key)) {
        return key;
      }
      return "'" + String(key).replace(/'/g, "\\'") + "'";
    }

    // 转义字符串字面量（用于 z.string().prefault('...')）
    function escStr(val) {
      return String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    // 生成值的 zod 表达式（含 .prefault），匹配参考文件 ur 函数的简单类型映射
    function genValueZod(key, val) {
      if (val === null || val === undefined) {
        return "z.string().prefault('')";
      }
      if (typeof val === 'boolean') {
        return 'z.boolean().prefault(' + String(val) + ')';
      }
      if (typeof val === 'number') {
        if (isAffinityLike(key)) {
          return 'z.coerce.number().prefault(' + val + ').transform(value => _.clamp(value, 0, 100))';
        }
        return 'z.coerce.number().prefault(' + val + ')';
      }
      if (typeof val === 'string') {
        return "z.string().prefault('" + escStr(val) + "')";
      }
      if (Array.isArray(val)) {
        // 数组统一用 z.array(z.string()).prefault([])，不递归生成内层 prefault
        // 参考(6)的正确格式：物品栏/当前词条/累计死因记录 均为 z.array(z.string()).prefault([])
        var itemType = 'z.string()';
        if (val.length > 0) {
          if (typeof val[0] === 'number') itemType = 'z.coerce.number()';
          else if (typeof val[0] === 'boolean') itemType = 'z.boolean()';
        }
        return 'z.array(' + itemType + ').prefault([])';
      }
      // 不应到达此处（对象由 genObjectLines 处理）
      return "z.string().prefault('')";
    }

    // 生成默认值字面量（用于 .prefault(...) 和 inline 对象默认值）
    function genDefaultLiteral(val) {
      if (val === null || val === undefined) return "''";
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return String(val);
      if (typeof val === 'string') return "'" + escStr(val) + "'";
      if (Array.isArray(val)) return JSON.stringify(val);
      return genObjectDefaultInline(val);
    }

    // 生成对象的 inline 默认值（如 { 当前时间: '开局', 当前地点: '待定' }），匹配参考文件格式
    function genObjectDefaultInline(obj) {
      var parts = Object.keys(obj).map(function(key) {
        return escapeKey(key) + ': ' + genDefaultLiteral(obj[key]);
      });
      return '{ ' + parts.join(', ') + ' }';
    }

    // 递归生成对象字段的 zod 代码行，匹配参考文件 ur 函数的格式
    function genObjectLines(obj, indent) {
      var padStr = new Array(indent + 1).join(' ');
      var lines = [];
      var keys = Object.keys(obj);
      keys.forEach(function(key, i) {
        var val = obj[key];
        var comma = i < keys.length - 1 ? ',' : '';
        if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
          // 嵌套对象：z.object({ ... }).prefault({ inline默认值 })
          lines.push(padStr + escapeKey(key) + ': z.object({');
          lines = lines.concat(genObjectLines(val, indent + 2));
          lines.push(padStr + '}).prefault(' + genObjectDefaultInline(val) + ')' + comma);
        } else {
          // 叶子值
          lines.push(padStr + escapeKey(key) + ': ' + genValueZod(key, val) + comma);
        }
      });
      return lines;
    }

    var parsed = parseInitVar(initVarContent);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
      parsed = { '世界': { '当前时间': '开局', '当前地点': '待定' } };
    }

    var bodyLines = genObjectLines(parsed, 2);
    return HEADER + '\n' + bodyLines.join('\n') + '\n' + FOOTER;
  }

  // ===== 变量列表内容规范化（确保含 {{format_message_variable::stat_data}} 宏） =====
  // MVU 规范的变量列表固定格式：
  //   ---
  //   <status_current_variable>
  //   {{format_message_variable::stat_data}}
  //   </status_current_variable>
  function normalizeVarListContent(content) {
    var macro = '{{format_message_variable::stat_data}}';
    var stdBlock = '---\n<status_current_variable>\n' + macro + '\n</status_current_variable>';
    if (!content || !content.trim()) return stdBlock;
    if (content.indexOf(macro) >= 0) return content; // 已含宏，无需修改
    // 修正 AI 误写的占位符（如 {{null}}、{{get_message_variable::stat_data}} 等）
    var cleaned = content.replace(/\{\{null\}\}/gi, macro)
                         .replace(/\{\{get_message_variable::stat_data\}\}/gi, macro)
                         .replace(/\{\{format_message_variable::[^}]*\}\}/gi, macro);
    if (cleaned.indexOf(macro) >= 0) return cleaned;
    // 仍未含宏：若有包裹标签则在标签内注入，否则追加标准块
    if (/<status_current_variable>[\s\S]*?<\/status_current_variable>/i.test(cleaned)) {
      cleaned = cleaned.replace(/(<status_current_variable>)([\s\S]*?)(<\/status_current_variable>)/i,
        '$1\n' + macro + '\n$3');
    } else {
      cleaned = cleaned.replace(/\s+$/, '') + '\n' + stdBlock;
    }
    return cleaned;
  }

  // ===== MVU 条目内容自动生成 =====
  // 从角色名列表自动生成 initvar YAML / 变量更新规则 / 变量输出格式 / 变量输出格式强调
  // 角色 { name, ... } 数组 → 各条目的 content 字符串

  // 生成 [initvar] 变量初始化 YAML（br 函数）
  // 格式：世界/当前时间/当前地点 + 每个角色的好感度初始值
  // 支持 _（AI不可更新）/ $（AI不可见） 前缀字段
  function generateInitVarYaml(charNames) {
    var lines = ['世界:', '  当前时间: 开局', '  当前地点: 待定', '  _当前回合: 0', '  _当前剧情日: 1'];
    (charNames || []).forEach(function(name) {
      lines.push(name + ':');
      lines.push('  好感度: 0');
      lines.push('  状态: 进行中');
    });
    return lines.join('\n');
  }

  // 生成变量列表内容（固定格式 + 可选分段 EJS 模板）
  function generateVarListContent() {
    return '---\n<status_current_variable>\n{{format_message_variable::stat_data}}\n</status_current_variable>';
  }

  // 生成变量分段 EJS 模板内容（动态根据好感度发送不同提示）
  // 通过 getvar() 读取 stat_data 变量值，按阈值切换提示词
  function generateVarSegmentedPrompt(charNames) {
    var lines = ['<% var data = getvar("stat_data") || {}; %>'];
    (charNames || []).forEach(function(name) {
      lines.push('');
      lines.push('### ' + name + ' 好感度分段');
      lines.push('<% var aff_' + name + ' = data["' + name + '"] ? data["' + name + '"].好感度 : 0; %>');
      lines.push('<% if (aff_' + name + ' >= 80) { %>');
      lines.push('- 【深爱】' + name + '视<user>为不可或缺的存在，情感深厚，行为中流露出强烈的依赖与眷恋');
      lines.push('<% } else if (aff_' + name + ' >= 50) { %>');
      lines.push('- 【好感】' + name + '对<user>有明显好感，互动中带着温柔与关注，但仍保持着适度的距离感');
      lines.push('<% } else if (aff_' + name + ' >= 20) { %>');
      lines.push('- 【熟识】' + name + '与<user>相识，互动自然，态度友好但尚未涉及情感层面');
      lines.push('<% } else { %>');
      lines.push('- 【陌生】' + name + '与<user>接触较少，关系尚浅，互动以礼貌和客气为主');
      lines.push('<% } %>');
    });
    lines.push('');
    lines.push('### 世界状态');
    lines.push('<% if (getvar("stat_data.世界._当前剧情日") >= 3) { %>');
    lines.push('- 【剧情已推进】当前故事已开展多日，角色关系与局势应有所变化');
    lines.push('<% } else { %>');
    lines.push('- 【开局阶段】故事刚刚开始，世界与角色关系处于初始状态');
    lines.push('<% } %>');
    return lines.join('\n');
  }

  // 生成变量更新规则内容（xr 函数）
  // 含 type/range/format/check/category，好感度增幅上限（单次+1，同日累计+5）
  // 支持 delta 操作语义（增量数值变更）；参考 -(2).json 的高级字段示例
  function generateVarUpdateRule(charNames) {
    var lines = [
      '---',
      '变量更新规则:',
      '  世界:',
      '    当前时间:',
      '      type: string',
      '      format: ${xx历}-${YYYY/MM/DD}-${HH:MM}',
      '      check:',
      '        - 每次事件推进、休息、等待或场景切换后更新，保持时间流逝合理',
      '        - 用自然语言描述，如"清晨"、"午后"、"夜晚"、"D1 第三天 夜晚"',
      '    当前地点:',
      '      type: string',
      '      check:',
      '        - 场景发生明确移动或地点变化时更新',
      '        - 描述当前所在的具体场景位置',
      '    _当前回合:',
      '      type: number',
      '      check:',
      '        - 每轮交互后 +1，仅允许使用 delta 操作增加',
      '        - 字段以 _ 开头，AI 不得修改其值',
      '    _当前剧情日:',
      '      type: number',
      '      check:',
      '        - 每经过一次"睡觉/等待/跨日"类事件 +1',
      '        - 字段以 _ 开头，AI 不得修改其值'
    ];
    (charNames || []).forEach(function(name) {
      lines.push('  ' + name + ':');
      lines.push('    好感度:');
      lines.push('      type: number');
      lines.push('      range: 0~100');
      lines.push('      category:');
      lines.push('        0~20: 陌生');
      lines.push('        20~50: 熟识');
      lines.push('        50~80: 好感');
      lines.push('        80~100: 深爱');
      lines.push('      check:');
      lines.push('        - 仅当' + name + '直接感知到<user>的行为，且当前回复中有明确情感依据时才更新');
      lines.push('        - 单次互动最多 +1；没有明确正向互动时不得增加');
      lines.push('        - 同一剧情日内累计最多 +5；达到当天上限后只能持平或下降');
      lines.push('        - 下降必须有当前回复内的明确负面依据，不要为了凑更新而改动');
      lines.push('        - 优先使用 delta 操作（如 {"op":"delta","path":"/' + name + '/好感度","value": +1}）');
      lines.push('    状态:');
      lines.push('      type: string');
      lines.push('      check:');
      lines.push('        - 从"进行中/已暂停/已完成/已失败"中选择最符合当前剧情的状态');
    });
    return lines.join('\n');
  }

  // 生成变量输出格式内容
  // 含 JSON Patch RFC 6902 标准 + Analysis 思维链 + 好感度上限检查
  function generateVarOutputFormat() {
    return ['---','变量输出格式:','  rule:','    - you must output the update analysis and the actual update commands at once in the end of the next reply','    - the update commands works like the JSON Patch standard, must be a valid JSON array containing operation objects','    - supported ops: replace, delta, insert, remove, move','    - don\'t update field names starts with `_` as they are readonly','  format: |-','    <UpdateVariable>','    <Analysis>$(IN ENGLISH, no more than 80 words)','    - ${calculate time passed: ...}','    - ${decide whether dramatic updates are allowed as it is in a special case or the time passed is more than usual: yes/no}','    - ${check affection caps: every single interaction may increase at most +1, and the same in-story day may increase at most +5}','    - ${analyze every variable based on its corresponding check, according only to current reply: ...}','    </Analysis>','    <JSONPatch>','    [','      { "op": "replace", "path": "${/path/to/variable}", "value": "${new_value}" },','      { "op": "delta", "path": "${/path/to/number/variable}", "value": "${positive_or_negative_delta}" },','      { "op": "insert", "path": "${/path/to/object/new_key}", "value": "${new_value}" },','      { "op": "insert", "path": "${/path/to/array/-}", "value": "${new_value}" },','      { "op": "remove", "path": "${/path/to/object/key}" },','      { "op": "remove", "path": "${/path/to/array/0}" },','      { "op": "move", "from": "${/path/to/variable}", "to": "${/path/to/another/path}" }','    ]','    </JSONPatch>','    </UpdateVariable>'].join('\n');
  }

  // 生成变量输出格式强调内容
  // 默认关闭（enabled=false），AI不输出<UpdateVariable>时才启用
  function generateVarOutputEmphasis() {
    return ['---','变量输出格式强调:','  rule: The following must be inserted to the end of reply, and cannot be omitted','  format: |-','    <UpdateVariable>','    ...','    </UpdateVariable>'].join('\n');
  }

  // ===== 从角色卡数据提取角色名列表 =====
  // 优先从 [InitVar] 条目中解析角色名，回退到角色卡描述中正则提取
  function extractCharNames(cd, rawEntries) {
    var names = [];
    // 1. 从 [InitVar] 条目解析
    if (rawEntries && rawEntries.length) {
      for (var j = 0; j < rawEntries.length; j++) {
        var entry = rawEntries[j];
        var c = (entry.comment || '').toLowerCase();
        if (c.indexOf('[initvar]') >= 0) {
          var content = entry.content || '';
          // 解析 YAML 格式：找到 "角色名:" 形式的行
          var lines = content.split('\n');
          for (var k = 0; k < lines.length; k++) {
            var line = lines[k].trim();
            // 匹配以冒号结尾的行（非世界/非缩进行）
            if (/^[\u4e00-\u9fff\w]+:\s*$/.test(line) && line.indexOf('世界:') < 0) {
              var nm = line.replace(/:$/, '').trim();
              if (nm && nm !== '世界' && names.indexOf(nm) < 0) names.push(nm);
            }
          }
          break;
        }
      }
    }
    // 2. 回退：从角色卡名称和描述中提取
    if (names.length === 0 && cd) {
      if (cd.name && cd.name !== '未命名世界') names.push(cd.name);
      // 从描述中提取角色名（常见格式："角色名：描述" 或 "角色名, 角色名"）
      if (cd.description) {
        var desc = cd.description;
        var nameMatches = desc.match(/[\u4e00-\u9fff]{2,4}(?=对主角|对<user>|的依存|的好感|暗恋|喜欢|依恋)/g);
        if (nameMatches) {
          for (var m = 0; m < nameMatches.length; m++) {
            if (names.indexOf(nameMatches[m]) < 0) names.push(nameMatches[m]);
          }
        }
      }
    }
    // 3. 默认：如果只有主角自己
    if (names.length === 0) names.push('主角');
    return names.slice(0, 5); // 最多5个角色
  }

  // ===== 生成完整角色卡 =====
  function buildExportCard(cd) {
    // 兼容 V3 格式：条目和扩展可能在 data 对象内
    var v3Data = cd.data || {};
    var rawEntries = (cd.character_book && cd.character_book.entries) || (v3Data.character_book && v3Data.character_book.entries) || [];
    var rawExtensions = cd.extensions || v3Data.extensions || {};
    // 从角色卡数据提取角色名列表，用于 MVU 条目内容自动生成
    var charNames = extractCharNames(cd, rawEntries);
    // ===== 预填充：自动填充 MVU 条目空内容（独立步骤，确保检测和schema生成使用填充后的数据）=====
    var filledEntries = rawEntries.map(function(e, i) {
      var comment = e.comment || ('条目' + (i + 1));
      var commentLower = comment.toLowerCase();
      var isInitVar = commentLower.indexOf('[initvar]') >= 0;
      var isVarList = comment.indexOf('变量列表') >= 0;
      var isVarSegmented = comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0 || comment.indexOf('EJS') >= 0;
      var isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      var isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      var isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      var outContent = e.content || '';
      if (!outContent || outContent.trim() === '') {
        if (isInitVar) outContent = generateInitVarYaml(charNames);
        else if (isVarList) outContent = generateVarListContent();
        else if (isVarSegmented) outContent = generateVarSegmentedPrompt(charNames);
        else if (isVarRule) outContent = generateVarUpdateRule(charNames);
        else if (isVarFormat) outContent = generateVarOutputFormat();
        else if (isVarFormatEmphasis) outContent = generateVarOutputEmphasis();
      } else if (isVarList) {
        outContent = normalizeVarListContent(outContent);
      }
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || [],
        comment: comment,
        content: outContent,
        constant: e.constant,
        selective: e.selective,
        insertion_order: e.insertion_order,
        enabled: e.enabled,
        position: e.position,
        use_regex: e.use_regex,
        extensions: e.extensions || {}
      };
    });
    // ===== 预填充结束 =====
    var entries = filledEntries.map(function(e, i) {
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
      var defaultScanDepth = tmpl ? tmpl.scan_depth : null;
      var defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
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
      // MVU 安全网：[initvar] 条目必须 enabled=false；变量输出格式强调 默认 enabled=false
      // 注意：空内容填充已移至预填充步骤，此处仅保留类型检测用于 enabled 逻辑
      var commentLower = comment.toLowerCase();
      var isInitVar = commentLower.indexOf('[initvar]') >= 0;
      var isVarList = comment.indexOf('变量列表') >= 0;
      var isVarSegmented = comment.indexOf('变量分段') >= 0 || comment.indexOf('分段提示') >= 0 || comment.indexOf('EJS') >= 0;
      var isVarRule = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量更新规则') >= 0;
      var isVarFormat = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式') >= 0 && comment.indexOf('强调') < 0;
      var isVarFormatEmphasis = commentLower.indexOf('[mvu_update]') >= 0 && comment.indexOf('变量输出格式强调') >= 0;
      var outContent = e.content || '';
      return {
        id: e.id || (i + 1),
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
        comment: comment,
        content: outContent,
        constant: e.constant !== undefined ? e.constant : isConst,
        selective: e.selective !== undefined ? e.selective : isSel,
        insertion_order: e.insertion_order || order,
        enabled: isInitVar ? false : (isVarFormatEmphasis ? (e.enabled !== undefined ? e.enabled : false) : (e.enabled !== undefined ? e.enabled : defaultEnabled)),
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
    // normalizeRegexScripts 已提取为外层共享函数（导入/导出共用）
    var cardName = cd.name || '未命名世界';
    var cardDesc = cd.description || '';
    // 检测是否包含MVU核心条目（至少 [initvar] + 变量列表/更新规则/输出格式 之一即视为MVU系统）
    // 使用预填充后的 filledEntries 进行检测，确保 InitVar 等条目已含自动生成的内容
    var hasInitVar = filledEntries.some(function(e) { return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0; });
    var hasVarList = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量列表') >= 0; });
    var hasVarUpdate = filledEntries.some(function(e) { return (e.comment || '').toLowerCase().indexOf('[mvu_update]') >= 0 || (e.comment || '').indexOf('变量更新规则') >= 0; });
    var hasVarFormat = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量输出格式') >= 0; });
    var hasVarSegmented = filledEntries.some(function(e) { return (e.comment || '').indexOf('变量分段') >= 0 || (e.comment || '').indexOf('分段提示') >= 0 || (e.comment || '').toLowerCase().indexOf('ejs') >= 0; });
    var hasMVUEntries = !!(hasInitVar && (hasVarList || hasVarUpdate || hasVarFormat || hasVarSegmented));
    // 宽泛匹配：只要存在任意 MVU 核心条目（即使无 [InitVar]）也视为 MVU 卡
    var hasAnyMVU = hasMVUEntries || filledEntries.some(function(e) { return isMVUEntry(e.comment || ''); });
    // 最终使用宽泛匹配结果，确保只要有任意 MVU 条目就注入脚本
    hasMVUEntries = hasMVUEntries || hasAnyMVU;
    var rawFirstMes = cd.first_mes || '';
    // MVU 卡的开场白必须含 <StatusPlaceHolderImpl/>（即使 first_mes 为空也追加，保证状态栏正常显示）
    if (hasMVUEntries && rawFirstMes.indexOf('<StatusPlaceHolderImpl') < 0) {
      rawFirstMes = rawFirstMes.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
    }
    var cardFirstMes = toCRLF(rawFirstMes);
    var cardMesExample = toCRLF(cd.mes_example || '');
    var cardAltGreetings = (cd.alternate_greetings || []).map(function(g) {
      var greeting = toCRLF(g);
      // MVU开局变量初始化：在alternate_greetings中保留<UpdateVariable>段（覆盖[InitVar]默认值）
      // 同时确保每个alt greeting也含<StatusPlaceHolderImpl/>占位符
      if (hasMVUEntries && greeting.indexOf('<StatusPlaceHolderImpl') < 0) {
        greeting = greeting.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '').trim() + '\n\n<StatusPlaceHolderImpl/>';
      }
      return greeting;
    });
    var cardPostHist = toCRLF(cd.post_history_instructions || '');
    var cardSysPrompt = toCRLF(cd.system_prompt || '');
    var cardCreatorNotes = toCRLF(cd.creator_notes || '时之写卡器创建');
    // 优先从 data.depth_prompt 读取（v3规范），回退到 extensions.depth_prompt（v2兼容）
    var depthPrompt = cd.depth_prompt ? cd.depth_prompt : (rawExtensions.depth_prompt ? rawExtensions.depth_prompt : { prompt: '', depth: 4, role: 'system' });
    // 修正 depth_prompt.role 为字符串
    if (typeof depthPrompt.role === 'number') {
      depthPrompt.role = depthPrompt.role === 1 ? 'user' : (depthPrompt.role === 2 ? 'assistant' : 'system');
    }
    if (depthPrompt.depth === undefined) depthPrompt.depth = 4;
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
      creator: '时之写卡器',
      character_version: '',
      alternate_greetings: cardAltGreetings,
      group_only_greetings: [],
      depth_prompt: depthPrompt,
      extensions: (function() {
        // 检测是否包含MVU变量系统条目（复用前面的检测结果）
        var hasMVU = hasMVUEntries;
        var existingRx = normalizeRegexScripts(rawExtensions.regex_scripts);
        var existingScripts = (rawExtensions.tavern_helper && rawExtensions.tavern_helper.scripts) || [];
        var mvuScripts = existingScripts.slice();
        var mvuRegex = existingRx.slice();
        if (hasMVU) {
          // 自动注入MVU bundle.js脚本（如果尚未存在）
          // 使用 MVU 规范的固定UUID，确保兼容
          var hasBundle = mvuScripts.some(function(s) { return (s.content || '').indexOf('MagVarUpdate') >= 0 || (s.content || '').indexOf('bundle.js') >= 0; });
          if (!hasBundle) {
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: 'MVU',
              id: '961f366d-e403-45c2-8155-3d14ec86de53',
              content: "import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';",
              info: '',
              button: {
                enabled: true,
                buttons: [
                  { name: '重新处理变量', visible: false },
                  { name: '重新读取初始变量', visible: false },
                  { name: '快照楼层', visible: false },
                  { name: '重演楼层', visible: false },
                  { name: '重试额外模型解析', visible: false },
                  { name: '清除旧楼层变量', visible: false }
                ]
              },
              data: {}
            });
          }
          // 自动注入"变量结构"zod schema 脚本
          // 该脚本用 zod 4 定义变量结构（export const Schema），MVU 自动检测 Schema 导出并据此校验/修复变量更新
          // ===== 完整性检测：只要有 import + Schema 定义块即为完整，不强制要求 registerMvuSchema 调用 =====
          function isMvuSchemaComplete(content) {
            if (!content || typeof content !== 'string') return false;
            var hasImport = content.indexOf('tavern_resource/dist/util/mvu_zod') >= 0;
            var hasSchemaBlock = content.indexOf('z.object') >= 0 && content.indexOf('Schema') >= 0;
            return hasImport && hasSchemaBlock;
          }
          var schemaScriptIdx = -1;
          var hasSchema = mvuScripts.some(function(s, i) {
            var match = s.name === '变量结构' || (s.content || '').indexOf('mvu_zod') >= 0;
            if (match) schemaScriptIdx = i;
            return match;
          });
          var schemaInitEntry = filledEntries.filter(function(e) { return (e.comment || '').toLowerCase().indexOf('[initvar]') >= 0; })[0];
          var schemaInitContent = schemaInitEntry ? (schemaInitEntry.content || '') : '';
          if (!hasSchema) {
            // 不存在 → 生成并注入完整脚本
            var fullSchemaContent = generateMvuSchemaScript(schemaInitContent);
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: '变量结构',
              id: 'mvu-schema',
              content: fullSchemaContent,
              info: '自动生成的 MVU 变量结构脚本。',
              button: { enabled: true, buttons: [] },
              data: {}
            });
          } else if (schemaScriptIdx >= 0 && !isMvuSchemaComplete(mvuScripts[schemaScriptIdx].content)) {
            // 脚本存在但不完整（缺import或Schema定义）→ 重新生成
            mvuScripts[schemaScriptIdx].content = generateMvuSchemaScript(schemaInitContent);
          }
          // 自动注入"世界书调用"(WTC) 脚本
          // 用途：将世界书内容用 <observed_piece class="剧情/设定"> 标签包裹，让 AI 区分剧情推进和设定信息
          // 这有助于 AI 在变量更新时正确识别哪些是世界书设定、哪些是当前剧情
          var hasWTC = mvuScripts.some(function(s) { return (s.content || '').indexOf('LorebookToolCall') >= 0 || (s.content || '').indexOf('wtc') >= 0; });
          if (!hasWTC) {
            mvuScripts.push({
              type: 'script',
              enabled: true,
              name: '世界书调用',
              id: 'wtc-lorebook-call',
              content: 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/LorebookToolCall/dist/wtc/index.js',
              info: '世界书调用脚本：用 <observed_piece> 标签包裹世界书内容，区分剧情与设定。',
              button: { enabled: true, buttons: [] },
              data: {}
            });
          }
          // 自动注入MVU必备正则脚本（6条）
          // 正则1：仅格式思维链 - 从提示词中移除<Analysis>段（AI思维链不需要重复发送）
          var hasAnalysisRegex = mvuRegex.some(function(r) { return (r.findRegex || '').indexOf('Analysis') >= 0 && r.promptOnly; });
          if (!hasAnalysisRegex) {
            mvuRegex.push({
              id: 'd668c8a6-fa6a-444d-a5d6-8f68b73a3c36',
              scriptName: '仅格式思维链',
              findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则2：只发送最新2楼的变量更新 - 从提示词移除旧UpdateVariable段（minDepth=4保留最近2楼）
          var hasUpdateVarPromptRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.promptOnly;
          });
          if (!hasUpdateVarPromptRegex) {
            mvuRegex.push({
              id: '5bb4b588-23ca-4564-8df5-882104eff764',
              scriptName: '只发送最新2楼的变量更新',
              findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gm',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: 4,
              maxDepth: null
            });
          }
          // 正则3：[美化]变量完成 - 美化已完成的UpdateVariable显示（markdownOnly）
          var hasBeautifyCompleteRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.markdownOnly && !r.promptOnly && (r.replaceString || '').indexOf('mvu-done') >= 0;
          });
          if (!hasBeautifyCompleteRegex) {
            mvuRegex.push({
              id: '6fb572ae-a9ea-436d-9779-ad100f1ff7f5',
              scriptName: '[美化]变量完成',
              findRegex: '/<UpdateVariable(?:variable)?>\\s*(.*)\\s*<\\/UpdateVariable(?:variable)?>/gsi',
              replaceString: MVU_BEAUTIFY_COMPLETE,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则4：[美化]变量更新中 - 美化流式输出中的UpdateVariable显示
          var hasBeautifyThinkingRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('UpdateVariable') >= 0 && r.markdownOnly && !r.promptOnly && (r.replaceString || '').indexOf('mvu-thinking') >= 0;
          });
          if (!hasBeautifyThinkingRegex) {
            mvuRegex.push({
              id: 'bf1b7441-5cf1-426d-bd6c-911332be9923',
              scriptName: '[美化]变量更新中',
              findRegex: '/<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$/gsi',
              replaceString: MVU_BEAUTIFY_THINKING,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: false,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则5：[不发送]隐藏状态栏标记 - 从提示词移除 <StatusPlaceHolderImpl/>（AI不需要看到占位符）
          var hasHidePlaceholderRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.promptOnly && !r.markdownOnly;
          });
          if (!hasHidePlaceholderRegex) {
            mvuRegex.push({
              id: 'mvu-status-hide',
              scriptName: '[不发送]隐藏状态栏标记',
              findRegex: '/<StatusPlaceHolderImpl\\/>/g',
              replaceString: '',
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: false,
              promptOnly: true,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
          // 正则6：[美化]MVU状态栏 - 将 <StatusPlaceHolderImpl/> 替换为状态栏HTML（仅格式显示）
          // 检测AI是否已生成美化状态栏正则（findRegex含StatusPlaceHolderImpl + markdownOnly + 非promptOnly）
          var hasStatusBarRegex = mvuRegex.some(function(r) {
            return (r.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0 && r.markdownOnly && !r.promptOnly;
          });
          if (!hasStatusBarRegex) {
            // AI未生成时回退：用 ```html 代码块包裹默认状态栏HTML
            var statusBarReplace = '```html\n' + MVU_STATUS_BAR_HTML + '\n```';
            mvuRegex.push({
              id: 'mvu-status-bar',
              scriptName: '[美化]MVU状态栏',
              findRegex: '/<StatusPlaceHolderImpl\\/>/g',
              replaceString: statusBarReplace,
              trimStrings: [],
              placement: [2],
              disabled: false,
              markdownOnly: true,
              promptOnly: false,
              runOnEdit: true,
              substituteRegex: 0,
              minDepth: null,
              maxDepth: null
            });
          }
        }
        return {
          talkativeness: '0.5',
          fav: false,
          world: cardName,
          depth_prompt: depthPrompt,
          regex_scripts: mvuRegex,
          'xiaobaix-template': {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: { scripts: mvuScripts, variables: {} }
        };
      })(),
      character_book: {
        name: cardName,
        entries: entries
      }
    };
    // ST规范：顶层需要重复 data 中的关键字段（v3格式顶层用 creatorcomment，data内沿用 creator_notes）
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
      create_date: new Date().toISOString(),
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
        post_history_instructions: '', tags: [], creator: '时之写卡器',
        character_version: '', alternate_greetings: [], group_only_greetings: [],
        extensions: {
          talkativeness: '0.5',
          fav: false,
          world: '',
          depth_prompt: { prompt: '', depth: 4, role: 'system' },
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
        character_book: { entries: [] }
      };

      var messages = [];
      var isGenerating = false;
      var cardGenerated = false;
      var progress = 0;
      var moduleProgress = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0, init_var: 0, var_update_rule: 0 };

      function renderWelcome() {
        doc.body.innerHTML =
          '<button class="close-btn" id="closeBtn">×</button>' +
          '<div class="app">' +
            '<div class="welcome">' +
              '<h2>⚡ 时之写卡器</h2>' +
              '<p>基于SillyTavern原生机制与ST权重分层8体系，通过AI对话逐步引导你创建专业级世界模式角色卡。<br>和AI聊天就能生成符合ST规范的角色卡！</p>' +
              '<div class="welcome-features">' +
                '<div class="wf-item"><div class="wf-icon">💬</div><div class="wf-title">对话式创作</div><div class="wf-desc">像聊天一样自然，AI按权重层级逐步引导</div></div>' +
                '<div class="wf-item"><div class="wf-icon">📊</div><div class="wf-title">权重可视化</div><div class="wf-desc">展示每个条目权重等级、触发逻辑、Token占用</div></div>' +
                '<div class="wf-item"><div class="wf-icon">✅</div><div class="wf-title">32项质检</div><div class="wf-desc">8基础+4高价值+6世界书+8世界书高级+6正则+3运行效果+6附加，专业达标</div></div>' +
                '<div class="wf-item"><div class="wf-icon">🔧</div><div class="wf-title">AI优化</div><div class="wf-desc">质检未达标项一键AI优化，字段级对比</div></div>' +
              '</div>' +
              '<button class="start-btn" id="startBtn">开始创作</button>' +
              '<div class="welcome-actions">' +
                '<button class="btn btn-ghost" id="importBtn">📥 导入现有卡</button>' +
                '<button class="btn btn-ghost" id="continueBtn" style="display:none">📂 继续上次</button>' +
              '</div>' +
              '<p style="font-size:.7em;color:#b3aa98;margin-top:16px">ST权重分层8体系：🏛️基础公理 → 🤝交互软规则 → 🔐核心铁则 → 🎯近场强约束 → ⚔️场景机制 → 👥实体交互 → 📖叙事背景 → 🔄动态适配</p>' +
              '<p style="font-size:.65em;color:#b3aa98;margin-top:6px">引导流程：定核心铁则→搭世界基底→做实体内容→加场景规则→补叙事背景→做动态适配</p>' +
            '</div>' +
          '</div>';
        doc.getElementById('closeBtn').addEventListener('click', closeModal);
        doc.getElementById('startBtn').addEventListener('click', function() {
          renderChatUI();
          addAssistantMsg('你好！我是你的世界模式角色卡创作助手 🎭\n\n我会基于SillyTavern原生机制与ST权重分层8体系，通过6步引导你构建一个完整的世界。\n\n**引导流程**：定核心铁则 → 搭世界基底 → 做实体内容 → 加场景规则 → 补叙事背景 → 做动态适配\n\n在开始之前，有两个关键问题需要先明确：\n\n**1. 内容尺度**：你希望这个世界卡是什么尺度？\n   • 全年龄向：纯洁的青春、友情、冒险故事\n   • 暗黑向：残酷、深刻、成人向的剧情（非色情）\n   • NSFW（18禁）：成人内容、情欲描写\n\n**2. 核心方向**：你想做什么样的世界？\n   可以直接告诉我你的构想（如"修仙宗门""末世生存""日式校园恋爱"等），我会帮你从核心铁则开始逐步构建。\n\n请先告诉我尺度和方向，我们就可以开始创作了！');
        });
        doc.getElementById('importBtn').addEventListener('click', showImportModal);
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
              '<h1>⚡ 时之写卡器</h1>' +
              '<span class="phase" id="phaseLabel">0%</span>' +
            '</div>' +
            '<div class="main">' +
              '<div class="mobile-tabs">' +
                '<button class="mobile-tab active" data-tab="chat">💬 对话</button>' +
                '<button class="mobile-tab" data-tab="preview">📋 预览</button>' +
              '</div>' +
              '<div class="chat-panel" style="position:relative">' +
                '<div class="mod-focus" id="modFocus">' +
                  '<button class="mod-focus-btn" data-mod="axiom">🏛️ 基础公理</button>' +
                  '<button class="mod-focus-btn" data-mod="soft_rules">🤝 交互软规则</button>' +
                  '<button class="mod-focus-btn" data-mod="core_rules">🔐 核心铁则</button>' +
                  '<button class="mod-focus-btn" data-mod="near_constraint">🎯 近场强约束</button>' +
                  '<button class="mod-focus-btn" data-mod="scene_mechanics">⚔️ 场景机制</button>' +
                  '<button class="mod-focus-btn" data-mod="entity_interact">👥 实体交互</button>' +
                  '<button class="mod-focus-btn" data-mod="narrative_bg">📖 叙事背景</button>' +
                  '<button class="mod-focus-btn" data-mod="dynamic_adapt">🔄 动态适配</button>' +
                  '<button class="mod-focus-btn" data-mod="init_var">📊 初始变量</button>' +
                  '<button class="mod-focus-btn" data-mod="var_update_rule">📝 变量更新规则</button>' +
                '</div>' +
                '<div class="mod-dash" id="modDash" style="margin:0;border-left:none;border-right:none;border-radius:0">' +
                  '<div class="md-header" id="modDashHeader"><span>📊 模块进度仪表盘</span><span class="md-arrow">▼</span></div>' +
                  '<div class="md-body"></div>' +
                '</div>' +
                '<div class="chat-messages" id="chatMessages"></div>' +
                '<div class="scroll-btns" id="scrollBtns"><button id="scrollBottomBtn" title="到底部">↓</button></div>' +
                '<div class="quick-actions" id="quickActions"></div>' +
                '<div class="chat-input-area">' +
                  '<div class="chat-input-row">' +
                    '<textarea class="chat-input" id="chatInput" placeholder="描述你想要的世界..." rows="1"></textarea>' +
                    '<button class="btn-send" id="sendBtn" title="发送" aria-label="发送">' +
                      '<svg class="send-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>' +
                      '<svg class="send-spinner" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:none"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
                    '</button>' +
                  '</div>' +
                  '<div class="chat-input-char-count" id="charCount">0 / 2000</div>' +
                '</div>' +
              '</div>' +
              '<div class="preview-panel">' +
                '<div class="preview-header">' +
                  '<span>📋 预览</span>' +
                  '<span id="completionLabel" style="font-size:.72em;color:#8ba888">0%</span>' +
                  '<span id="exportLogBtn" title="导出聊天记录和后台记录" style="margin-left:auto;cursor:pointer;font-size:.7em;color:#b3aa98;opacity:.7">📋</span>' +
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
        var exportLogBtn = doc.getElementById('exportLogBtn');
        if (exportLogBtn) {
          exportLogBtn.addEventListener('click', exportChatLogs);
        }
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
        var mTabs = doc.querySelectorAll('.mobile-tab');
        for (var ti = 0; ti < mTabs.length; ti++) {
          mTabs[ti].addEventListener('click', function() {
            var tab = this.getAttribute('data-tab');
            var mainEl = doc.querySelector('.main');
            if (!mainEl) return;
            if (tab === 'preview') { mainEl.classList.add('tab-preview'); }
            else { mainEl.classList.remove('tab-preview'); }
            for (var tj = 0; tj < mTabs.length; tj++) {
              mTabs[tj].classList.toggle('active', mTabs[tj].getAttribute('data-tab') === tab);
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
            '<h3 style="color:#8a6d3b;margin-bottom:4px;font-size:1em">📥 导入角色卡</h3>' +
            '<p style="font-size:.78em;color:#8c8472;margin-bottom:8px">导入现有角色卡继续编辑，支持chara_card_v2/v3格式</p>' +
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
              '<div id="importFileInfo" style="font-size:.72em;color:#8c8472;text-align:center;display:none"></div>' +
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
        var rawData = data;
        var cd = data.data || data;
        if (!cd || typeof cd !== 'object') { showToast('无效的角色卡格式', 'error'); return; }

        cardData.name = cd.name || '';
        cardData.description = cd.description || '';
        cardData.personality = cd.personality || '';
        cardData.scenario = cd.scenario || '';
        cardData.first_mes = cd.first_mes || '';
        cardData.mes_example = cd.mes_example || '';
        cardData.creator_notes = cd.creator_notes || (rawData.creatorcomment !== undefined ? rawData.creatorcomment : '');
        cardData.system_prompt = cd.system_prompt || '';
        cardData.post_history_instructions = cd.post_history_instructions || '';
        cardData.tags = cd.tags || [];
        cardData.creator = cd.creator || '时之写卡器';
        cardData.character_version = cd.character_version !== undefined ? cd.character_version : '';
        cardData.alternate_greetings = cd.alternate_greetings || [];
        cardData.extensions = {
          talkativeness: '0.5',
          fav: false,
          world: cd.extensions && cd.extensions.world ? cd.extensions.world : '',
          depth_prompt: cd.extensions && cd.extensions.depth_prompt ? cd.extensions.depth_prompt : { prompt: '', depth: 0, role: 'system' },
          regex_scripts: normalizeRegexScripts(cd.extensions && cd.extensions.regex_scripts),
          'xiaobaix-template': cd.extensions && cd.extensions['xiaobaix-template'] ? cd.extensions['xiaobaix-template'] : {
            enabled: false,
            template: '',
            customRegex: '',
            disableParsers: false,
            skipFirstMessage: false,
            recentMessageCount: 0,
            limitToRecentMessages: false
          },
          tavern_helper: (cd.extensions && cd.extensions.tavern_helper)
            ? { scripts: (cd.extensions.tavern_helper.scripts || []), variables: (cd.extensions.tavern_helper.variables || {}) }
            : { scripts: [], variables: {} }
        };
        cardData.group_only_greetings = cd.group_only_greetings || [];

        // 导入时无论原卡是否含 character_book 都重置，避免残留旧卡条目
        cardData.character_book = { entries: [] };
        if (cd.character_book) {
          cardData.character_book = {
            entries: (cd.character_book.entries || []).map(function(e, i) {
              // 通过模板获取默认值（支持 MVU [InitVar] 等前缀）
              var comment = e.comment || '';
              var tmpl = getEntryTemplate(comment);
              var defaultPos = tmpl ? tmpl.position : 4;
              var defaultDepth = tmpl ? tmpl.depth : 4;
              var defaultOrder = tmpl ? tmpl.order : 100;
              var defaultEnabled = tmpl && tmpl.enabled !== undefined ? tmpl.enabled : true;
              // [InitVar] 条目必须 enabled=false（MVU 只读取禁用的 initvar 条目进行初始化）
              var isInitVar = comment.indexOf('[InitVar]') >= 0;
              var isVarList = comment.indexOf('变量列表') >= 0;
              var enabledVal = isInitVar ? false : (e.enabled !== undefined ? e.enabled : defaultEnabled);
              var ext = e.extensions || {};
              return {
                comment: comment,
                content: isVarList ? normalizeVarListContent(e.content || '') : (e.content || ''),
                keys: e.keys || [],
                secondary_keys: e.secondary_keys || (tmpl && tmpl.secondary_keys) || [],
                constant: e.constant !== undefined ? e.constant : (tmpl ? tmpl.constant : false),
                selective: e.selective !== undefined ? e.selective : (tmpl ? tmpl.selective : true),
                insertion_order: e.insertion_order || defaultOrder,
                enabled: enabledVal,
                use_regex: e.use_regex !== undefined ? e.use_regex : true,
                position: ext.position !== undefined ? ext.position : defaultPos,
                extensions: {
                  position: ext.position !== undefined ? ext.position : defaultPos,
                  depth: ext.depth !== undefined ? ext.depth : defaultDepth,
                  role: ext.role !== undefined ? ext.role : 0,
                  probability: ext.probability !== undefined ? ext.probability : (tmpl ? tmpl.probability : 100),
                  useProbability: ext.useProbability !== undefined ? ext.useProbability : (ext.use_probability !== undefined ? ext.use_probability : (tmpl ? tmpl.useProbability : false)),
                  selectiveLogic: ext.selectiveLogic !== undefined ? ext.selectiveLogic : (tmpl ? tmpl.selectiveLogic : 0),
                  group: ext.group || (tmpl ? tmpl.group : '') || '',
                  group_weight: ext.group_weight !== undefined ? ext.group_weight : (ext.groupWeight !== undefined ? ext.groupWeight : 100),
                  prevent_recursion: ext.prevent_recursion !== undefined ? ext.prevent_recursion : (tmpl ? tmpl.prevent_recursion : false),
                  exclude_recursion: ext.exclude_recursion !== undefined ? ext.exclude_recursion : (tmpl ? tmpl.exclude_recursion : false),
                  delay_until_recursion: ext.delay_until_recursion !== undefined ? !!ext.delay_until_recursion : (tmpl ? !!tmpl.delay_until_recursion : false),
                  use_group_scoring: ext.use_group_scoring !== undefined ? ext.use_group_scoring : false,
                  vectorized: ext.vectorized !== undefined ? ext.vectorized : false,
                  sticky: ext.sticky !== undefined && ext.sticky !== null ? ext.sticky : 0,
                  cooldown: ext.cooldown !== undefined && ext.cooldown !== null ? ext.cooldown : 0,
                  delay: ext.delay !== undefined && ext.delay !== null ? ext.delay : 0,
                  scan_depth: ext.scan_depth !== undefined ? ext.scan_depth : (tmpl ? tmpl.scan_depth : null),
                  match_whole_words: ext.match_whole_words !== undefined ? ext.match_whole_words : null,
                  case_sensitive: ext.case_sensitive !== undefined ? ext.case_sensitive : null,
                  automation_id: ext.automation_id || '',
                  display_index: ext.display_index !== undefined ? ext.display_index : i,
                  outlet_name: ext.outlet_name || '',
                  triggers: ext.triggers || [],
                  ignore_budget: ext.ignore_budget !== undefined ? ext.ignore_budget : false,
                  match_persona_description: ext.match_persona_description !== undefined ? ext.match_persona_description : false,
                  match_character_description: ext.match_character_description !== undefined ? ext.match_character_description : false,
                  match_character_personality: ext.match_character_personality !== undefined ? ext.match_character_personality : false,
                  match_character_depth_prompt: ext.match_character_depth_prompt !== undefined ? ext.match_character_depth_prompt : false,
                  match_scenario: ext.match_scenario !== undefined ? ext.match_scenario : false,
                  match_creator_notes: ext.match_creator_notes !== undefined ? ext.match_creator_notes : false
                }
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
            statusBarModules: statusBarModules,
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
            // 防御性恢复结构：避免旧版/损坏数据导致后续访问崩溃
            if (!cardData.character_book) cardData.character_book = { entries: [] };
            if (!cardData.character_book.entries) cardData.character_book.entries = [];
            if (!cardData.extensions) cardData.extensions = {};
            if (!cardData.extensions.depth_prompt) cardData.extensions.depth_prompt = { prompt: '', depth: 0, role: 'system' };
            if (!cardData.tags) cardData.tags = [];
            if (!cardData.alternate_greetings) cardData.alternate_greetings = [];
            messages = state.messages || [];
            cardGenerated = state.cardGenerated || false;
            progress = state.progress || 0;
            moduleProgress = state.moduleProgress || { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0, init_var: 0, var_update_rule: 0 };
            if (state.statusBarModules) {
              statusBarModules = state.statusBarModules;
            }
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
          // 恢复历史消息到对话区（renderChatUI 只搭建骨架，不渲染 messages）
          var savedMessages = messages.slice();
          messages = [];
          var chatC = doc.getElementById('chatMessages');
          if (chatC) chatC.innerHTML = '';
          savedMessages.forEach(function(m) {
            messages.push(m);
            appendMsg(m.role, m.content);
          });
          updateProgress();
          updateQuickActions();
          updateModFocus();
          renderPreview();
          renderModDash();
          showToast('已恢复上次创作进度', 'success');
        } else {
          showToast('没有找到保存的数据', 'warning');
        }
      }

      function handleModFocus(mod) {
        // 复用 handleQuickAction 的精细提示词，保证点击仪表盘/模块按钮都能给出体系化指令
        handleQuickAction(mod);
      }

      function updateModFocus() {
        var modBtns = doc.querySelectorAll('.mod-focus-btn');
        if (!modBtns || !modBtns.length) return;
        var mp = getModuleProgress();
        var modMap = { 'axiom': 0, 'soft_rules': 0, 'core_rules': 0, 'near_constraint': 0, 'scene_mechanics': 0, 'entity_interact': 0, 'narrative_bg': 0, 'dynamic_adapt': 0, 'init_var': 0, 'var_update_rule': 0 };
        Object.keys(mp).forEach(function(k) { if (mp[k]) modMap[k] = 100; });
        var aiMp = moduleProgress || {};
        Object.keys(aiMp).forEach(function(k) { if (aiMp[k] > 0) modMap[k] = Math.max(modMap[k] || 0, aiMp[k]); });
        modBtns.forEach(function(btn) {
          var mod = btn.getAttribute('data-mod');
          var val = modMap[mod] || 0;
          btn.classList.remove('active');
          if (val >= 100) { btn.style.background = 'rgba(139,168,136,.15)'; btn.style.color = '#8ba888'; btn.style.borderColor = 'rgba(139,168,136,.3)'; }
          else if (val > 0) { btn.style.background = 'rgba(207,159,94,.15)'; btn.style.color = '#cf9f5e'; btn.style.borderColor = 'rgba(207,159,94,.3)'; }
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
        // 引导流程7步（规范4.5）：定核心铁则→搭世界基底→做实体内容→加场景规则→补叙事背景→做动态适配→配变量系统
        if (p < 20) {
          actions.push({ action: 'core_rules', label: '🔐 定核心铁则', hl: true });
          actions.push({ action: 'axiom', label: '🏛️ 搭世界基底' });
        } else if (p < 40) {
          actions.push({ action: 'axiom', label: '🏛️ 搭世界基底', hl: true });
          actions.push({ action: 'soft_rules', label: '🤝 交互软规则' });
        } else if (p < 60) {
          actions.push({ action: 'entity_interact', label: '👥 做实体内容', hl: true });
          actions.push({ action: 'scene_mechanics', label: '⚔️ 加场景规则' });
        } else if (p < 80) {
          actions.push({ action: 'narrative_bg', label: '📖 补叙事背景' });
          actions.push({ action: 'dynamic_adapt', label: '🔄 做动态适配', hl: true });
        } else if (p < 95) {
          actions.push({ action: 'init_var', label: '📊 配变量系统', hl: true });
        } else {
          // p>=95：生成角色卡与优化已在下方常驻区展示（生成卡在高完成度时高亮）
        }
        // 常驻快捷动作
        actions.push({ action: 'next', label: '💡 下一步' });
        actions.push({ action: 'summary', label: '📊 当前进度' });
        if (!hasFirst && p >= 20) actions.push({ action: 'opening', label: '🎬 生成开场白' });
        actions.push({ action: 'qc', label: '✅ 质检' });
        actions.push({ action: 'optimize', label: '🔧 优化' });
        if (hasEntries) {
          actions.push({ action: 'weight', label: '📊 权重可视化' });
          actions.push({ action: 'group', label: '🗂️ 分组管理' });
          /* MVU状态栏预览：仅当用户已配置MVU变量系统（存在[InitVar]或核心MVU条目）时显示 */
          var hasMVU = cardData.character_book.entries.some(function(e) {
            return isMVUEntry(e.comment || '');
          });
          if (hasMVU) actions.push({ action: 'mvuPreview', label: '🎛️ 状态栏预览' });
        }
        actions.push({ action: 'generate', label: '✨ 生成角色卡', hl: p >= 95 });
        var h = '';
        actions.forEach(function(a) {
          h += '<button class="quick-btn' + (a.hl ? ' hl' : '') + '" data-action="' + a.action + '">' + a.label + '</button>';
        });
        // 导出 / 清空 作为小按钮放在快捷按钮右下角
        h += '<button class="qa-mini" id="saveBtn" title="导出角色卡">💾 导出</button>';
        h += '<button class="qa-mini" id="clearChatBtn" title="清空对话记录（不影响角色卡内容）">🗑️ 清空</button>';
        qa.innerHTML = h;
        var btns = qa.querySelectorAll('.quick-btn');
        for (var i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', function() {
            var act = this.getAttribute('data-action');
            handleQuickAction(act);
          });
        }
        bindToolbarButtons();
      }

      // 绑定导出/清空按钮（位于 quick-actions 内，每次重建后需重新绑定）
      function bindToolbarButtons() {
        var saveBtn = doc.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveCharacter);
        var clearChatBtn = doc.getElementById('clearChatBtn');
        if (clearChatBtn) {
          clearChatBtn.addEventListener('click', function() {
            if (isGenerating) { showToast('⚠️ AI正在生成中，请稍后再清除', 'warning'); return; }
            if (messages.length === 0) { showToast('对话已经是空的', 'info'); return; }
            if (!confirm('确定清空所有对话记录吗？\n\n✅ 角色卡内容不会被影响，仍会保留\n✅ 只清除聊天对话历史')) return;
            messages = [];
            var chatC = doc.getElementById('chatMessages');
            if (chatC) chatC.innerHTML = '';
            saveToStorage();
            showToast('✅ 对话已清空（角色卡内容不受影响）', 'success');
          });
        }
        // 同步禁用态（生成中）
        if (saveBtn) saveBtn.disabled = isGenerating;
      }

      function handleQuickAction(action) {
        var input = doc.getElementById('chatInput');
        if (action === 'qc') { showQualityCheck(); return; }
        if (action === 'optimize') { showOptimizeModal(); return; }
        if (action === 'weight') { showWeightVisual(); return; }
        if (action === 'group') { showGroupMgr(); return; }
        if (action === 'mvuPreview') { showMvuStatusBarPreview(); return; }
        if (action === 'generate') {
          if (input) { input.value = '生成完整角色卡'; handleSend(); }
          return;
        }
        var prompts = {
          next: '下一步我该做什么？请根据当前完成度和未达标项，给出2-3条具体可执行的建议，并说明每条建议会改善哪个体系。',
          summary: '帮我梳理一下当前已收集的信息和进度：1) 已完成的核心设定 2) 各体系完成情况 3) 还缺什么 4) 推荐的下一步。用简洁列表呈现。',
          opening: '请根据现有世界观设定生成一段500-800字的开场白（first_mes）。要求：场景描写→主角出场→冲突/悬念→结尾留钩。必须是完整文本，禁止占位符。',
          situation: '请帮我完善当前局势和主要势力关系，输出到```json代码块的 entries 字段中（近场强约束+实体交互类条目）。',
          axiom: '请帮我完善【基础公理】体系：世界元数据、世界观公理、力量体系骨架。输出到```json代码块的 entries 字段，使用<基础公理>前缀，constant=true，position=0，每条content≥250字。',
          soft_rules: '请帮我设计【交互软规则】体系：互动选项规则、叙事风格引导、剧情节奏控制。输出到```json代码块，使用<交互软规则>前缀。',
          core_rules: '请帮我完善【核心铁则】体系：绝对禁止项、输出格式要求、AI身份定位。核心规则放post_history_instructions（≤100字分号分隔），详细规则放<核心铁则>条目。',
          near_constraint: '请帮我设计【近场强约束】体系：当前局势、即时状态、临时任务。输出到```json代码块，使用<近场强约束>前缀，触发式条目depth=2。',
          scene_mechanics: '请帮我完善【场景机制】体系：核心玩法、世界规则、战斗/修炼/谈判等机制。输出到```json代码块，使用<场景机制>前缀。',
          entity_interact: '请帮我设计【实体交互】体系：重要角色（NPC）、势力与组织、关键物品、地点场景。输出到```json代码块，使用<实体交互>前缀，prevent_recursion=true。',
          narrative_bg: '请帮我完善【叙事背景】体系：故事发展、文化与习俗、历史事件、主线剧情。输出到```json代码块，使用<叙事背景>前缀，delay_until_recursion=true。',
          dynamic_adapt: '请帮我设计【动态适配】体系：引导机制、互动选项、状态栏、depth_prompt新手引导、alternate_greetings备用开局。输出到```json代码块。',
          init_var: '请帮我设计MVU变量系统：1) [InitVar]初始变量（enabled=false，YAML格式，缩进表示层级，含世界/角色/状态分层） 2) 变量列表（含{{format_message_variable::stat_data}}宏） 3) 变量更新规则 4) 变量输出格式（[mvu_update]前缀，JSON Patch格式）。输出到```json代码块的 entries 字段。',
          var_update_rule: '请帮我完善变量更新规则和变量输出格式条目：变量更新规则定义每个变量的更新条件；变量输出格式使用[mvu_update]前缀，定义<UpdateVariable>的JSON Patch（replace/delta/insert/remove/move）输出格式。'
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
      /* 导出聊天记录和后台记录（调试用，放在预览面板右上角不起眼位置） */
      function exportChatLogs() {
        var log = {
          exportTime: new Date().toISOString(),
          toolVersion: 'Card_making_tool',
          cardData: cardData,
          messages: messages,
          statusBarModules: statusBarModules,
          progress: progress,
          moduleProgress: moduleProgress
        };
        var blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url;
        a.download = 'chatlog_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ 已导出聊天记录和后台记录', 'success');
      }
      function appendMsg(role, content) {
        var c = doc.getElementById('chatMessages');
        if (!c) return;
        var div = doc.createElement('div');
        div.className = 'chat-msg ' + role;
        var avatarHtml = buildAvatarHtml(role);
        div.innerHTML = avatarHtml + '<div class="bubble">' + fmtBubble(content) + '</div>';
        c.appendChild(div);
        var avEl = div.querySelector('.avatar-clickable');
        if (avEl) avEl.addEventListener('click', function() { triggerAvatarUpload(role); });
        scrollChat();
      }
      function buildAvatarHtml(role) {
        var key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        var cls = 'avatar avatar-clickable';
        var title = role === 'user' ? '点击更换用户头像' : '点击更换AI头像';
        var saved = localStorage.getItem(key);
        if (saved) {
          return '<div class="' + cls + '" title="' + title + '" style="cursor:pointer;background-image:url(' + saved + ');background-size:cover;background-position:center"></div>';
        }
        var icon = role === 'user' ? '👤' : '🤖';
        return '<div class="' + cls + '" title="' + title + '" style="cursor:pointer">' + icon + '</div>';
      }
      function triggerAvatarUpload(role) {
        var key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        var input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        doc.body.appendChild(input);
        input.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            var img = new Image();
            img.onload = function() {
              var size = Math.min(img.width, img.height);
              var canvas = doc.createElement('canvas');
              canvas.width = 128; canvas.height = 128;
              var ctx = canvas.getContext('2d');
              var sx = (img.width - size) / 2, sy = (img.height - size) / 2;
              ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
              var dataUrl = canvas.toDataURL('image/png');
              localStorage.setItem(key, dataUrl);
              refreshAllAvatars(role);
              showToast((role === 'user' ? '用户' : 'AI') + '头像已更新', 'success');
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
          doc.body.removeChild(input);
        });
        input.click();
      }
      function refreshAllAvatars(role) {
        var key = role === 'user' ? 'userAvatar' : 'aiAvatar';
        var saved = localStorage.getItem(key);
        if (!saved) return;
        var avatars = doc.querySelectorAll('.chat-msg.' + role + ' .avatar-clickable');
        for (var i = 0; i < avatars.length; i++) {
          avatars[i].innerHTML = '';
          avatars[i].style.backgroundImage = 'url(' + saved + ')';
          avatars[i].style.backgroundSize = 'cover';
          avatars[i].style.backgroundPosition = 'center';
        }
      }
      function addTyping() {
        removeTyping();
        var c = doc.getElementById('chatMessages');
        if (!c) return;
        var div = doc.createElement('div');
        div.className = 'chat-msg assistant';
        div.id = 'typingInd';
        div.innerHTML = buildAvatarHtml('assistant') + '<div class="bubble typing"><span>●</span><span>●</span><span>●</span> 思考中...</div>';
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
            var h = p.content;
            var placeholders = [];
            var iframes = [];
            // 先保护 ```json 代码块（避免内部HTML被误匹配）
            h = h.replace(/```json\s*([\s\S]*?)```/g, function(_, code) {
              placeholders.push('<pre><code>' + code + '</code></pre>');
              return '__PROTECTED_BLOCK_' + (placeholders.length - 1) + '__';
            });
            // 保护其他 ```代码块
            h = h.replace(/```\w*\s*([\s\S]*?)```/g, function(_, code) {
              placeholders.push('<pre><code>' + code + '</code></pre>');
              return '__PROTECTED_BLOCK_' + (placeholders.length - 1) + '__';
            });
            /* 渲染 ```html 代码块为 iframe */
            h = h.replace(/```html\s*\n([\s\S]*?)```/gi, function(_, code) {
              iframes.push(renderHtmlToIframe(code.replace(/\\n/g, '\n')));
              return '__HTML_IFRAME_' + (iframes.length - 1) + '__';
            });
            /* 检测消息中直接包含的完整HTML文档（非代码块格式） */
            h = h.replace(/(?:html\s*[\n\\n]+)?(<!doctype html>[\s\S]*?<\/html>)/gi, function(_, htmlCode) {
              var code = htmlCode.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              iframes.push(renderHtmlToIframe(code));
              return '__HTML_IFRAME_' + (iframes.length - 1) + '__';
            });
            h = h.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
            h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
            h = h.replace(/\n{3,}/g, '\n\n');
            h = h.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
            // 还原iframe占位符
            for (var ii = 0; ii < iframes.length; ii++) {
              h = h.replace('__HTML_IFRAME_' + ii + '__', iframes[ii]);
            }
            // 还原受保护的代码块
            for (var pi = 0; pi < placeholders.length; pi++) {
              h = h.replace('__PROTECTED_BLOCK_' + pi + '__', placeholders[pi]);
            }
            out += h;
          }
        });
        return out;
      }
      function renderHtmlToIframe(htmlCode) {
        if (!htmlCode || htmlCode.length < 50) return '';
        /* 注入与状态栏预览一致的完整 mock 运行时（getAllVariables/_/$/waitGlobalInitialized/eventOn/Mvu/errorCatched），
           保证状态栏 HTML 在聊天内预览也能正确渲染变量 */
        var mockScript = buildPreviewMockScript(getStatDataForRender());
        if (htmlCode.indexOf('<head') >= 0) {
          htmlCode = htmlCode.replace(/<head([^>]*)>/i, '<head$1>' + mockScript);
        } else if (htmlCode.indexOf('<html') >= 0) {
          htmlCode = htmlCode.replace(/<html([^>]*)>/i, '<html$1><head>' + mockScript + '</head>');
        } else {
          htmlCode = mockScript + htmlCode;
        }
        var escHtml = htmlCode.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return '<iframe class="html-render-frame" srcdoc="' + escHtml + '" sandbox="allow-scripts" style="width:100%;min-height:280px;border:1px solid #e6dfd0;border-radius:6px;background:transparent"></iframe>';
      }
      function getStatDataForRender() {
        var statData = {};
        var entries = (cardData.character_book && cardData.character_book.entries) || [];
        var initVarEntry = null;
        for (var i = 0; i < entries.length; i++) {
          if ((entries[i].comment || '').indexOf('[InitVar]') >= 0) { initVarEntry = entries[i]; break; }
        }
        if (initVarEntry && initVarEntry.content) {
          var parsed = parseInitVar(initVarEntry.content);
          if (parsed) statData = parsed;
        }
        return statData;
      }
      // 构建预览用 mock 运行时脚本（模拟酒馆环境），供聊天内 iframe 预览与状态栏预览弹窗共用
      // 提供 getAllVariables / waitGlobalInitialized / eventOn / errorCatched / Mvu / _ / $ + fallback 渲染
      function buildPreviewMockScript(statData) {
        statData = statData || {};
        var statDataJson = JSON.stringify(statData).replace(/<\/script/gi, '<\\/script');
        return '<script>\n' +
          '/* === 写卡器预览用 mock API（模拟酒馆运行时）=== */\n' +
          '(function() {\n' +
          '  var statData = ' + statDataJson + ';\n' +
          '  window.__PREVIEW_MOCK_STAT_DATA__ = statData;\n' +
          '  window.getAllVariables = function() { return { stat_data: statData }; };\n' +
          '  window.waitGlobalInitialized = function(name) { return Promise.resolve(); };\n' +
          '  window.eventOn = function(evt, cb) {};\n' +
          '  window.errorCatched = function(fn) {\n' +
          '    return function() {\n' +
          '      try {\n' +
          '        var r = fn.apply(this, arguments);\n' +
          '        if (r && typeof r.catch === "function") {\n' +
          '          r.catch(function(e) { console.warn("[预览 mock] statusbar async error:", e && e.message, e && e.stack); });\n' +
          '        }\n' +
          '        return r;\n' +
          '      } catch(e) { console.warn("[预览 mock] statusbar sync error:", e && e.message, e && e.stack); }\n' +
          '    };\n' +
          '  };\n' +
          '  window.Mvu = { events: { VARIABLE_INITIALIZED: "VARIABLE_INITIALIZED", VARIABLE_UPDATE_ENDED: "VARIABLE_UPDATE_ENDED" } };\n' +
          '  window._ = { get: function(obj, path, def) {\n' +
          '    if (obj == null) return def;\n' +
          '    var keys = String(path).split(".");\n' +
          '    var cur = obj;\n' +
          '    for (var i = 0; i < keys.length; i++) {\n' +
          '      if (cur == null) return def;\n' +
          '      cur = cur[keys[i]];\n' +
          '    }\n' +
          '    return cur === undefined ? def : cur;\n' +
          '  }};\n' +
          '  function _miniJQ(sel) {\n' +
          '    if (typeof sel === "function") {\n' +
          '      try {\n' +
          '        if (document.readyState === "complete" || document.readyState === "interactive") { sel(); }\n' +
          '        else { document.addEventListener("DOMContentLoaded", sel); }\n' +
          '      } catch(e) { console.warn("[预览 mock] $(fn):", e); }\n' +
          '      return { ready: function(fn) { try { fn(); } catch(e) {} return this; } };\n' +
          '    }\n' +
          '    var el = (typeof sel === "string") ? document.querySelector(sel) : sel;\n' +
          '    return {\n' +
          '      0: el, length: el ? 1 : 0,\n' +
          '      html: function(s) { if (el) el.innerHTML = (s == null ? (el.innerHTML || "") : String(s)); return this; },\n' +
          '      text: function(s) { if (el) el.textContent = s; return this; },\n' +
          '      addClass: function(c) { if (el) el.classList.add(c); return this; },\n' +
          '      removeClass: function(c) { if (el) el.classList.remove(c); return this; },\n' +
          '      ready: function(fn) { try { fn(); } catch(e) {} return this; }\n' +
          '    };\n' +
          '  }\n' +
          '  window.$ = window.jQuery = _miniJQ;\n' +
          '  function fallbackRender() {\n' +
          '    var root = document.getElementById("render-root") || document.querySelector(".card-body") || document.body;\n' +
          '    if (!root) return;\n' +
          '    var stillLoading = root.querySelector(".loading-state");\n' +
          '    if (!stillLoading) return;\n' +
          '    var htmlStr = "";\n' +
          '    var data = statData || {};\n' +
          '    function rt(obj, level) {\n' +
          '      level = level || 0;\n' +
          '      var indentClass = "indent-" + Math.min(level, 4);\n' +
          '      var itemsHtml = "";\n' +
          '      var keys = Object.keys(obj || {});\n' +
          '      for (var k = 0; k < keys.length; k++) {\n' +
          '        var key = keys[k];\n' +
          '        var value = obj[key];\n' +
          '        if (key.indexOf("_") === 0 || key.indexOf("$") === 0) continue;\n' +
          '        var isPlainObj = value !== null && typeof value === "object" && !Array.isArray(value);\n' +
          '        if (isPlainObj) {\n' +
          '          if (itemsHtml) { htmlStr += "<div class=\\"stat-grid " + indentClass + "\\">" + itemsHtml + "</div>"; itemsHtml = ""; }\n' +
          '          if (level > 0) { htmlStr += "<div class=\\"category-title " + indentClass + "\\">" + key + "</div>"; }\n' +
          '          rt(value, level + 1);\n' +
          '          continue;\n' +
          '        }\n' +
          '        itemsHtml += "<div class=\\"stat-item\\"><span class=\\"stat-label\\">" + key + "</span><span class=\\"stat-value\\">";\n' +
          '        if (typeof value === "number") itemsHtml += "<span class=\\"value-number\\">" + value + "</span>";\n' +
          '        else if (typeof value === "boolean") itemsHtml += value ? "<span class=\\"value-true\\">✓</span>" : "<span class=\\"value-false\\">✕</span>";\n' +
          '        else if (Array.isArray(value)) itemsHtml += "<span class=\\"value-text\\">[" + value.join(", ") + "]</span>";\n' +
          '        else itemsHtml += "<span class=\\"value-text\\">" + String(value == null ? "" : value) + "</span>";\n' +
          '        itemsHtml += "</span></div>";\n' +
          '      }\n' +
          '      if (itemsHtml) htmlStr += "<div class=\\"stat-grid " + indentClass + "\\">" + itemsHtml + "</div>";\n' +
          '    }\n' +
          '    rt(data, 0);\n' +
          '    try {\n' +
          '      root.innerHTML = htmlStr;\n' +
          '      root.classList.add("flash-update");\n' +
          '      setTimeout(function() { try { root.classList.remove("flash-update"); } catch(_) {} }, 300);\n' +
          '    } catch(_) {}\n' +
          '  }\n' +
          '  setTimeout(fallbackRender, 500);\n' +
          '  setTimeout(fallbackRender, 1500);\n' +
          '  setTimeout(fallbackRender, 3500);\n' +
          '})();\n' +
          '<\/script>\n';
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
          { key: 'dynamic_adapt', icon: '🔄', name: '动态适配', group: '动态' },
          { key: 'init_var', icon: '📊', name: '初始变量', group: '变量' },
          { key: 'var_update_rule', icon: '📝', name: '变量更新规则', group: '变量' }
        ];
        // 计算总进度（用于仪表盘头部展示）
        var totalPct = 0;
        var doneCount = 0;
        labels.forEach(function(l) {
          var v = mp[l.key] || 0;
          totalPct += v;
          if (v >= 100) doneCount++;
        });
        var avgPct = Math.round(totalPct / labels.length);
        var groups = { '常驻': '#8ba888', '触发': '#8a6d3b', '动态': '#b89968', '变量': '#7fa8c9' };
        var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #efe9dc">' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px">';
        Object.keys(groups).forEach(function(g) {
          h += '<span style="font-size:.62em;color:' + groups[g] + ';background:rgba(255,255,255,.03);padding:1px 6px;border-radius:3px">' + g + '体系</span>';
        });
        h += '</div>' +
          '<span style="font-size:.65em;color:' + (avgPct >= 100 ? '#8ba888' : avgPct >= 50 ? '#8a6d3b' : '#8c8472') + '">' + doneCount + '/' + labels.length + ' 完成 · 均' + avgPct + '%</span>' +
          '</div>';
        labels.forEach(function(l) {
          var val = mp[l.key] || 0;
          var cls = val >= 100 ? 'done' : val > 0 ? 'prog' : 'empty';
          var groupColor = groups[l.group] || '#8c8472';
          h += '<div class="mod-dash-item" data-mod="' + l.key + '" title="' + l.group + '体系 · 点击让AI完善此模块">' +
            '<span class="m-icon">' + l.icon + '</span>' +
            '<span class="m-name" style="color:' + groupColor + '">' + l.name + '</span>' +
            '<span class="m-bar-wrap"><span class="m-bar ' + cls + '" style="width:' + val + '%"></span></span>' +
            '<span class="m-pct">' + val + '%</span>' +
          '</div>';
        });
        var body = dash.querySelector('.md-body');
        if (body) body.innerHTML = h;
        // 仪表盘条目点击：让AI完善对应模块
        var items = dash.querySelectorAll('.mod-dash-item');
        for (var i = 0; i < items.length; i++) {
          items[i].addEventListener('click', function() {
            var mod = this.getAttribute('data-mod');
            if (mod) handleModFocus(mod);
          });
        }
        // 头部：折叠/展开 + AI分析按钮（避免重复绑定）
        var header = dash.querySelector('.md-header');
        if (header) {
          if (!header.getAttribute('data-bound')) {
            header.setAttribute('data-bound', '1');
            header.addEventListener('click', function(e) {
              // 点击 AI分析按钮不触发挥折叠
              if (e.target.closest('.md-analyze-btn')) return;
              toggleDash();
            });
          }
          var btn = header.querySelector('.md-analyze-btn');
          if (!btn) {
            btn = doc.createElement('button');
            btn.className = 'md-analyze-btn';
            btn.type = 'button';
            btn.textContent = '🔍 AI分析';
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              handleAnalyzeProgress();
            });
            header.appendChild(btn);
          }
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
            '请全面分析当前角色卡内容，完成以下任务：\n' +
            '1. 评估每个体系的完成度（0-100），输出到```json代码块\n' +
            '2. JSON格式（严格）：{"axiom":0-100,"soft_rules":0-100,"core_rules":0-100,"near_constraint":0-100,"scene_mechanics":0-100,"entity_interact":0-100,"narrative_bg":0-100,"dynamic_adapt":0-100,"init_var":0-100,"var_update_rule":0-100}\n' +
            '   评分标准：0=无内容，30=有1条短内容，60=有1条≥250字，80=有1条≥500字，100=≥2条且总长≥500字\n' +
            '3. 用自然语言给出每个体系的改进建议和下一步行动方向\n' +
            '4. 最后给出一条适合用户直接输入的建议指令（放在<suggestion>标签中，标签内是纯指令文本，不含解释）\n\n' +
            '=== 当前角色卡内容 ===\n' +
            (cardData.name ? '- 名称：' + cardData.name + '\n' : '') +
            (cardData.description ? '- 描述(' + (cardData.description||'').length + '字)：' + (cardData.description||'').substring(0, 500) + '\n' : '') +
            (cardData.first_mes ? '- 开场白(' + (cardData.first_mes||'').length + '字)\n' : '') +
            (cardData.post_history_instructions ? '- 核心铁则(' + (cardData.post_history_instructions||'').length + '字)\n' : '') +
            '- 世界书条目：' + entries.length + '条\n' +
            (entries.length > 0 ? '- 条目清单：\n' + entries.map(function(e) { return '  · [' + (e.comment||'未命名') + '] ' + (e.content||'').length + '字' + (e.enabled === false ? ' (禁用)' : ''); }).join('\n') : '');
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
        var result = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0, init_var: 0, var_update_rule: 0 };
        var modKeywords = {
          axiom: ['基础公理', '世界元数据', '世界观公理', '力量体系骨架'],
          soft_rules: ['交互软规则', '互动选项', '叙事风格', '剧情引导'],
          core_rules: ['核心铁则', '绝对禁止', '输出格式', 'AI身份', 'post_history'],
          near_constraint: ['近场强约束', '当前局势', '即时状态', '临时任务'],
          scene_mechanics: ['场景机制', '核心玩法', '世界规则', '战斗规则', '修炼', '谈判'],
          entity_interact: ['实体交互', '重要角色', '势力与组织', '物品', '地点场景', 'NPC'],
          narrative_bg: ['叙事背景', '故事发展', '文化与习俗', '历史事件', '主线剧情'],
          dynamic_adapt: ['动态适配', '引导机制', '互动选项', '状态栏', 'alternate', 'depth_prompt'],
          init_var: ['[InitVar]', '初始变量', 'InitVar', '变量列表'],
          var_update_rule: ['变量更新规则', '变量输出格式', 'UpdateVariable', 'status_current_variable', 'mvu_update']
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
          // 完成度计算：1条+长度≥250 → 60%；1条+长度≥500 → 80%；≥2条+长度≥500 → 100%
          if (count >= 2 && totalLen >= 500) result[mod] = 100;
          else if (count >= 1 && totalLen >= 500) result[mod] = 80;
          else if (count >= 1 && totalLen >= 250) result[mod] = 60;
          else if (count >= 1) result[mod] = Math.min(30 + Math.floor(totalLen / 25), 55);
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
          '动态适配': 'dynamic_adapt',
          '初始变量': 'init_var',
          '变量更新规则': 'var_update_rule',
          '变量系统': 'init_var'
        };
        var result = { axiom: 0, soft_rules: 0, core_rules: 0, near_constraint: 0, scene_mechanics: 0, entity_interact: 0, narrative_bg: 0, dynamic_adapt: 0, init_var: 0, var_update_rule: 0 };
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
            var fixed = repairJSON(jsonContent);
            if (fixed) return fixed;
          }
        }
        var braceStart = text.indexOf('{');
        var braceEnd = text.lastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart) {
          var candidate = text.substring(braceStart, braceEnd + 1);
          try { return JSON.parse(candidate.trim()); } catch(e) {}
          var fixed2 = repairJSON(candidate);
          if (fixed2) return fixed2;
        }
        return null;
      }

      // ===== 兜底：从AI回复中提取状态栏HTML（当AI只输出```html而非JSON时）=====
      // 场景：用户让AI"改状态栏"，AI直接输出了```html代码块而非JSON的regex_scripts
      // 此时extractJSON提取不到，需要这个兜底机制把HTML保存到cardData.extensions.regex_scripts
      function tryExtractStatusBarHtml(aiText) {
        if (!aiText) return false;
        // ⚠️ 若AI回复中已存在 Step 模块标记，则Step拼接逻辑(tryExtractAndAssembleStatusBar)优先级更高，不走此兜底
        if (/\/\*\s*===\s*Step\s*\d/.test(aiText)) return false;
        // 匹配所有 ```html 代码块
        var htmlBlocks = [];
        var htmlRe = /```html\s*\n([\s\S]*?)\n```/gi;
        var m;
        while ((m = htmlRe.exec(aiText)) !== null) {
          htmlBlocks.push(m[1]);
        }
        // 也匹配无语言标记的 ``` 代码块（可能含HTML）
        if (htmlBlocks.length === 0) {
          var genericRe = /```\s*\n([\s\S]*?)\n```/g;
          while ((m = genericRe.exec(aiText)) !== null) {
            if (m[1].indexOf('<html') >= 0 || m[1].indexOf('<!doctype') >= 0 || m[1].indexOf('<head') >= 0) {
              htmlBlocks.push(m[1]);
            }
          }
        }
        if (htmlBlocks.length === 0) return false;

        // 强负面关键词：含这些内容一定不是状态栏HTML（是写卡器进度块/世界书条目碎片等）
        var blockBlacklist = ['<statusblock>', '</statusblock>', '信息完整度', '需要您补充的信息',
                              '基础公理', '交互软规则', '核心铁则', '```json', '```js', '```yaml',
                              'Step 1：', 'Step 2：', 'Step 3：', 'Step 4：', 'Step 5：',
                              'Step 6：', 'Step 7：', 'Step 8：', '/* === Step',
                              '📊 变量系统', '🏛️ 基础公理', '🤝 交互软规则', '🔐 核心铁则',
                              'character_book', 'entries', 'comment', 'insertion_order'];
        // 状态栏HTML专属特征：必须出现HTML结构 + 多个渲染相关特征词才认定
        var mustHaveStructure = ['<!doctype', '<html', '<style', '<script'];
        var statusBarKeywords = ['StatusPlaceHolderImpl', 'render-root', 'stat_data', 'waitGlobalInitialized',
                                 'getAllVariables', 'mvu-status', 'card-body', 'refreshStatus', 'renderTree',
                                 'matrix-card', 'matrix-grid', 'm-bar-wrap', '.m-label', '.m-value',
                                 'renderVars', 'loadVars', 'mvu-matrix-ui', 'mvu-status-card'];
        var statusBarHtml = null;
        for (var i = 0; i < htmlBlocks.length; i++) {
          var block = htmlBlocks[i];
          // 黑名单过滤：直接跳过含进度块/世界书/Step碎片的代码块
          var hitBlack = false;
          for (var b = 0; b < blockBlacklist.length; b++) {
            if (block.indexOf(blockBlacklist[b]) >= 0) { hitBlack = true; break; }
          }
          if (hitBlack) continue;
          // 结构验证：至少出现2个HTML结构标签（非单纯CSS/JS碎片）
          var structCount = 0;
          for (var s = 0; s < mustHaveStructure.length; s++) {
            if (block.indexOf(mustHaveStructure[s]) >= 0) structCount++;
          }
          if (structCount < 2) continue;
          // 特征关键词：至少4个才认为是状态栏HTML（避免误匹配MVU schema等内容）
          var matchCount = 0;
          for (var k = 0; k < statusBarKeywords.length; k++) {
            if (block.indexOf(statusBarKeywords[k]) >= 0) matchCount++;
          }
          if (matchCount >= 4) {
            // 清理字面量转义字符
            var cleaned = block;
            if (cleaned.indexOf('\\n') >= 0) cleaned = cleaned.replace(/\\n/g, '\n');
            if (cleaned.indexOf('\\"') >= 0) cleaned = cleaned.replace(/\\"/g, '"');
            if (cleaned.indexOf('\\\\') >= 0) cleaned = cleaned.replace(/\\\\/g, '\\');
            statusBarHtml = cleaned;
            break;
          }
        }
        if (!statusBarHtml) return false;

        // 保存到 cardData.extensions.regex_scripts
        cardData.extensions = cardData.extensions || {};
        var rxList = cardData.extensions.regex_scripts || [];
        var findRegex = '/<StatusPlaceHolderImpl\\/>/g';
        // 查找已有的状态栏正则（按 findRegex 含 StatusPlaceHolder + markdownOnly + !promptOnly 匹配）
        var foundIdx = -1;
        for (var j = 0; j < rxList.length; j++) {
          var r = rxList[j];
          // 匹配 StatusPlaceHolder（兼容带Impl和不带Impl的旧版本）
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
            foundIdx = j;
            break;
          }
        }
        var wrappedHtml = '```html\n' + statusBarHtml + '\n```';
        if (foundIdx >= 0) {
          // 覆盖更新
          rxList[foundIdx].replaceString = wrappedHtml;
          rxList[foundIdx].findRegex = findRegex;
          rxList[foundIdx].markdownOnly = true;
          rxList[foundIdx].promptOnly = false;
          rxList[foundIdx].placement = [2];
          rxList[foundIdx].runOnEdit = true;
          rxList[foundIdx].substituteRegex = rxList[foundIdx].substituteRegex || 0;
          rxList[foundIdx].disabled = false;
          rxList[foundIdx].id = 'mvu-status-bar';
          rxList[foundIdx].scriptName = '[美化]MVU状态栏';
        } else {
          // 新增
          rxList.push({
            id: 'mvu-status-bar',
            scriptName: '[美化]MVU状态栏',
            findRegex: findRegex,
            replaceString: wrappedHtml,
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
        }
        cardData.extensions.regex_scripts = rxList;
        return true;
      }

      // ===== 模块拼接：从AI回答中提取各Step代码块，由写卡器JS自动拼接成完整HTML =====
      // 核心思路：AI分步生成各模块（每步用 /* === Step N: 标题 === */ 标记+代码块），
      //          写卡器收集各模块代码，在JS层面机械拼接，不受AI单次输出长度限制
      // 全局存储各Step最新代码（跨多轮对话累积）
      var statusBarModules = { step2: null, step3: null, step4: null, step5: null, step6: null, step7: null };

      function assembleStatusBarFromModules() {
        // ⚠️完整性校验：6个模块必须全部存在，确保最终状态栏完整可用
        // 缺任何一个模块都不拼接，避免生成残缺不可用的状态栏
        var requiredSteps = ['step2', 'step3', 'step4', 'step5', 'step6', 'step7'];
        for (var ri = 0; ri < requiredSteps.length; ri++) {
          if (!statusBarModules[requiredSteps[ri]]) return '';
        }

        var cssParts = [];
        cssParts.push('/* === Step 2: 配色方案 === */\n' + statusBarModules.step2);
        cssParts.push('/* === Step 4: CSS样式 === */\n' + statusBarModules.step4);
        var jsParts = [];
        jsParts.push('/* === Step 5: 变量读取 === */\n' + statusBarModules.step5);
        jsParts.push('/* === Step 6: 渲染函数 === */\n' + statusBarModules.step6);
        jsParts.push('/* === Step 7: 事件绑定+入口 === */\n' + statusBarModules.step7);

        var assembledHtml = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n';
        if (cssParts.length) {
          assembledHtml += '  <style>\n' + cssParts.join('\n\n') + '\n  </style>\n';
        }
        if (jsParts.length) {
          assembledHtml += '  <script defer>\n(function() {\n  var ready = function(fn) {\n    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 0);\n    else if (document.addEventListener) document.addEventListener("DOMContentLoaded", fn);\n  };\n  var ec = function(fn) { return function() { try { var r = fn.apply(this, arguments); if (r && r.catch) r.catch(function(e) { console.warn("[statusbar] async:", e); }); return r; } catch(e) { console.warn("[statusbar] sync:", e); } } }; };\n  /* 酒馆助手运行时兼容（预览环境兜底） */\n  if (typeof waitGlobalInitialized === "undefined") { window.waitGlobalInitialized = function(n) { return new Promise(function(r) { if (window[n]) { r(); return; } var c = setInterval(function() { if (window[n]) { clearInterval(c); r(); } }, 100); setTimeout(function() { clearInterval(c); r(); }, 3000); }); }; }\n  if (typeof errorCatched === "undefined") { window.errorCatched = function(fn) { return function() { try { return fn.apply(this, arguments); } catch(e) { console.warn("[statusbar]", e); } }; }; }\n  if (typeof eventOn === "undefined") { window.eventOn = function() {}; }\n  if (typeof Mvu === "undefined") { window.Mvu = { events: { VARIABLE_INITIALIZED: "VARIABLE_INITIALIZED", VARIABLE_UPDATE_ENDED: "VARIABLE_UPDATE_ENDED" } }; }\n'
            + jsParts.join('\n\n')
            + '\n})();\n  <\/script>\n';
        }
        assembledHtml += '</head>\n<body>\n';
        assembledHtml += statusBarModules.step3 + '\n';
        assembledHtml += '</body>\n</html>';
        return assembledHtml;
      }

      // 检测并处理 <clear_statusbar>2,3,4</clear_statusbar> 标记
      // AI在修改模块前输出此标记，清空需要重新生成的模块（支持多个一并清空）
      function processClearStatusModules(aiText) {
        if (!aiText) return null;
        var match = aiText.match(/<clear_statusbar>\s*([\d,\s]+)\s*<\/clear_statusbar>/i);
        if (!match) return null;
        var nums = match[1].split(/[,\s]+/).filter(function(s) { return s.trim(); });
        var cleared = [];
        for (var i = 0; i < nums.length; i++) {
          var n = parseInt(nums[i].trim(), 10);
          if (n >= 2 && n <= 7) {
            statusBarModules['step' + n] = null;
            cleared.push(n);
          }
        }
        return cleared.length ? cleared : null;
      }

      function tryExtractAndAssembleStatusBar(aiText) {
        if (!aiText) return false;
        // 强负面关键词：含这些内容的代码块是无效内容（写卡器进度块/世界书碎片等），直接丢弃
        var codeBlacklist = ['<statusblock>', '信息完整度', '需要您补充的信息',
                             '基础公理', '交互软规则', '核心铁则', '近场强约束',
                             'character_book', '"entries"', '"comment"', '"insertion_order"',
                             '角色卡', '体系完成度', '待补充', '进行中', '⏳', '❌', '✅',
                             '```json', '```yaml', '"enabled"', '"constant"', '"position"',
                             '📊 变量系统', '🏛️ 基础公理', '🤝 交互软规则', '🔐 核心铁则'];
        function isBadCode(code) {
          for (var bi = 0; bi < codeBlacklist.length; bi++) {
            if (code.indexOf(codeBlacklist[bi]) >= 0) return true;
          }
          return false;
        }
        // 截断函数：AI可能在Step代码块后又输出了其他代码块（条目JSON、脚本、<statusblock>等）
        // 这些多余内容会被stepRe2贪婪匹配进来，需要截断只保留Step本身的代码
        function truncateAtExtraContent(code) {
          if (!code) return code;
          // 截断标记：遇到这些内容说明后面是多余的其他代码块，截断到该位置之前
          var cutMarkers = [
            '<statusblock>', '</statusblock>',
            '```json', '```yaml', '```toml',
            'character_book', '"entries"', '"insertion_order"',
            '信息完整度', '需要您补充的信息',
            '基础公理', '交互软规则', '核心铁则', '近场强约束',
            '<!doctype', '<html'
          ];
          var cutIdx = code.length;
          for (var ci = 0; ci < cutMarkers.length; ci++) {
            var idx = code.indexOf(cutMarkers[ci]);
            if (idx >= 0 && idx < cutIdx) cutIdx = idx;
          }
          // 检查是否有第二个 ``` 代码块（说明AI又输出了其他代码块）
          // 找到第一个 ``` 的结束位置
          var firstFence = code.indexOf('```');
          if (firstFence >= 0) {
            var endFence = code.indexOf('```', firstFence + 3);
            if (endFence >= 0) {
              // 检查 endFence+3 之后是否还有其他 ``` 代码块
              var afterFirst = code.substring(endFence + 3);
              var nextFence = afterFirst.indexOf('```');
              if (nextFence >= 0) {
                var secondFencePos = endFence + 3 + nextFence;
                if (secondFencePos < cutIdx) cutIdx = secondFencePos;
              }
            }
          }
          if (cutIdx < code.length) {
            code = code.substring(0, cutIdx).trim();
          }
          return code;
        }
        // Step语义校验：根据Step号验证代码内容是否匹配预期类型
        function validateStepContent(stepNum, code) {
          if (!code || code.length < 8) return false;
          if (isBadCode(code)) return false;
          switch (stepNum) {
            case 2: // Step2：配色方案 —— 必须含 :root { 或 CSS变量定义
              return code.indexOf(':root') >= 0 || /--[\w-]+\s*:/.test(code);
            case 3: // Step3：HTML骨架 —— 必须含HTML标签
              return /<\w+[\s>]/g.test(code) || code.indexOf('<div') >= 0 || code.indexOf('<span') >= 0;
            case 4: // Step4：CSS样式 —— 必须含选择器{规则}
              return code.indexOf('{') >= 0 && (code.indexOf('.') >= 0 || code.indexOf('#') >= 0);
            case 5: // Step5：变量读取 —— 必须含 function 或 _.get 或 getAllVariables
              return code.indexOf('function') >= 0 || code.indexOf('_.get') >= 0 || code.indexOf('getAllVariables') >= 0;
            case 6: // Step6：渲染函数 —— 必须含 function 或 .text( 或 .html( 或 jquery 操作
              return code.indexOf('function') >= 0 || code.indexOf('.text(') >= 0 || code.indexOf('.html(') >= 0 || code.indexOf('renderVars') >= 0;
            case 7: // Step7：事件入口 —— 必须含 waitGlobalInitialized 或 eventOn 或 $(errorCatched 或 init()
              return code.indexOf('waitGlobalInitialized') >= 0 || code.indexOf('eventOn') >= 0 || code.indexOf('errorCatched') >= 0 || code.indexOf('init') >= 0;
          }
          return true;
        }
        // 提取所有 /* === Step N: 标题 === */ 标记后的代码块
        // 兼容写法：允许 */ 与 ``` 之间有任意空白（换行/空格），以及 ``` 后语言标记可选
        var stepRe = /\/\*\s*===\s*Step\s*(\d+)\s*[:：]\s*[^=]*?===\s*\*\/\s*(?:\s*\n)?\s*```[a-z]*\s*\n([\s\S]*?)\n```/gi;
        var m;
        var foundAny = false;
        var stepsFoundInThisRound = []; // 记录本次提取到的Step号（用于多模块检测）
        // 清理代码中的字面量转义：将 \n（两个字符）转为真实换行，\" 转为 "，\\ 转为 \
        function cleanCode(code) {
          // 仅当代码中存在字面量 \n 时才处理（避免破坏正常的正则表达式中的 \n）
          if (code.indexOf('\\n') >= 0) {
            code = code.replace(/\\n/g, '\n');
          }
          if (code.indexOf('\\"') >= 0) {
            code = code.replace(/\\"/g, '"');
          }
          if (code.indexOf('\\\\') >= 0) {
            code = code.replace(/\\\\/g, '\\');
          }
          return code;
        }
        while ((m = stepRe.exec(aiText)) !== null) {
          var stepNum = parseInt(m[1], 10);
          var code = cleanCode(m[2]);
          if (stepNum >= 2 && stepNum <= 7 && validateStepContent(stepNum, code)) {
            // ⚠️严格单模块限制：如果本次已经提取到一个有效Step，跳过后续的（仅取第一个）
            if (stepsFoundInThisRound.length >= 1) {
              console.warn('[statusbar] ⚠️AI一次输出了多个Step代码块，仅提取第一个(Step ' + stepsFoundInThisRound[0] + ')，忽略Step ' + stepNum);
              continue;
            }
            statusBarModules['step' + stepNum] = code;
            stepsFoundInThisRound.push(stepNum);
            foundAny = true;
          }
        }
        // 也匹配无 ``` 包裹但紧跟标记的代码（AI可能直接写代码不包代码块）
        // 兼容：修正正则的中括号，避免 [^*=] 过度匹配导致捕获范围错误
        var stepRe2 = /\/\*\s*===\s*Step\s*(\d+)\s*[:：]\s*([\s\S]*?)===\s*\*\/\s*([\s\S]*?)(?=\/\*\s*===\s*Step\s*\d|$)/gi;
        while ((m = stepRe2.exec(aiText)) !== null) {
          var sn = parseInt(m[1], 10);
          var raw = cleanCode(m[3].trim());
          // 去掉可能的 ``` 包裹
          raw = raw.replace(/^```[a-z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
          // ⚠️截断多余内容：AI可能在Step代码后又输出了条目JSON、脚本、<statusblock>等
          raw = truncateAtExtraContent(raw);
          if (sn >= 2 && sn <= 7 && raw.length > 10 && validateStepContent(sn, raw)) {
            // ⚠️严格单模块限制：如果本次已经提取到一个有效Step（无论来自stepRe还是stepRe2），跳过后续的
            if (stepsFoundInThisRound.length >= 1) {
              if (stepsFoundInThisRound.indexOf(sn) < 0) {
                console.warn('[statusbar] ⚠️AI一次输出了多个Step代码块，仅提取第一个(Step ' + stepsFoundInThisRound[0] + ')，忽略Step ' + sn);
              }
              continue;
            }
            // 仅当前Step还没有被stepRe的代码块匹配时，才用fallback填充（代码块版优先级更高）
            if (!statusBarModules['step' + sn]) {
              statusBarModules['step' + sn] = raw;
              stepsFoundInThisRound.push(sn);
              foundAny = true;
            }
          }
        }
        if (!foundAny) return false;

        // ⚠️完整性校验：只有6个模块全部就绪才拼接保存到角色卡
        // 缺任何一个模块都不保存，避免生成残缺不可用的状态栏
        // 修改时：旧状态栏保持不变，直到新模块全部收集完毕才覆盖
        var allComplete = !!(statusBarModules.step2 && statusBarModules.step3 &&
                             statusBarModules.step4 && statusBarModules.step5 &&
                             statusBarModules.step6 && statusBarModules.step7);
        if (!allComplete) {
          // 模块尚未收集完整，不拼接保存，仅返回true表示有提取到模块
          return true;
        }

        var assembledHtml = assembleStatusBarFromModules();
        if (!assembledHtml) return false;

        // 保存到 cardData.extensions.regex_scripts
        cardData.extensions = cardData.extensions || {};
        var rxList = cardData.extensions.regex_scripts || [];
        var foundIdx = -1;
        for (var j = 0; j < rxList.length; j++) {
          var r = rxList[j];
          // 匹配 StatusPlaceHolder（兼容 Impl 后缀和不带 Impl 的版本）
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
            foundIdx = j;
            break;
          }
        }
        var wrappedHtml = '```html\n' + assembledHtml + '\n```';
        if (foundIdx >= 0) {
          rxList[foundIdx].replaceString = wrappedHtml;
          rxList[foundIdx].findRegex = '/<StatusPlaceHolderImpl\\/>/g';
          rxList[foundIdx].markdownOnly = true;
          rxList[foundIdx].promptOnly = false;
          rxList[foundIdx].placement = [2];
          rxList[foundIdx].runOnEdit = true;
          rxList[foundIdx].disabled = false;
          rxList[foundIdx].id = 'mvu-status-bar';
          rxList[foundIdx].scriptName = '[美化]MVU状态栏';
        } else {
          rxList.push({
            id: 'mvu-status-bar',
            scriptName: '[美化]MVU状态栏',
            findRegex: '/<StatusPlaceHolderImpl\\/>/g',
            replaceString: wrappedHtml,
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null
          });
        }
        cardData.extensions.regex_scripts = rxList;
        return true;
      }

      // JSON 修复：用状态机遍历，只对"键位置"的裸标识符补引号，
      // 避免破坏字符串值内部的 word: 模式（如 "Time: 远古"）
      function repairJSON(str) {
        if (!str) return null;
        // 1) 先尝试直接解析
        try { return JSON.parse(str); } catch(e) {}
        // 2) 反转义多余转义、修复尾逗号
        var s = str
          .replace(/\\\\n/g, '\\n')
          .replace(/\\\\r/g, '\\r')
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        try { return JSON.parse(s); } catch(e) {}
        // 3) 状态机：单引号字符串转双引号 + 裸键补引号（不触碰字符串内部）
        var out = [];
        var i = 0;
        var len = s.length;
        // state: 0=期望键或值, 1=字符串内, 2=键已结束待冒号, 3=值已结束待逗号/括号
        var afterColon = false; // 上一非空白token是否是冒号（值上下文）
        while (i < len) {
          var ch = s[i];
          if (ch === '"') {
            // 双引号字符串：原样复制到匹配的结束引号（处理转义）
            out.push(ch);
            i++;
            while (i < len) {
              var c = s[i];
              out.push(c);
              if (c === '\\' && i + 1 < len) { out.push(s[i+1]); i += 2; continue; }
              i++;
              if (c === '"') break;
            }
            afterColon = false;
            continue;
          }
          if (ch === "'") {
            // 单引号字符串：转成双引号
            out.push('"');
            i++;
            while (i < len) {
              var c2 = s[i];
              if (c2 === '\\' && i + 1 < len) {
                // 转义字符原样保留
                out.push(c2, s[i+1]);
                i += 2;
                continue;
              }
              if (c2 === "'") { out.push('"'); i++; break; }
              if (c2 === '"') { out.push('\\'); } // 字符串内的双引号需转义
              out.push(c2);
              i++;
            }
            afterColon = false;
            continue;
          }
          // 裸键检测：在键上下文（非值，紧跟标识符 + 冒号）
          if (!afterColon && /[a-zA-Z_$]/.test(ch)) {
            var j = i;
            while (j < len && /[a-zA-Z0-9_$]/.test(s[j])) j++;
            // 跳过空白看是否跟冒号
            var k = j;
            while (k < len && /\s/.test(s[k])) k++;
            if (k < len && s[k] === ':') {
              // 是裸键，补引号
              out.push('"', s.substring(i, j), '"');
              i = j;
              continue;
            }
          }
          if (ch === ':') afterColon = true;
          else if (ch === ',' || ch === '{' || ch === '[') afterColon = false;
          else if (ch === '}' || ch === ']') afterColon = false;
          out.push(ch);
          i++;
        }
        var repaired = out.join('');
        try { return JSON.parse(repaired); } catch(e) { return null; }
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
              // 传递 returnLog 选项以便获取精确的变更统计（新增/删除/更新数量）
              var mergeResult = mergePartial(parsed, cardData, { returnLog: true });
              var actuallyModified = false;
              var changeLogResult = null;
              if (typeof mergeResult === 'object' && mergeResult !== null) {
                actuallyModified = !!mergeResult.modified;
                changeLogResult = mergeResult.log || null;
              } else {
                actuallyModified = !!mergeResult;
              }
              if (actuallyModified) {
                if (cardData.name && (cardData.description || (cardData.character_book && cardData.character_book.entries && cardData.character_book.entries.length > 0))) {
                  cardGenerated = true;
                }
                progress = calcProgress();
                // 显示变更统计 Toast，让用户明确知道AI确实执行了删改而不是瞎加
                try {
                  if (changeLogResult) {
                    var cr = changeLogResult;
                    var parts = [];
                    if (cr.added) parts.push('➕新增' + cr.added + '条');
                    if (cr.updated) parts.push('🔄更新' + cr.updated + '条');
                    if (cr.deleted) parts.push('🗑️删除' + cr.deleted + '条');
                    if (cr.fieldUpdates) parts.push('📝字段' + cr.fieldUpdates + '项');
                    if (parts.length) showToast('✅ 已应用修改：' + parts.join('，'), 'success');
                  }
                } catch(e) { /* ignore */ }
              } else if (hasData) {
                // AI输出了JSON但实际上没修改到任何东西（可能comment不匹配导致只加不删没生效）
                // 提示用户可能需要调整comment
                showToast('⚠️ AI返回了修改指令，但未匹配到任何条目（可能comment不精确）。请让AI使用精确comment或在JSON中加_action:delete明确删除', 'warning', 6000);
              }
            }
          }
          // lastUserInput 兜底逻辑：仅在用户明确要求修改开场白时才强制写入 first_mes
          // 修复：之前用 indexOf('开场白') 太脆弱，"别动开场白"也会触发
          // 现在改为：只在 parsed 中有 first_mes 且 mergePartial 没成功写入时才兜底
          // 且不再依赖 lastUserInput 关键词匹配（mergePartial 已能处理 first_mes 更新）
          if (parsed && parsed.first_mes && typeof parsed.first_mes === 'string' && parsed.first_mes.trim().length > 50) {
            // 仅当 mergePartial 没修改到 first_mes 时，才用这段兜底赋值
            if (cardData.first_mes !== parsed.first_mes.trim()) {
              // 额外检查：用户当前输入确实是在讨论开场白（正向意图，非否定语境）
              if (lastUserInput) {
                var hasOpening = lastUserInput.indexOf('开场白') >= 0 || lastUserInput.indexOf('first_mes') >= 0 || lastUserInput.indexOf('opening') >= 0 || lastUserInput.indexOf('开局') >= 0;
                var isNegation = /别动|不要|不用|别改|保持|取消|撤销|删除开场/.test(lastUserInput);
                if (hasOpening && !isNegation) {
                  cardData.first_mes = parsed.first_mes.trim();
                  progress = calcProgress();
                }
              }
            }
          }
          // 状态栏模块提取+自动拼接（优先）+ 完整HTML兜底（次选）
          try {
            // 步骤0：检测清空标记 —— AI修改模块前先清空需要重新生成的模块
            var clearedSteps = processClearStatusModules(aiResponse);
            if (clearedSteps && clearedSteps.length) {
              var clearedNames = clearedSteps.map(function(n) {
                var names = {2:'配色方案',3:'HTML骨架',4:'CSS样式',5:'变量读取',6:'渲染函数',7:'事件绑定+入口'};
                return 'Step ' + n + ':' + names[n];
              });
              addAssistantMsg('🗑️ 已清空模块：' + clearedNames.join('、') + '\n' +
                '  这些模块需要重新生成。请对AI说"继续"逐个生成。');
            }

            // 优先：尝试从AI回答中提取各Step模块代码
            // ⚠️AI只读取最新回答中的模块，如果模块重复直接替换
            var modulesAssembled = tryExtractAndAssembleStatusBar(aiResponse);
            if (modulesAssembled) {
              // 检测AI是否一次输出了多个Step代码块（违规）
              var multiStepMatches = aiResponse.match(/\/\*\s*===\s*Step\s*\d\s*[:：]/gi) || [];
              if (multiStepMatches.length > 1) {
                addAssistantMsg('⚠️ 检测到AI一次输出了 ' + multiStepMatches.length + ' 个Step代码块（违反单模块规则）。\n' +
                  '  写卡器仅提取了第一个有效模块，其余已被忽略。\n' +
                  '  💡 这是正常的安全机制，无需担心。如需生成其他模块，请对AI说"继续"。');
              }
              // 检测AI是否在Step代码块外还输出了其他多余代码块（条目JSON、脚本、statusblock等）
              var extraCodeBlocks = [];
              if (/<statusblock>/i.test(aiResponse)) extraCodeBlocks.push('<statusblock>进度块');
              if (/```json/i.test(aiResponse)) extraCodeBlocks.push('JSON代码块');
              if (/```yaml/i.test(aiResponse)) extraCodeBlocks.push('YAML代码块');
              // 统计 ``` 代码块总数，超过1个说明有多余代码块
              var fenceCount = (aiResponse.match(/```/g) || []).length / 2;
              if (fenceCount > 1) extraCodeBlocks.push('多余的代码块(' + (fenceCount - 1) + '个)');
              if (extraCodeBlocks.length > 0) {
                addAssistantMsg('⚠️ 检测到AI在Step代码块外还输出了：' + extraCodeBlocks.join('、') + '\n' +
                  '  写卡器已自动截断这些多余内容，仅保留当前Step的代码。\n' +
                  '  💡 提醒AI：生成模块时禁止输出其他代码块，补充说明用纯文字写。');
              }
              // 显示收集进度
              var stepNames = { step2: '配色方案', step3: 'HTML骨架', step4: 'CSS样式', step5: '变量读取', step6: '渲染函数', step7: '事件绑定+入口' };
              var collected = [];
              var missing = [];
              for (var sk in stepNames) {
                if (statusBarModules[sk]) collected.push(stepNames[sk]);
                else missing.push(stepNames[sk]);
              }
              var progressBar = '';
              for (var pk in stepNames) {
                progressBar += statusBarModules[pk] ? '✅' : '⬜';
              }
              showToast('✅ 状态栏模块收集 ' + collected.length + '/6 ' + progressBar, 'success');
              progress = calcProgress();
              renderPreview();

              // ⚠️完整性判断：6个模块全部齐全才拼接保存到角色卡
              var allComplete = !!(statusBarModules.step2 && statusBarModules.step3 &&
                                   statusBarModules.step4 && statusBarModules.step5 &&
                                   statusBarModules.step6 && statusBarModules.step7);
              if (!allComplete) {
                // 模块不完整：提示还缺什么，不保存到角色卡
                var stepOrder = ['step2', 'step3', 'step4', 'step5', 'step6', 'step7'];
                var nextStepName = null;
                var nextStepNum = 0;
                for (var si = 0; si < stepOrder.length; si++) {
                  if (!statusBarModules[stepOrder[si]]) {
                    nextStepName = stepNames[stepOrder[si]];
                    nextStepNum = si + 2;
                    break;
                  }
                }
                addAssistantMsg('📦 状态栏模块收集进度 ' + progressBar + '（' + collected.length + '/6）\n' +
                  '  ✅ 已收集：' + (collected.length ? collected.join('、') : '无') + '\n' +
                  '  ⬜ 还缺：' + (missing.length ? missing.join('、') : '无') + '\n' +
                  '  ⏭️ 下一步：请生成 Step ' + nextStepNum + ': ' + nextStepName + '（对我说"继续"即可）\n' +
                  '  ⚠️ 6个模块全部完成后才会拼接保存到角色卡，确保状态栏完整可用。\n' +
                  '  💡 生成前请与已收集的模块对照确保一致。');
              } else {
                // 6个模块全部齐全：拼接保存到角色卡
                addAssistantMsg('🎉 状态栏全部6个模块已收集完成！\n' +
                  '  ✅ ' + collected.join(' · ') + '\n' +
                  '  ✅ 写卡器已自动拼接保存完整HTML到角色卡，可点「🔍 预览状态栏」查看最终效果。');
              }
            } else if (!clearedSteps) {
              // 没有提取到模块，也没有清空操作 → 尝试兜底完整HTML提取
              var statusBarSaved = tryExtractStatusBarHtml(aiResponse);
              if (statusBarSaved) {
                showToast('✅ 已从AI回答中提取状态栏HTML并保存', 'success');
                progress = calcProgress();
                renderPreview();
              }
            }
          } catch(e) { /* ignore */ }

          // 检测AI发出的 <preview_statusbar> 命令，自动在聊天中渲染已收集的状态栏
          if (aiResponse && aiResponse.indexOf('<preview_statusbar>') >= 0) {
            var previewHtml = assembleStatusBarFromModules();
            if (previewHtml && previewHtml.length > 50) {
              addAssistantMsg('🎛️ 当前已收集的状态栏预览：\n```html\n' + previewHtml + '\n```');
            } else {
              addAssistantMsg('⚠️ 暂无足够的状态栏模块可预览。已收集的模块还不足以拼接出完整状态栏，请继续生成缺失的模块。');
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
              '动态适配': 'dynamic_adapt',
              '初始变量': 'init_var',
              '变量更新规则': 'var_update_rule'
            };
            // 仅当 AI 回复中确实识别到模块状态符号时才更新，
            // 否则 parseModProgress 返回全 0 会清空真实进度
            var hasAnySignal = Object.keys(modProg).some(function(k) { return modProg[k] > 0; });
            if (hasAnySignal) {
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
              // 合并而非覆盖：仅更新 AI 明确给出的模块，保留其余模块的原有进度
              Object.keys(modProg).forEach(function(k) {
                if (modProg[k] > 0) moduleProgress[k] = modProg[k];
              });
            }
          }
          // 对话框显示：用原始 aiResponse（保留JSON代码块和statusblock让用户看到完整输出）
          // 历史存储：用清理后的文本（去掉JSON块和statusblock HTML，节省token防止历史膨胀）
          var rawContent = aiResponse;
          var cleanContent = aiResponse
            .replace(/```[\s\S]*?```/g, '')
            .replace(/<details[\s\S]*?<\/details>/gi, '')
            .trim();

          // 1. 先显示完整内容到对话框（用户需要看到JSON和statusblock）
          try { appendMsg('assistant', rawContent); } catch(e) { console.warn('appendMsg error:', e); }

          // 2. 再存储清理后的对话文本到历史
          if (cleanContent && cleanContent.length > 5) {
            messages.push({ role: 'assistant', content: cleanContent });
          } else {
            // 清理后太短说明AI只输出了JSON没有自然对话，用简短摘要
            messages.push({ role: 'assistant', content: '（已应用修改，详见上方变更提示）' });
          }
          saveToStorage();
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
            '请立即生成完整的角色卡数据，补齐所有缺失的核心字段。使用chara_card_v3格式，输出到```json代码块中。\n\n' +
            '=== 必须达到的字段标准 ===\n' +
            '- name：简洁有力的世界/角色名称（≤15字）\n' +
            '- description：≥400字，覆盖世界核心设定、地理、历史、文化、社会结构\n' +
            '- first_mes：500-800字，结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩\n' +
            '- system_prompt：≤50字，仅AI身份定位一句话\n' +
            '- post_history_instructions：≤100字，分号分隔的核心铁则（最高权重位）\n' +
            '- personality/scenario：必须留空（世界模式规范）\n' +
            '- tags：2-12个精准标签\n' +
            '- mes_example：1-2组对话示例（Few-shot）\n' +
            '- alternate_greetings：≥3个差异化备用开局\n' +
            '- extensions.depth_prompt：新手引导（depth=0）\n' +
            '- extensions.regex_scripts：3-5条状态同步正则\n' +
            '- character_book.entries：≥12条，覆盖八大体系（<基础公理><交互软规则><核心铁则><近场强约束><场景机制><实体交互><叙事背景><动态系统>），每条content≥250字\n' +
            '- 已有条目用相同comment覆盖，缺失的补充新条目\n\n' +
            '=== 已有内容（参考，不要丢失） ===\n' +
            (cardData.name ? '- 名称：' + cardData.name + '\n' : '') +
            (cardData.description ? '- 描述(' + (cardData.description||'').length + '字)：' + (cardData.description||'').substring(0, 300) + '\n' : '') +
            '- 条目数：' + (((cardData.character_book || {}).entries || []).length) + '条\n' +
            (cardData.tags && cardData.tags.length ? '- 标签：' + cardData.tags.join(',') : '') +
            '\n=== 输出要求 ===\n只输出一个完整的```json代码块，包含完整角色卡数据（spec/data/character_book结构）。';
          var aiResponse = await callAI(genPrompt);
          removeTyping();
          var parsed = extractJSON(aiResponse);
          if (parsed) {
            try {
              var genMergeOk = false;
              if (parsed.spec === 'chara_card_v3' && parsed.data) {
                // v3 格式：解包 data 字段后走 mergePartial，保证模板默认值和 keys 保留逻辑生效
                var rV3 = mergePartial(parsed.data, cardData, { returnLog: true });
                genMergeOk = !!(typeof rV3 === 'object' ? rV3.modified : rV3);
              } else {
                var rPlain = mergePartial(parsed, cardData, { returnLog: true });
                genMergeOk = !!(typeof rPlain === 'object' ? rPlain.modified : rPlain);
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
            // 兜底：JSON解析失败时，尝试从 ```html 代码块提取状态栏HTML
            try {
              var sbSaved = tryExtractStatusBarHtml(aiResponse);
              if (sbSaved) {
                showToast('✅ 已从AI回答中提取状态栏HTML并保存', 'success');
                renderPreview();
                addAssistantMsg('✅ 已从AI回答中提取状态栏HTML并保存。点击「🔍 预览状态栏」查看效果。');
              } else {
                addAssistantMsg('⚠️ 未找到JSON格式，可能需要再补充一些信息。\n\nAI返回前300字：\n' + aiResponse.substring(0, 300));
              }
            } catch(e) {
              addAssistantMsg('⚠️ 未找到JSON格式，可能需要再补充一些信息。\n\nAI返回前300字：\n' + aiResponse.substring(0, 300));
            }
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
        var saveBtn = doc.getElementById('saveBtn');
        var input = doc.getElementById('chatInput');
        if (sendBtn) sendBtn.disabled = !enabled;
        if (saveBtn) saveBtn.disabled = !enabled;
        if (input) { input.disabled = !enabled; if (enabled) { try { input.focus(); } catch(e){} } }
        // 发送按钮图标切换：生成中显示等待（转圈）图标，空闲显示发送图标
        if (sendBtn) {
          var sendIcon = sendBtn.querySelector('.send-icon');
          var sendSpin = sendBtn.querySelector('.send-spinner');
          var waiting = !enabled;
          if (sendIcon) sendIcon.style.display = waiting ? 'none' : '';
          if (sendSpin) sendSpin.style.display = waiting ? '' : 'none';
        }
        // 快捷按钮、模块聚焦按钮、仪表盘条目统一禁用/启用，避免生成中误触
        var sels = ['.quick-btn', '.mod-focus-btn', '.mod-dash-item', '.md-analyze-btn'];
        for (var s = 0; s < sels.length; s++) {
          var nodes = doc.querySelectorAll(sels[s]);
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].disabled = !enabled;
            nodes[i].style.pointerEvents = enabled ? '' : 'none';
            nodes[i].style.opacity = enabled ? '' : '0.5';
          }
        }
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
          dynamic_adapt: ['动态适配', '引导机制', '互动选项', '状态栏'],
          init_var: ['[InitVar]', '初始变量', 'InitVar', '变量列表'],
          var_update_rule: ['变量更新规则', '变量输出格式', 'UpdateVariable', 'status_current_variable']
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
        var coreResults = results.filter(function(r) { return r.category !== '附加检查' && r.category !== 'MVU变量系统'; });
        var corePass = coreResults.filter(function(r) { return r.pass; }).length;
        var mvuResults = results.filter(function(r) { return r.category === 'MVU变量系统'; });
        var mvuPass = mvuResults.filter(function(r) { return r.pass; }).length;
        var h = '<div class="modal" id="qcModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#8a6d3b;margin-bottom:4px;font-size:1em">✅ 角色卡质检报告（' + coreResults.length + '项核心 + ' + mvuResults.length + '项MVU + ' + (results.length - coreResults.length - mvuResults.length) + '项附加）</h3>' +
            '<p style="font-size:.78em;color:#8c8472;margin-bottom:8px">核心 ' + corePass + '/' + coreResults.length + ' 项达标' + (mvuResults.length > 0 ? ' · MVU ' + mvuPass + '/' + mvuResults.length + ' 项达标' : '') + ' · 全部 ' + passCount + '/' + results.length + ' 项达标</p>' +
            '<div class="progress-bar"><div class="progress-bar-fill" style="width:' + Math.round(corePass/coreResults.length*100) + '%"></div></div>' +
            '<div class="modal-body" style="margin-top:10px">';
        var categories = ['基础字段', '高价值字段', '世界书', '世界书高级', '正则脚本', '运行效果', 'MVU变量系统', '附加检查'];
        var catColors = { '基础字段': '#8a6d3b', '高价值字段': '#b89968', '世界书': '#8ba888', '世界书高级': '#9b7fb0', '正则脚本': '#cf9f5e', '运行效果': '#cf9f5e', 'MVU变量系统': '#7fa8c9', '附加检查': '#8c8472' };
        categories.forEach(function(cat) {
          var catResults = results.filter(function(r) { return r.category === cat; });
          if (catResults.length === 0) return;
          var catPass = catResults.filter(function(r) { return r.pass; }).length;
          h += '<div style="margin:8px 0 4px;font-size:.75em;font-weight:600;color:' + (catColors[cat] || '#8c8472') + ';border-bottom:1px solid #efe9dc;padding-bottom:3px">' + cat + '（' + catPass + '/' + catResults.length + '）</div>';
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
            var failedItems = results.filter(function(r) { return !r.pass; });
            var failedNames = failedItems.map(function(r) { return r.name; });
            var optInstructions = buildOptimizeInstructions(failedItems);
            showOptimizeModal(failedNames.join('、'), optInstructions);
          });
        }
      }

      // ===== MVU状态栏预览（仅当用户已配置MVU变量系统时可用）=====
      // 用 iframe srcdoc 沙箱渲染状态栏HTML，内部 mock 酒馆运行时API
      // 数据源：从 [InitVar]初始变量 世界书条目解析YAML作为 stat_data
      // HTML源：优先用AI生成的正则6 replaceString，回退用 MVU_STATUS_BAR_HTML 默认模板
      function showMvuStatusBarPreview() {
        var entries = (cardData.character_book || {}).entries || [];
        /* 前置检查：必须存在MVU条目 */
        var hasMVU = entries.some(function(e) { return isMVUEntry(e.comment || ''); });
        if (!hasMVU) {
          showToast('请先配置MVU变量系统（[InitVar]初始变量等条目）后再使用状态栏预览', 'warning');
          return;
        }
        /* 读取 [InitVar] 初始变量 YAML 作为预览假数据 */
        var initVarEntry = null;
        for (var i = 0; i < entries.length; i++) {
          if ((entries[i].comment || '').toLowerCase().indexOf('[initvar]') >= 0) {
            initVarEntry = entries[i];
            break;
          }
        }
        var statData = {};
        var initVarContent = '';
        var usingSampleData = false;
        if (initVarEntry && initVarEntry.content) {
          initVarContent = initVarEntry.content;
          var parsed = parseInitVar(initVarContent);
          if (parsed) statData = parsed;
        }
        /* 若 InitVar 为空或解析失败，使用示例数据让预览仍有内容可渲染 */
        if (!statData || Object.keys(statData).length === 0) {
          statData = {
            '世界': { '当前时间': 'D1 第一天 清晨', '当前地点': '初始之地', '_当前回合': 1, '_当前剧情日': 1 },
            '主角': { '好感度': 35, '状态': '进行中', '物品栏': { '薄荷糖': { '描述': '提神用薄荷糖', '数量': 2 } } }
          };
          usingSampleData = true;
        }
        /* 读取状态栏HTML：优先AI生成的正则6，回退默认模板 */
        var statusBarHtml = MVU_STATUS_BAR_HTML;
        var statusBarSource = '默认模板';
        var regexScripts = cardData.extensions && cardData.extensions.regex_scripts || [];
        for (var j = 0; j < regexScripts.length; j++) {
          var r = regexScripts[j];
          /* 匹配 StatusPlaceHolder（兼容带Impl和不带Impl的版本） */
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) {
            var rep = r.replaceString || '';
            /* 去掉 ```html ... ``` 包裹 */
            var m = rep.match(/```html\s*\n([\s\S]*?)\n```/);
            if (m) {
              statusBarHtml = m[1];
              statusBarSource = 'AI生成正则';
            } else if (rep.indexOf('<!doctype html') >= 0 || rep.indexOf('<html') >= 0) {
              statusBarHtml = rep;
              statusBarSource = 'AI生成正则';
            }
            break;
          }
        }
        /* ====== HTML 鲁棒性包装：如果 AI 生成的只是 <body> 片段或独立片段，自动补全为完整 HTML 文档 ====== */
        (function() {
          var hasDocType = /<!doctype\s/i.test(statusBarHtml);
          var hasHtmlTag = /<html[\s>]/i.test(statusBarHtml);
          var hasHeadTag = /<head[\s>]/i.test(statusBarHtml);
          var hasBodyTag = /<body[\s>]/i.test(statusBarHtml);
          /* 默认模板本身是完整的，不用包；AI 生成的片段没 doctype/head/body 时需要包 */
          if (!hasDocType && !hasHtmlTag) {
            statusBarHtml = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>MVU StatusBar</title>\n</head>\n<body>\n' + statusBarHtml + '\n</body>\n</html>';
            statusBarSource += '（已补全HTML骨架）';
          } else if (hasHtmlTag && !hasHeadTag) {
            /* 有 <html> 但缺 <head>：插入空 head 标签供 mock 注入 */
            statusBarHtml = statusBarHtml.replace(/<html([^>]*)>/i, '<html$1>\n<head></head>');
          }
          /* 如果最终仍缺 render-root，自动补一个（放在 body 开头），否则渲染没地方写 */
          if (statusBarHtml.indexOf('id="render-root"') < 0 && statusBarHtml.indexOf("id='render-root'") < 0) {
            if (/<body([^>]*)>/i.test(statusBarHtml)) {
              statusBarHtml = statusBarHtml.replace(/(<body[^>]*>)/i,
                '$1\n<div class="mvu-status-card"><div class="card-body" id="render-root"><div class="loading-state">正在加载状态数据...</div></div></div>');
              statusBarSource += '（已补render-root）';
            }
          }
        })();
        /* 构建预览弹窗：顶部说明+数据来源标识，主体为iframe沙箱渲染 */
        var h = '<div class="modal" id="mvuPreviewModal">' +
          '<div class="modal-content" style="max-width:720px">' +
            '<h3 style="color:#8a6d3b;margin-bottom:8px;font-size:1em">🎛️ MVU状态栏预览</h3>' +
            /* 顶部只有标题，然后直接是iframe渲染区，不显示任何变量信息 */
            '';
        /* InitVar 缺失提示仅用于控制台日志，不在界面显示 */
        if (!initVarEntry) {
          console.warn('[预览] 未找到 [InitVar]初始变量 条目，使用示例数据');
        } else if (usingSampleData) {
          console.warn('[预览] [InitVar] 条目内容为空或格式异常，使用示例数据');
        }
        h += '<div style="background:#fffdf8;border:1px solid #e6dfd0;border-radius:8px;overflow:hidden;margin-bottom:8px">' +
          '<iframe id="mvuPreviewFrame" style="width:100%;height:420px;border:0;background:transparent" sandbox="allow-scripts"></iframe>' +
          '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-ghost" id="mvuPreviewCloseBtn">关闭</button>' +
          '</div>' +
        '</div></div>';
        var tmp = doc.createElement('div');
        tmp.innerHTML = h;
        var modalEl = tmp.firstElementChild;
        doc.body.appendChild(modalEl);
        /* 注入 iframe 内容：在状态栏HTML前注入 mock API + 轻量级jquery/lodash子集 */
        var frame = doc.getElementById('mvuPreviewFrame');
        function loadFrame() {
          var mockScript = buildPreviewMockScript(statData);
          var fullDoc = statusBarHtml;
          /* ======【插入位置：将 mock 脚本放在 <head> 的最开始，保证 mock API 先于状态栏原有 script 执行 ======
             （相比插在 </head> 前，这样即使原状态栏用了 defer/module 也能拿到 $、_、getAllVariables） */
          var headStartMatch = fullDoc.match(/<head[^>]*>/i);
          if (headStartMatch) {
            /* 插入到 <head ...> 标签紧后面（紧跟 headStartMatch[0] 的后面）
               同时把默认模板的 <style> 保留（否则 mock 脚本在 style 前也没关系，因为 script 是顺序执行的，style 仍会生效 */
            var idx = fullDoc.indexOf(headStartMatch[0]);
            fullDoc = fullDoc.substring(0, idx + headStartMatch[0].length)
              + '\n' + mockScript + '\n'
              + fullDoc.substring(idx + headStartMatch[0].length);
          } else if (fullDoc.indexOf('<body') >= 0) {
            fullDoc = fullDoc.replace(/<body/i, mockScript + '<body');
          } else {
            fullDoc = mockScript + fullDoc;
          }
          /* ✅ 修复：不要在最后把所有 </script> 替换成 <\\/script>！
             - </script> 作为 HTML 闭合标签是合法且必须的（脚本 tag 需要正常闭合）
             - 只有在 <script> 标签 *文本内容内部* 出现 </script> 才会截断
             - 已在 statDataJson 阶段单独转义：JSON.stringify(statData).replace(/<\/script/gi, '<\\/script')
             - 这里再次全量替换会把 </script> tag 本身变成非法的 \</script>，让浏览器无法解析，导致整页空白！ */
          frame.srcdoc = fullDoc;
        }
        loadFrame();
        /* 关闭逻辑 */
        modalEl.addEventListener('click', function(e) { if (e.target === modalEl) modalEl.remove(); });
        doc.getElementById('mvuPreviewCloseBtn').addEventListener('click', function() { modalEl.remove(); });
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
            '<h3 style="color:#8a6d3b;margin-bottom:4px;font-size:1em">📊 权重可视化预览</h3>' +
            '<p style="font-size:.72em;color:#8c8472;margin-bottom:8px">展示每个条目的权重等级、触发逻辑、Token占用（对齐ST注入权重层级）</p>' +
            '<div class="wv-summary">' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#8ba888">' + entries.length + '</span><span class="wv-stat-lbl">条目总数</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#c98b7a">' + permToken + '</span><span class="wv-stat-lbl">常驻Token</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#8a6d3b">' + trigToken + '</span><span class="wv-stat-lbl">触发Token</span></div>' +
              '<div class="wv-stat"><span class="wv-stat-val" style="color:#cf9f5e">' + totalToken + '</span><span class="wv-stat-lbl">总Token</span></div>' +
            '</div>' +
            '<div class="wv-legend">';
        var legendItems = [
          { level: '最高', color: '#c98b7a', desc: 'post_history/铁则' },
          { level: '极高', color: '#c98b7a', desc: 'position=2/状态栏' },
          { level: '中高', color: '#cf9f5e', desc: 'position=4 触发' },
          { level: '中', color: '#8ba888', desc: '概率触发/动态' },
          { level: '低', color: '#8c8472', desc: 'position=1 常驻' },
          { level: '极低', color: '#b3aa98', desc: 'position=0 常驻' }
        ];
        legendItems.forEach(function(l) {
          h += '<span class="wv-legend-item"><span class="wv-legend-dot" style="background:' + l.color + '"></span>' + l.level + '(' + l.desc + ')</span>';
        });
        h += '</div>' +
            '<div class="modal-body">';

        // 按分组展示
        var groupOrder = ['常驻体系', '触发体系', '叙事', '动态系统', '自定义'];
        var groupColors = { '常驻体系': '#8ba888', '触发体系': '#8a6d3b', '叙事': '#cf9f5e', '动态系统': '#b89968', '自定义': '#8c8472' };
        groupOrder.forEach(function(g) {
          var groupEntries = entries.filter(function(e) {
            var eg = getDisplayGroup(e);
            return eg === g;
          });
          if (groupEntries.length === 0) return;
          var groupTok = 0;
          groupEntries.forEach(function(e) { groupTok += countTokens(e.content || ''); });
          h += '<div class="wv-group-header"><span style="color:' + (groupColors[g] || '#8c8472') + '">' + g + '</span><span class="wv-group-count">' + groupEntries.length + '条 · ' + groupTok + 'T</span></div>';
          // 按权重排序（order越大权重越低，先展示高权重=order小）
          groupEntries.sort(function(a, b) { return (a.insertion_order || 100) - (b.insertion_order || 100); });
          groupEntries.forEach(function(e, idx) {
            var comment = e.comment || ('条目' + (idx + 1));
            var m = comment.match(/^<([^>]+)>/);
            var prefixKey = m ? m[1] : '';
            var wl = WEIGHT_LEVELS[prefixKey] || { level: '中', color: '#8ba888', desc: '自定义' };
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
                '<span class="wv-tag" style="color:#b3aa98" title="' + escHtml(wl.desc) + '">' + escHtml(wl.desc) + '</span>' +
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
        var groupColors = { '常驻体系': '#8ba888', '触发体系': '#8a6d3b', '叙事': '#cf9f5e', '动态系统': '#b89968', '自定义': '#8c8472' };
        var h = '<div class="modal" id="groupModal">' +
          '<div class="modal-content">' +
            '<h3 style="color:#8a6d3b;margin-bottom:4px;font-size:1em">🗂️ 分组管理</h3>' +
            '<p style="font-size:.72em;color:#8c8472;margin-bottom:8px">每个体系对应一个世界书分组，支持批量开关（对齐ST分组管理功能）</p>' +
            '<div class="group-mgr-list">';
        Object.keys(groups).forEach(function(g) {
          var gEntries = groups[g];
          var gTok = 0;
          gEntries.forEach(function(e) { gTok += countTokens(e.content || ''); });
          var allEnabled = gEntries.every(function(e) { return e.enabled !== false; });
          h += '<div class="group-mgr-item">' +
            '<span class="gm-color" style="background:' + (groupColors[g] || '#8c8472') + '"></span>' +
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

      // ===== 优化指令映射（质检未达标项→AI优化指令） =====
      function buildOptimizeInstructions(failedItems) {
        // 每条指令统一为「问题 · 影响 · 修复」三段式，便于 AI 精准理解与执行
        // field 字段用于在弹窗中按字段分组展示，并驱动 AI 优化目标字段
        var instructionMap = {
          // === 基础字段 ===
          '世界/角色名称': { field: 'name', instr: '问题：世界/角色名称为空\n影响：无法识别卡片主体\n修复：设置一个简洁有力的世界名称（如「青云大陆」），不超过15字' },
          '世界观描述 ≥400字': { field: 'description', instr: '问题：世界观描述不足400字\n影响：世界背景单薄，AI缺乏设定锚点\n修复：补充到≥400字，覆盖世界核心设定、地理、历史、文化、社会结构，语言生动具体避免抽象' },
          '性格描述（世界模式留空）': { field: 'personality', instr: '问题：世界模式下 personality 非空\n影响：与世界观模式规范冲突，可能干扰AI\n修复：清空 personality 字段（世界模式人设由世界书条目承载）' },
          '场景设定（世界模式留空）': { field: 'scenario', instr: '问题：世界模式下 scenario 非空\n影响：与世界观模式规范冲突\n修复：清空 scenario 字段（场景由世界书触发条目动态提供）' },
          '开场白 ≥500字': { field: 'first_mes', instr: '问题：开场白不足500字\n影响：代入感弱，玩家难以进入情境\n修复：扩展到500-800字，结构：场景描写→动作驱动→内心独白→自然对话→结尾留钩。必须完整文本，禁止占位符' },
          '系统指令 ≤50字（仅AI身份定位）': { field: 'system_prompt', instr: '问题：system_prompt 过长或为空\n影响：挤占上下文，核心规则权重不足\n修复：精简到≤50字，仅保留AI身份定位一句话（如"你是某世界的叙事AI"）；核心规则迁移到 post_history_instructions' },
          '核心铁则 post_history_instructions ≤100字': { field: 'post_history_instructions', instr: '问题：post_history_instructions 未设或过长\n影响：缺少最高权重位的硬性约束，AI遵循度下降\n修复：设置≤100字的核心铁则，分号分隔短句（如"保持神秘；拒绝透露秘密；偶尔说谜语"）。这是权重最高的位置，遵循度是system_prompt的2倍以上' },
          '标签数量 2-12个': { field: 'tags', instr: '问题：标签数量不在2-12范围\n影响：分类与检索困难\n修复：设置2-12个简短标签，精准描述世界题材和风格（如"奇幻""中世纪""魔法"）' },
          // === 高价值字段 ===
          'mes_example 对话示例（Few-shot）': { field: 'mes_example', instr: '问题：缺少 mes_example 对话示例\n影响：AI缺少 Few-shot 示范，输出风格不稳定\n修复：生成1-2组对话示例，格式 <START>用户消息<END>\\n<START>助手消息<END>，展示NPC性格和对话风格' },
          'alternate_greetings 3个差异化开局': { field: 'alternate_greetings', instr: '问题：备用开局不足3个\n影响：重玩价值低\n修复：生成至少3个不同身份/难度/场景的备用开场白，每个500字左右' },
          'depth_prompt 新手引导（depth=0）': { field: 'depth_prompt', instr: '问题：缺少 depth_prompt 新手引导\n影响：新玩家不知道如何互动\n修复：生成 depth_prompt.prompt 新手引导内容，depth 默认0（对所有玩家生效）' },
          'regex_scripts 状态同步正则': { field: 'regex_scripts', instr: '问题：缺少 regex_scripts 正则脚本\n影响：无法实现状态格式化、数值高亮等动态效果\n修复：生成3-5条实用脚本，覆盖状态格式化、行动标签、数值高亮、表情转换' },
          // === 世界书基础 ===
          '条目数 12-30条': { field: 'entries', instr: '问题：世界书条目数不在12-30范围\n影响：覆盖不全或Token浪费\n修复：调整到12-30条，覆盖基础公理、核心铁则、近场约束、场景机制、实体交互、叙事背景、动态系统等模块' },
          '触发词覆盖率 ≥50%': { field: 'entries', instr: '问题：触发词覆盖率不足50%\n影响：触发条目无法被正确激活\n修复：为≥50%的条目设置精准 keys 触发词，避免泛用词（如"的""是"）' },
          '条目内容 ≥250字': { field: 'entries', instr: '问题：超过半数条目内容不足250字\n影响：信息密度低，触发后AI可参考内容不足\n修复：将≥50%的条目内容扩充到≥250字，提供完整自包含的信息' },
          '条目命名规范 ≥50%': { field: 'entries', instr: '问题：条目命名不规范\n影响：难以识别条目职能与权重层级\n修复：为≥50%的条目使用规范前缀：<基础公理>、<核心铁则>、<近场强约束>、<场景机制>、<实体交互>、<叙事背景>、<动态系统>；MVU条目用[InitVar]前缀' },
          '权重合理性：核心规则在高权重位': { field: 'entries', instr: '问题：核心规则未在高权重位\n影响：AI容易忽略核心规则\n修复：核心规则必须放在 post_history_instructions 或 <核心铁则> 条目（高权重位），近场约束放适当位置' },
          'content自包含性（无上下文依赖）': { field: 'entries', instr: '问题：条目content含上下文依赖词\n影响：条目单独触发时信息不完整\n修复：移除"如上所述""见上文""前文提到"等词，确保每条content都是完整独立的信息' },
          // === 世界书高级 ===
          '递归链条：delay_until_recursion': { field: 'entries', instr: '问题：未使用递归链条\n影响：无法实现"提到A自动带出A背景"\n修复：为叙事类条目开启 extensions.delay_until_recursion=true，实现关联触发' },
          '分组机制：group分组': { field: 'entries', instr: '问题：未使用group分组\n影响：场景变体/难度分层无法互斥\n修复：为场景变体/难度分层/时间分支设置 extensions.group 分组（同组仅注入1条实现互斥）' },
          '次级键过滤：secondary_keys + selectiveLogic': { field: 'entries', instr: '问题：未使用次级键过滤\n影响：复杂条件触发不精准\n修复：为复杂条件条目设置 secondary_keys 配合 extensions.selectiveLogic（0=AND_ANY,1=NOT_ALL,2=NOT_ANY,3=AND_ALL）' },
          '概率事件：probability < 100': { field: 'entries', instr: '问题：未使用概率触发\n影响：缺少随机性与惊喜感\n修复：为随机天气/彩蛋/遭遇条目设置 extensions.useProbability=true 且 extensions.probability<100' },
          '正则触发键': { field: 'entries', instr: '问题：未使用正则触发键\n影响：无法精确匹配说话者\n修复：为需要精确匹配的条目使用正则键，如 keys:["/^\\\\x01{{user}}:.*?/i"]' },
          '组评分 use_group_scoring': { field: 'entries', instr: '问题：未使用组评分\n影响：大分组匹配精准度不足\n修复：为大分组条目开启 extensions.use_group_scoring=true' },
          'sticky/cooldown冲突检查': { field: 'entries', instr: '问题：条目同时设置sticky和cooldown\n影响：逻辑冲突（sticky持续存在 vs cooldown间歇触发）\n修复：移除其中一个，按需保留单一机制' },
          'position配置合理性': { field: 'entries', instr: '问题：position配置有误\n影响：注入位置异常\n修复：constant条目 extensions.position≤1；position=6需配depth+role；position=7需配outlet_name' },
          // === 正则脚本 ===
          '脚本功能单一': { field: 'regex_scripts', instr: '问题：正则脚本功能混合\n影响：难以维护与调试\n修复：每个脚本只做一件事，复杂替换拆分成多个简单脚本' },
          '正则标志正确（g全局匹配）': { field: 'regex_scripts', instr: '问题：findRegex缺少g标志\n影响：只替换第一个匹配\n修复：findRegex 包含g标志（如/pattern/gi），中文场景加i' },
          '非贪婪匹配（.*?）': { field: 'regex_scripts', instr: '问题：使用贪婪匹配.*或.+\n影响：匹配过多内容\n修复：改用.*?或.+?非贪婪匹配' },
          'placement配置检查': { field: 'regex_scripts', instr: '问题：未设置placement\n影响：脚本不知在哪个位置执行\n修复：设置placement数组，[0]=用户输入、[1]=AI回复、[0,1]=两者都处理' },
          'substituteRegex范围（0-2）': { field: 'regex_scripts', instr: '问题：substituteRegex超出0-2范围\n影响：宏替换行为异常\n修复：设为0(不替换宏)/1(原始替换)/2(转义替换)，一般用1' },
          '状态栏脚本runOnEdit': { field: 'regex_scripts', instr: '问题：状态栏脚本未开启runOnEdit\n影响：编辑消息时状态栏不刷新\n修复：状态栏类脚本设置 runOnEdit=true' },
          // === 运行效果 ===
          '常驻Token总量 ≤500': { field: 'entries', instr: '问题：常驻Token总量超过500\n影响：挤占上下文预算，长对话记忆受损\n修复：将非核心内容从constant条目移到触发条目，控制常驻Token≤500' },
          '递归安全：实体类条目开启prevent_recursion': { field: 'entries', instr: '问题：实体类条目未开启prevent_recursion\n影响：链式触发导致Token爆炸\n修复：为<实体交互>、<重要角色>、<地点场景>等条目开启 extensions.prevent_recursion=true' },
          '冷却防抖：场景类条目开启cooldown': { field: 'entries', instr: '问题：场景类条目未设置cooldown\n影响：内容刷屏\n修复：为<场景机制>、<核心玩法>等条目设置 extensions.cooldown=3' },
          // === MVU变量系统 ===
          'MVU四大核心条目完整': { field: 'entries', instr: '问题：MVU四大核心条目不完整\n影响：变量系统无法正常运作\n修复：生成完整四件套——\n  1. [InitVar]初始变量：YAML格式定义所有变量初始值（缩进表示层级，如 白娅:\\n  依存度: 35）\n  2. 变量列表：固定内容 "---\\n<status_current_variable>\\n{{format_message_variable::stat_data}}\\n</status_current_variable>"\n  3. [mvu_update]变量更新规则：YAML格式，含 type/range/check 三字段\n  4. [mvu_update]变量输出格式：定义 <UpdateVariable> 输出格式，采用 JSON Patch 标准（replace/delta/insert/remove/move 操作）' },
          '[InitVar]条目enabled=false': { field: 'entries', instr: '问题：[InitVar]条目 enabled=true\n影响：MVU不会读取已开启的initvar条目，导致变量初始化失败\n修复：将 [InitVar] 条目的 enabled 改为 false（必须禁用，MVU只读取禁用的initvar条目进行初始化）' },
          '变量列表含format_message_variable宏': { field: 'entries', instr: '问题：变量列表条目缺少 {{format_message_variable::stat_data}} 宏\n影响：LLM无法读取当前变量值，变量更新无依据\n修复：变量列表条目内容必须包含宏，固定格式：\n  ---\\n<status_current_variable>\\n{{format_message_variable::stat_data}}\\n</status_current_variable>\n  注意：禁止写成 {{null}}、{{get_message_variable::stat_data}} 等变体' }
        };

        // 按字段分组，便于 AI 按字段批量处理
        var groups = {};
        failedItems.forEach(function(item) {
          var entry = instructionMap[item.name];
          if (!entry) return;
          if (!groups[entry.field]) groups[entry.field] = [];
          groups[entry.field].push({ name: item.name, instr: entry.instr });
        });

        // 输出结构化 Markdown，AI 可按字段定位与执行
        var lines = [];
        lines.push('# 待优化项清单（按字段分组）');
        lines.push('');
        lines.push('共 ' + failedItems.length + ' 项未达标，需优化字段：' + Object.keys(groups).join('、'));
        lines.push('');
        Object.keys(groups).forEach(function(field) {
          lines.push('## 字段：' + field);
          groups[field].forEach(function(item, idx) {
            lines.push('');
            lines.push('### ' + (idx + 1) + '. ' + item.name);
            lines.push(item.instr);
          });
          lines.push('');
        });
        lines.push('## 执行要求');
        lines.push('- 严格按上述"修复"方法执行，不要遗漏任何一项');
        lines.push('- 输出 JSON 代码块，只包含被优化的字段（entries/depth_prompt/regex_scripts 放顶层，不嵌套）');
        lines.push('- entries 优化时优先用相同 comment 覆盖现有条目，不足再新增');
        lines.push('- MVU 相关条目必须遵守：[InitVar] enabled=false，变量列表必须含 {{format_message_variable::stat_data}} 宏');
        return lines.join('\n');
      }

      // ===== 优化弹窗 =====
      var selectedOptFields = [];
      function showOptimizeModal(presetReq, optInstructions) {
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
            '<h3 style="color:#8a6d3b;margin-bottom:4px;font-size:1em">🔧 AI 角色卡优化</h3>' +
            '<p style="font-size:.78em;color:#8c8472;margin-bottom:8px">选择要优化的字段，AI将智能优化并展示对比</p>' +
            '<div class="opt-field-select">';
        fields.forEach(function(f) {
          h += '<span class="opt-field-tag" data-key="' + f.key + '">' + f.label + '</span>';
        });
        h += '</div>' +
            '<textarea class="chat-input" id="optCustom" placeholder="补充优化要求（可选），如：让开场白更有悬疑感、增加仙侠氛围..." rows="3" style="margin:6px 0;min-height:70px">' + (optInstructions || '') + (presetReq ? ('\n\n' + presetReq) : '') + '</textarea>' +
            '<div id="optProgress" style="display:none;text-align:center;padding:12px;color:#8a6d3b;font-size:.85em"><span class="typing" style="display:inline"><span>●</span><span>●</span><span>●</span></span> AI正在优化...</div>' +
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
          var optPrompt = '你是SillyTavern角色卡优化专家，熟悉chara_card_v3格式和世界书、正则脚本规范。请针对指定字段优化角色卡。\n\n' +
            '=== 任务目标 ===\n' +
            '只优化以下字段，其他字段保持不变：' + selectedOptFields.join(', ') + '\n\n' +
            (customReq ? '=== 用户额外要求 ===\n' + customReq + '\n\n' : '') +
            '=== 字段优化细则（必须严格遵守） ===\n' +
            '【description 世界观描述】\n' +
            '- 字数：≥400字\n' +
            '- 内容：包含世界核心设定、地理、历史、文化、社会结构等，提升沉浸感\n' +
            '- 语言：生动具体，避免抽象描述\n\n' +
            '【first_mes 开场白】\n' +
            '- 字数：500-800字\n' +
            '- 结构：场景描写 → 动作驱动 → 内心独白 → 自然对话 → 结尾留钩\n' +
            '- 必须包含完整文本，严禁使用占位符\n\n' +
            '【system_prompt 系统指令】\n' +
            '- 字数：≤50字\n' +
            '- 内容：仅AI身份定位（如"你是一个神秘的酒馆老板"）\n' +
            '- 核心规则必须放在post_history_instructions\n\n' +
            '【post_history_instructions 核心铁则】\n' +
            '- 字数：≤100字\n' +
            '- 内容：极度精简的核心规则，放在最高权重位置\n' +
            '- 格式：分号分隔的短句，如"保持神秘；拒绝透露秘密；偶尔说谜语"\n\n' +
            '【mes_example 对话示例】\n' +
            '- 数量：1-2组\n' +
            '- 格式：<START>用户消息<END>\n<START>助手消息<END>\n' +
            '- 作用：展示NPC性格和对话风格（Few-shot）\n\n' +
            '【alternate_greetings 备用开局】\n' +
            '- 数量：至少3个\n' +
            '- 差异化：不同身份/难度/场景的开场白\n' +
            '- 提升重玩价值\n\n' +
            '【depth_prompt 新手引导】\n' +
            '- prompt：新手引导内容，教玩家如何互动\n' +
            '- depth：默认0（表示对所有玩家生效）\n\n' +
            '【regex_scripts 状态同步正则】\n' +
            '- 数量：3-5条实用脚本\n' +
            '- 格式规范：\n' +
            '  * findRegex：/模式/flags格式（必须包含g全局匹配，中文加i忽略大小写）\n' +
            '  * replaceString：支持$1-$9捕获组、{{match}}宏、$&完整匹配\n' +
            '  * placement：[0]=用户输入，[1]=AI回复，[0,1]=两者都处理\n' +
            '  * substituteRegex：0=不替换宏，1=原始替换，2=转义替换（一般用1）\n' +
            '  * runOnEdit：true=编辑消息时重新执行（状态栏类脚本建议开启）\n' +
            '  * scriptName：简短描述脚本功能\n' +
            '- 常用场景：\n' +
            '  * 状态栏格式化：findRegex="/<status>(.*?)</status>/gi", replaceString="**状态：**$1"\n' +
            '  * 行动标签：findRegex="/<action>(.*?)</action>/gi", replaceString="**行动：**$1"\n' +
            '  * 数值高亮：findRegex="/(\\d+)(点|级|年|%)/gi", replaceString="**$1$2**"\n' +
            '  * 表情转换：findRegex="/\\[笑\\]/gi", replaceString="😄"\n\n' +
            '【tags 标签】\n' +
            '- 数量：2-12个\n' +
            '- 内容：精准描述世界题材和风格\n' +
            '- 格式：简短词语，如"奇幻""中世纪""魔法"\n\n' +
            '【entries 世界书条目】\n' +
            '- 数量：12-30条\n' +
            '- 命名规范：使用<基础公理>、<核心铁则>、<近场强约束>、<场景机制>、<实体交互>、<叙事背景>、<动态系统>等前缀\n' +
            '- content要求：≥250字，完整自包含，严禁使用"如上所述""见上文"等上下文依赖词\n' +
            '- keys：精准触发词，避免泛用词（如"的""是"）\n' +
            '- 核心配置：\n' +
            '  * constant=true：常驻条目（核心规则、基础公理），position应≤1\n' +
            '  * constant=false：触发条目，position=4（默认）\n' +
            '  * prevent_recursion：实体类条目必须开启，防止链式触发\n' +
            '  * cooldown：场景类条目建议设为3，防止刷屏\n' +
            '  * group/group_weight：场景变体使用分组实现互斥\n' +
            '  * delay_until_recursion：叙事类条目开启，实现关联触发\n' +
            '  * probability：随机事件设为<100\n' +
            '  * secondary_keys+selectiveLogic：复杂条件控制\n' +
            '- 优化策略：优先优化现有条目（用相同comment覆盖），不足则补充新条目\n\n' +
            '⚠️⚠️⚠️【entries 优化铁律 - 违反则优化失败=旧内容残留=用户骂你】\n' +
            '1. 优化≠追加！优化=覆盖/替换旧条目，而不是只加新条目！\n' +
            '2. 修改条目：新条目的 comment 必须与旧条目的 comment「完全相同=字符级匹配」（空格标点都不能变）\n' +
            '3. 重写条目：必须先删除旧条目（_action:delete），再加新条目；或者确保新条目 comment 完全一致\n' +
            '4. 精简条目：如果要求"精简N条"，必须明确用 _delete / _action:delete 删除多出的条目\n' +
            '5. 同前缀条目重复：若优化后同模块（如<核心铁则>）的条目数超标，必须删除旧的、质量较低的条目\n' +
            '6. 最推荐的写法（AI最容易写对，系统支持最好）：\n' +
            '   替换条目=先写 _action:delete 条目删旧的，再写新条目（新comment可以与旧的不同）\n' +
            '   例：\n' +
            '   "entries": [\n' +
            '     { "_action":"delete", "comment":"<这里粘贴精确旧comment>" },\n' +
            '     { "comment":"<新comment或相同comment>", "content":"...新内容...", "keys":[...] }\n' +
            '   ]\n\n' +
            '【MVU 变量系统条目（仅当优化 entries 且卡内已含 MVU 条目时适用）】\n' +
            'MVU 四大核心条目必须成套存在，缺一不可：\n' +
            '1. [InitVar]初始变量（comment 以 [InitVar] 开头）\n' +
            '   - enabled 必须 false（MVU 只读取禁用的 initvar 条目进行初始化，true 会失效）\n' +
            '   - content 为 YAML 格式，缩进表示层级，定义所有变量的初始值\n' +
            '   - 示例：\n     世界:\n       当前时间: 开局\n       当前地点: 待定\n     主角:\n       体力值: 100\n       状态: 进行中\n     同桌:\n       好感度: 0\n' +
            '2. 变量列表（comment 含"变量列表"）\n' +
            '   - content 必须包含宏 {{format_message_variable::stat_data}}（否则 LLM 无法读取当前变量值）\n' +
            '   - 固定格式：---\\n<status_current_variable>\\n{{format_message_variable::stat_data}}\\n</status_current_variable>\n' +
            '   - 禁止写成 {{null}}、{{get_message_variable::stat_data}} 等变体\n' +
            '3. 变量更新规则（comment 含"变量更新规则"）\n' +
            '   - 定义每个变量在什么条件下更新、更新成什么值\n' +
            '4. 变量输出格式（comment 含"变量输出格式"，建议加 [mvu_update] 前缀）\n' +
            '   - 定义 <UpdateVariable> 输出格式，采用 JSON Patch (RFC 6902) 标准\n' +
            '   - 支持操作：replace(替换值)/delta(数值增减)/insert(插入)/remove(删除)/move(移动)\n' +
            '   - AI 输出示例：{ "op": "replace", "path": "/主角/体力值", "value": 80 }, { "op": "delta", "path": "/同桌/好感度", "value": 5 }\n' +
            '注意：MVU 脚本（bundle.js）、变量结构脚本（zod schema）、正则1-5、<StatusPlaceHolderImpl/> 占位符均由导出时自动注入，AI 无需生成\n' +
            '⚠️但正则6（美化状态栏）必须由AI生成！严格按以下UI/UX规范生成，美观度对齐参考卡片，严禁敷衍：\n' +
            '  · 【配置固定】findRegex="/<StatusPlaceHolderImpl\\\\/>/g", placement=[2], markdownOnly=true, promptOnly=false, runOnEdit=true, substituteRegex=0\n' +
            '  · 【包裹格式】完整HTML结构：<!doctype html>→html→head(style)→body(script type=module)，用```html代码块包裹\n' +
            '  · 【读变量】getAllVariables() + _.get(allVars,"stat_data",{})（不要用Mvu.getVar，有时序失效）\n' +
            '  · 【异步等待】await waitGlobalInitialized(\'Mvu\') 后必须绑定两个事件：VARIABLE_INITIALIZED + VARIABLE_UPDATE_ENDED（缺一不可）\n' +
            '  · 【异常捕获】$(errorCatched(init)) 包裹\n' +
            '  · 【递归渲染规范（核心！严禁只遍历一层）】function renderTree(obj, level) { level = level || 0; } 跳过 key.startsWith(\'_\')/(\'$\') 隐藏变量\n' +
            '    - typeof==="number" → .value-number 主题色显示；布尔值 → value-true ✓ / value-false ✕（绿/红分色，不用emoji✅❌）\n' +
            '    - 嵌套对象 → 先flush为.stat-grid，再输出.category-title（▸图标+分隔线），然后递归 renderTree(value, level+1) 并 .indent-N 缩进\n' +
            '    - 数组 Array.isArray(value) → .value-text 显示 [a, b, c]；其他 → .value-text\n' +
            '  · 【配色（核心！必须用CSS变量）】推荐低饱和柔色系：深色毛玻璃主题 --card-bg:rgba(30,35,45,0.82);backdrop-filter:blur(6px); 配--accent-blue:#93c5fd / --accent-green:#86efac / --accent-red:#fca5a5 / --text-sub:#94a3b8\n' +
            '  · 【布局（核心！严禁平铺直叙）】必须用Grid响应式：.stat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:4px 16px; }\n' +
            '    - .category-title 分类标题（font-weight:600 + 分隔线 + ▸）\n' +
            '    - .indent-1/2/3/4 { padding-left:8/20/32/44px } 按嵌套深度缩进\n' +
            '    - .stat-item flex+justify-content:space-between + align-items:flex-start + gap:8px + .hover-bg 高亮\n' +
            '  · 【动效（点睛）】.loading-state 文本居中 + @keyframes breathe呼吸动画(opacity 0.5↔0.9)；.flash-update + @keyframes fadeIn(0.6→1) + setTimeout 300ms 移除；transition: 0.2s ease\n' +
            '  · 【输出前必查自查清单】Grid布局✓、分类标题✓、indent缩进类✓、hover高亮✓、Array处理✓、两个事件绑定✓、flash更新动画✓、loading动画✓\n\n' +
            '=== 输出格式 ===\n' +
            '只输出```json代码块，包含优化后的字段。\n' +
            '规则：\n' +
            '1. entries字段直接放在顶层，不需要嵌套在character_book中\n' +
            '2. depth_prompt和regex_scripts直接放在顶层，不需要嵌套在extensions中\n' +
            '3. 只包含被优化的字段，其他字段不要输出\n' +
            '4. 保持JSON格式正确，使用双引号\n' +
            '5. [InitVar] 条目的 enabled 必须为 false；变量列表 content 必须含 {{format_message_variable::stat_data}} 宏\n' +
            '6. ⚠️最关键：删除/替换条目必须使用下面「精确comment清单」里的字符串！不要自己编造comment！\n\n' +
            // 注入精确 comment 清单（仅当优化 entries 时）
            (selectedOptFields.indexOf('entries') >= 0 ? (function() {
              var entries = (cardData.character_book || {}).entries || [];
              if (!entries.length) return '（当前无世界书条目，无需处理删除）\n\n';
              var t = '=== 🌍 世界书条目精确comment清单（删/改时直接复制使用，字符级精确） ===\n';
              t += '共 ' + entries.length + ' 条条目，按模块分组：\n';
              var groups = {};
              entries.forEach(function(e, i) {
                var c = e.comment || ('条目'+(i+1));
                var p = extractEntryPrefix(c) || '其他';
                if (!groups[p]) groups[p] = [];
                groups[p].push({ idx: i+1, comment: c, content: e.content || '' });
              });
              Object.keys(groups).forEach(function(g) {
                t += '\n【前缀：<' + g + '>】 共' + groups[g].length + '条：\n';
                groups[g].forEach(function(x) {
                  t += '  ' + x.idx + '. ⟦' + x.comment + '⟧  (' + x.content.length + '字)\n';
                });
              });
              t += '\n⚠️ 删除写法示例：\n';
              t += '  { "_action":"delete", "comment":"' + (entries[0] ? entries[0].comment : '精确comment') + '" }\n';
              t += '⚠️ 修改写法：保持 comment 完全与上面一致，或先 _action:delete 再新增新comment条目\n\n';
              return t;
            })() : '') +
            (selectedOptFields.indexOf('regex_scripts') >= 0 ? (function() {
              var rx = ((cardData.extensions || {}).regex_scripts || []);
              if (!rx.length) return '';
              var t = '=== 🔧 regex_scripts 精确标识清单 ===\n';
              rx.forEach(function(r, i) {
                t += '  ' + (i+1) + '. id=' + (r.id||'(无)') + '  scriptName=' + (r.scriptName||'(无)') + '  findRegex=' + (r.findRegex||'(无)') + '\n';
              });
              t += '删除写法：{ "_action":"delete", "id":"..." } 或 { "_action":"delete", "scriptName":"..." }\n\n';
              return t;
            })() : '') +
            '=== 当前角色卡（供参考） ===\n```json\n' + cardStr + '\n```';


          var reply = await callAI(optPrompt);
          var optimized = extractJSON(reply);
          if (!optimized) {
            if (prog) prog.style.display = 'none';
            if (res) {
              res.style.display = 'block';
              res.innerHTML = '<div style="padding:12px;text-align:center;color:#c98b7a">⚠️ AI未返回有效的优化JSON<br><span style="font-size:.7em;color:#8c8472">原始回复：' + escHtml(reply.substring(0, 200)) + '</span></div>';
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
                    '<div style="font-size:.78em;font-weight:600;color:#8a6d3b;margin-bottom:4px">' + field + '</div>' +
                    '<div class="opt-compare">' +
                      '<div><div class="opt-label before">优化前</div><div class="opt-pane before">' + escHtml(beforeV) + '</div></div>' +
                      '<div><div class="opt-label after">优化后</div><div class="opt-pane after">' + escHtml(afterV) + '</div></div>' +
                    '</div></div>';
                });
                compH += '<div style="margin:10px 0;padding:10px;background:#fffdf8;border-radius:6px">' +
                  '<div style="font-weight:600;margin-bottom:6px">📋 应用模式：</div>' +
                  '<label style="display:block;margin:4px 0;cursor:pointer">' +
                  '<input type="radio" name="optMode" value="smart" checked> ' +
                  '<b>智能合并模式（推荐）</b>：按 comment 精确匹配/前缀匹配自动覆盖、支持 _action:delete 删除，保留未被修改的旧条目' +
                  '</label>' +
                  '<label style="display:block;margin:4px 0;cursor:pointer">' +
                  '<input type="radio" name="optMode" value="replace"> ' +
                  '<b>彻底替换模式</b>：删除当前卡中与优化字段同模块的<b>所有旧条目</b>，再插入优化后的新条目（彻底解决旧内容残留，适合重写/精简）' +
                  '</label>' +
                  '<label style="display:block;margin:4px 0;cursor:pointer">' +
                  '<input type="radio" name="optMode" value="append"> ' +
                  '<b>纯追加模式</b>：仅追加新条目，不修改不删除任何旧条目（不推荐，易重复）' +
                  '</label>' +
                  '</div>';
                compH += '<div style="text-align:center;margin-top:8px">' +
                  '<button class="btn btn-success" id="applyOptBtn">✅ 应用优化</button>' +
                '</div>';
                res.innerHTML = compH;
                var applyBtn = doc.getElementById('applyOptBtn');
                if (applyBtn) {
                  applyBtn.addEventListener('click', function() {
                    var modeRadios = doc.getElementsByName('optMode');
                    var optMode = 'smart';
                    for (var ri = 0; ri < modeRadios.length; ri++) {
                      if (modeRadios[ri].checked) { optMode = modeRadios[ri].value; break; }
                    }
                    var optModified = false;
                    if (optMode === 'replace') {
                      // 彻底替换模式：先清理，再合并
                      // entries 清理：删除所有前缀与新条目前缀相同的旧条目
                      if (Array.isArray(optimized.entries) && optimized.entries.length) {
                        var newPrefixes = {};
                        optimized.entries.forEach(function(e) {
                          var p = extractEntryPrefix(e.comment || '');
                          if (p) newPrefixes[p] = true;
                        });
                        var oldEntries = (cardData.character_book || {}).entries || [];
                        var keptEntries = oldEntries.filter(function(e) {
                          var p = extractEntryPrefix(e.comment || '');
                          // 保留与新条目前缀无关的旧条目；MVU核心条目([InitVar]、变量列表、更新规则、输出格式)始终保留，除非新内容中明确包含对应前缀
                          var isMvuCore = /\[InitVar\]|变量列表|变量更新规则|变量输出格式|\[mvu_update\]/i.test(e.comment || '');
                          if (isMvuCore && !(e.comment && optimized.entries.some(function(ne) { return (ne.comment || '') === e.comment; }))) {
                            return true; // MVU核心条目默认保留，除非新内容精确覆盖
                          }
                          if (newPrefixes[p]) return false; // 相同前缀→删除
                          return true; // 不同前缀→保留
                        });
                        if (!cardData.character_book) cardData.character_book = {};
                        cardData.character_book.entries = keptEntries;
                        optModified = (keptEntries.length !== oldEntries.length);
                      }
                      // regex_scripts 清理：删除后重新插入
                      if (optimized.regex_scripts) {
                        if (cardData.extensions) cardData.extensions.regex_scripts = [];
                        optModified = true;
                      }
                      // alternate_greetings 清理
                      if (optimized.alternate_greetings) {
                        cardData.alternate_greetings = [];
                        optModified = true;
                      }
                      // 再用 mergePartial 应用优化结果
                      var r = mergePartial(optimized, cardData);
                      if (r) optModified = true;
                    } else if (optMode === 'append') {
                      // 纯追加模式：只用新增逻辑
                      if (Array.isArray(optimized.entries) && optimized.entries.length) {
                        cardData.character_book = cardData.character_book || { entries: [] };
                        optimized.entries.forEach(function(e) {
                          if (!e || e._action === 'delete') return; // 追加模式下忽略删除动作
                          if (!e.comment || !e.content) return;
                          cardData.character_book.entries.push(Object.assign({ keys: [], secondary_keys: [] }, e));
                          optModified = true;
                        });
                      }
                      // 其他字段：长度非空时才覆盖
                      ['description','personality','scenario','first_mes','system_prompt','creator_notes','mes_example','post_history_instructions'].forEach(function(f) {
                        if (optimized[f] && String(optimized[f]).trim().length > 10) {
                          if (cardData[f] !== optimized[f]) { cardData[f] = optimized[f]; optModified = true; }
                        }
                      });
                      if (Array.isArray(optimized.alternate_greetings)) { cardData.alternate_greetings = (cardData.alternate_greetings || []).concat(optimized.alternate_greetings); optModified = true; }
                      if (Array.isArray(optimized.tags)) { cardData.tags = (cardData.tags || []).concat(optimized.tags.filter(function(t) { return (cardData.tags || []).indexOf(t) < 0; })); optModified = true; }
                    } else {
                      // 智能合并模式（默认）
                      optModified = !!mergePartial(optimized, cardData);
                    }
                    if (optModified) {
                      progress = calcProgress();
                      updateProgress();
                      renderPreview();
                      doc.getElementById('optModal').remove();
                      showToast('✅ 优化已应用 (' + (optMode === 'replace' ? '替换模式' : optMode === 'append' ? '追加模式' : '智能合并') + ')', 'success');
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
                res.innerHTML = '<div style="padding:12px;text-align:center;color:#c98b7a">JSON解析失败: ' + escHtml(e.message) + '</div>';
              }
            }
          }
        } catch(err) {
          if (prog) prog.style.display = 'none';
          if (res) {
            res.style.display = 'block';
            res.innerHTML = '<div style="padding:12px;text-align:center;color:#c98b7a">优化失败: ' + escHtml(err.message) + '</div>';
          }
        } finally {
          isGenerating = false;
          if (btn) btn.disabled = false;
        }
      }

      // ===== 预览渲染 =====
      function renderPreview() {
        var body = doc.getElementById('previewBody');
        if (!body) return;
        updateProgress();

        // 通用段落：完整显示内容（不再截断），支持折叠
        function sec(icon, title, content, rightInfo) {
          var has = content && (typeof content === 'string' ? content.trim().length > 0 : true);
          var dot = has ? 'full' : 'empty';
          var inner = has ? '<div class="pv-content">' + escHtml(typeof content === 'string' ? content : '') + '</div>' : '<div class="pv-empty">待生成...</div>';
          var rightHtml = rightInfo ? '<span class="sec-right">' + rightInfo + '</span>' : '';
          return '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + dot + '"></span>' + icon + ' ' + title + '</span>' + rightHtml + '<span class="pv-toggle" title="折叠/展开"></span></h3>' + inner + '</div>';
        }

        var h = '';
        h += sec('🌍', '世界名称', cardData.name);
        h += sec('📜', '世界观描述', cardData.description, cardData.description ? (cardData.description.length + '字') : '');

        // 模块进度
        var mp = getModuleProgress();
        var modLabels = { axiom: '🏛️ 公理', soft_rules: '🤝 软规则', core_rules: '🔐 铁则', near_constraint: '🎯 近场', scene_mechanics: '⚔️ 机制', entity_interact: '👥 实体', narrative_bg: '📖 叙事', dynamic_adapt: '🔄 动态', init_var: '📊 变量', var_update_rule: '📝 更新' };
        var modH = '<div class="module-progress">';
        Object.keys(modLabels).forEach(function(k) {
          var cls = mp[k] ? 'done' : 'todo';
          modH += '<div class="module-item ' + cls + '">' + modLabels[k] + '</div>';
        });
        modH += '</div>';

        var entries = (cardData.character_book && cardData.character_book.entries) || [];
        var bookName = (cardData.name ? cardData.name + ' · 世界设定集' : '世界设定集');
        var bookTokCount = 0;
        entries.forEach(function(e) { bookTokCount += countTokens(e.content || ''); });

        // 世界书条目：完整显示全部条目（不再限制6条/截断100字），每个条目独立折叠
        if (entries.length > 0) {
          var eH = modH + '<div class="pv-entry-list">';
          for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var label = e.comment || ('条目' + (i+1));
            var eTok = countTokens(e.content || '');
            var constTag = e.constant ? '<span class="pv-tag ok">常驻</span>' : '<span class="pv-tag">触发</span>';
            var posTag = '<span class="pv-tag">P' + (e.position == null ? '-' : e.position) + '</span>';
            var depTag = (e.depth != null) ? '<span class="pv-tag">D' + e.depth + '</span>' : '';
            var disabledTag = e.enabled === false ? '<span class="pv-tag off">禁用</span>' : '';
            eH += '<div class="pv-entry"><div class="pv-entry-title">' + escHtml(label) + ' <span class="sec-right">~' + eTok + 'T</span></div>' +
              '<div style="margin:2px 0">' + constTag + posTag + depTag + disabledTag + '</div>' +
              '<div class="pv-entry-content">' + escHtml(e.content || '') + '</div></div>';
          }
          eH += '</div>';
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>📖 <span class="pv-book-name">' + escHtml(bookName) + '</span></span><span class="sec-right">' + entries.length + '条 · ~' + bookTokCount + 'T</span><span class="pv-toggle" title="折叠/展开"></span></h3>' + eH + '</div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>📖 <span class="pv-book-name">' + escHtml(bookName) + '</span></span><span class="pv-toggle"></span></h3><div class="pv-empty">待生成...</div></div>';
        }

        h += sec('🎬', '开场白', cardData.first_mes, cardData.first_mes ? (cardData.first_mes.length + '字') : '');
        h += sec('⚡', '系统指令', cardData.system_prompt, cardData.system_prompt ? (cardData.system_prompt.length + '字') : '');

        var tags = cardData.tags || [];
        if (tags.length > 0) {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>🏷️ 标签</span><span class="sec-right">' + tags.length + '个</span><span class="pv-toggle"></span></h3><div class="pv-content">' + tags.map(function(t) { return escHtml(t); }).join(' · ') + '</div></div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>🏷️ 标签</span><span class="pv-toggle"></span></h3><div class="pv-empty">待生成...</div></div>';
        }

        h += sec('📝', '创作者备注', cardData.creator_notes);

        // ===== 正则脚本（regex_scripts）完整展示 =====
        var rxScripts = normalizeRegexScripts(cardData.extensions && cardData.extensions.regex_scripts);
        if (rxScripts.length > 0) {
          var rxH = '<div class="pv-sub">';
          rxScripts.forEach(function(r, idx) {
            var isStatusBar = (r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly;
            var placementMap = { 1: '用户输入', 2: 'AI回复', 3: '斜杠命令', 4: '世界书' };
            var plLabel = (r.placement || []).map(function(p) { return placementMap[p] || ('P' + p); }).join('/') || '-';
            var flags = [];
            if (r.markdownOnly) flags.push('<span class="pv-tag">仅显示</span>');
            if (r.promptOnly) flags.push('<span class="pv-tag">仅提示词</span>');
            if (r.runOnEdit) flags.push('<span class="pv-tag ok">编辑触发</span>');
            if (r.disabled) flags.push('<span class="pv-tag off">禁用</span>');
            if (isStatusBar) flags.push('<span class="pv-tag ok">美化状态栏</span>');
            var rep = r.replaceString || '';
            // 状态栏正则的 replaceString 可能是 ```html 包裹的完整 HTML，完整显示
            rxH += '<div class="pv-entry"><div class="pv-entry-title">' + (idx + 1) + '. ' + escHtml(r.scriptName || '正则脚本') + ' <span class="sec-right">' + escHtml(plLabel) + '</span></div>';
            rxH += '<div style="margin:2px 0">' + flags.join('') + '</div>';
            rxH += '<div class="pv-code">查找：<code>' + escHtml(r.findRegex || '') + '</code></div>';
            if (rep) {
              var repDisplay = rep.length > 1200 ? rep.substring(0, 1200) + '\n…（共' + rep.length + '字符，已截断预览）' : rep;
              rxH += '<div class="pv-code" style="margin-top:3px">替换：\n' + escHtml(repDisplay) + '</div>';
            }
            rxH += '</div>';
          });
          rxH += '</div>';
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>🧩 正则脚本</span><span class="sec-right">' + rxScripts.length + '条</span><span class="pv-toggle"></span></h3>' + rxH + '</div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>🧩 正则脚本</span><span class="pv-toggle"></span></h3><div class="pv-empty">待生成...（MVU卡导出时会自动注入正则1-5；正则6美化状态栏需AI生成）</div></div>';
        }

        // ===== 脚本（tavern_helper.scripts）完整展示 =====
        var thScripts = (cardData.extensions && cardData.extensions.tavern_helper && cardData.extensions.tavern_helper.scripts) || [];
        if (thScripts.length > 0) {
          var shH = '<div class="pv-sub">';
          thScripts.forEach(function(s, idx) {
            var sName = s.name || s.scriptName || ('脚本' + (idx + 1));
            var sFlags = [];
            if (s.enabled === false) sFlags.push('<span class="pv-tag off">禁用</span>'); else sFlags.push('<span class="pv-tag ok">启用</span>');
            if ((s.content || '').indexOf('bundle.js') >= 0 || (s.content || '').indexOf('MagVarUpdate') >= 0) sFlags.push('<span class="pv-tag">MVU核心</span>');
            if ((s.content || '').indexOf('registerMvuSchema') >= 0) sFlags.push('<span class="pv-tag">变量结构</span>');
            shH += '<div class="pv-entry"><div class="pv-entry-title">' + (idx + 1) + '. ' + escHtml(sName) + '</div>';
            shH += '<div style="margin:2px 0">' + sFlags.join('') + '</div>';
            var sc = s.content || '';
            var scDisplay = sc.length > 1500 ? sc.substring(0, 1500) + '\n…（共' + sc.length + '字符，已截断预览）' : sc;
            shH += '<div class="pv-code">' + escHtml(scDisplay) + '</div>';
            shH += '</div>';
          });
          shH += '</div>';
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot full"></span>⚙️ 脚本</span><span class="sec-right">' + thScripts.length + '条</span><span class="pv-toggle"></span></h3>' + shH + '</div>';
        } else {
          h += '<div class="pv-section"><h3><span class="sec-left"><span class="dot empty"></span>⚙️ 脚本</span><span class="pv-toggle"></span></h3><div class="pv-empty">待生成...（MVU卡导出时会自动注入 bundle.js 与变量结构脚本）</div></div>';
        }

        // ===== 状态栏生成与显示（深度完善）=====
        h += buildStatusBarPreviewSection();

        body.innerHTML = h;
        // 绑定折叠/按钮事件（每次重渲染后重新绑定）
        bindPreviewInteractions();
      }

      // 状态栏预览区块：展示生成状态 + 已收集模块 + 预览/重置按钮
      function buildStatusBarPreviewSection() {
        var entries = (cardData.character_book || {}).entries || [];
        var hasMVU = entries.some(function(e) { return isMVUEntry(e.comment || ''); });
        var rxScripts = normalizeRegexScripts(cardData.extensions && cardData.extensions.regex_scripts);
        // 美化状态栏正则（正则6）：findRegex含StatusPlaceHolder + markdownOnly + !promptOnly
        var statusBarRegex = null;
        for (var i = 0; i < rxScripts.length; i++) {
          var r = rxScripts[i];
          if ((r.findRegex || '').indexOf('StatusPlaceHolder') >= 0 && r.markdownOnly && !r.promptOnly) { statusBarRegex = r; break; }
        }
        // 已收集的状态栏模块（分Step生成时）
        var stepNames = { step2: '配色方案', step3: 'HTML骨架', step4: 'CSS样式', step5: '变量读取', step6: '渲染函数', step7: '事件绑定+入口' };
        var collected = [], missing = [];
        for (var sk in stepNames) { if (statusBarModules[sk]) collected.push(stepNames[sk]); else missing.push(stepNames[sk]); }
        var hasStatusBar = !!statusBarRegex;

        var dotCls = hasStatusBar ? 'full' : 'empty';
        var right = hasStatusBar ? '已生成' : (hasMVU ? '待生成' : '未启用MVU');
        var sH = '<div class="pv-sub">';

        // 状态概览
        if (hasMVU) {
          sH += '<div class="pv-entry"><div class="pv-entry-title">变量系统</div><div class="pv-entry-content">已检测到 MVU 变量系统条目，导出时会自动注入 bundle.js、变量结构脚本与正则1-5。</div></div>';
        } else {
          sH += '<div class="pv-entry"><div class="pv-entry-title">变量系统</div><div class="pv-entry-content">未检测到 MVU 变量系统。状态栏依赖 MVU 变量，请先生成「[InitVar]初始变量」等条目。</div></div>';
        }

        // 美化状态栏正则状态
        if (hasStatusBar) {
          var repLen = (statusBarRegex.replaceString || '').length;
          sH += '<div class="pv-entry"><div class="pv-entry-title">美化状态栏正则（正则6）<span class="sec-right">替换内容 ' + repLen + ' 字符</span></div>';
          sH += '<div style="margin:2px 0"><span class="pv-tag ok">已生成</span><span class="pv-tag">仅显示</span><span class="pv-tag ok">编辑触发</span></div>';
          sH += '<div class="pv-entry-content">findRegex: ' + escHtml(statusBarRegex.findRegex || '') + '</div></div>';
        } else {
          sH += '<div class="pv-entry"><div class="pv-entry-title">美化状态栏正则（正则6）</div>';
          sH += '<div style="margin:2px 0"><span class="pv-tag off">未生成</span></div>';
          sH += '<div class="pv-entry-content">未检测到美化状态栏正则。可让 AI「生成状态栏」或「美化状态栏」，写卡器会自动收集分Step模块并拼接保存。</div></div>';
        }

        // 分Step模块收集进度
        if (collected.length > 0 || hasMVU) {
          var progressIcons = '';
          for (var pk in stepNames) { progressIcons += statusBarModules[pk] ? '✅' : '⬜'; }
          sH += '<div class="pv-entry"><div class="pv-entry-title">分Step模块收集 <span class="sec-right">' + collected.length + '/6 ' + progressIcons + '</span></div>';
          sH += '<div class="pv-entry-content">已收集：' + (collected.length ? collected.join('、') : '无') + (missing.length ? '\n还缺：' + missing.join('、') : '') + '</div></div>';
        }

        // 操作按钮
        sH += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">';
        if (hasMVU) {
          sH += '<button class="pv-mini-btn" data-pv-action="preview-statusbar">🔍 预览状态栏</button>';
        }
        sH += '<button class="pv-mini-btn" data-pv-action="gen-statusbar">✨ 让AI生成状态栏</button>';
        if (hasStatusBar) {
          sH += '<button class="pv-mini-btn" data-pv-action="reset-statusbar">🗑️ 清除已生成状态栏</button>';
        }
        sH += '</div>';

        sH += '</div>';
        return '<div class="pv-section"><h3><span class="sec-left"><span class="dot ' + dotCls + '"></span>🎛️ 状态栏</span><span class="sec-right">' + right + '</span><span class="pv-toggle"></span></h3>' + sH + '</div>';
      }

      // 预览面板交互绑定：段落折叠 + 状态栏按钮
      function bindPreviewInteractions() {
        var body = doc.getElementById('previewBody');
        if (!body) return;
        // 段落折叠（点击 h3 标题区或 pv-toggle）
        var toggles = body.querySelectorAll('.pv-toggle');
        for (var i = 0; i < toggles.length; i++) {
          toggles[i].addEventListener('click', function(e) {
            e.stopPropagation();
            var section = this.closest('.pv-section');
            if (section) section.classList.toggle('collapsed');
          });
        }
        // 标题点击也可折叠（除按钮/链接外）
        var heads = body.querySelectorAll('.pv-section > h3');
        for (var j = 0; j < heads.length; j++) {
          heads[j].addEventListener('click', function(e) {
            if (e.target.closest('.pv-mini-btn') || e.target.closest('.pv-book-name') || e.target.closest('.pv-toggle')) return;
            var section = this.closest('.pv-section');
            if (section) section.classList.toggle('collapsed');
          });
        }
        // 状态栏按钮
        var btns = body.querySelectorAll('.pv-mini-btn[data-pv-action]');
        for (var k = 0; k < btns.length; k++) {
          btns[k].addEventListener('click', function() {
            var act = this.getAttribute('data-pv-action');
            if (act === 'preview-statusbar') {
              showMvuStatusBarPreview();
            } else if (act === 'gen-statusbar') {
              var input = doc.getElementById('chatInput');
              if (input) {
                input.value = '请帮我生成/美化MVU状态栏，按分Step方式输出（配色→HTML骨架→CSS→变量读取→渲染函数→事件绑定入口），写卡器会自动收集拼接。';
                updateCharCount();
                updateSendBtnPulse();
                try { input.focus(); } catch(_) {}
              }
            } else if (act === 'reset-statusbar') {
              if (!confirm('确定清除已生成的美化状态栏正则（正则6）及已收集的分Step模块吗？')) return;
              cardData.extensions = cardData.extensions || {};
              var rx = cardData.extensions.regex_scripts || [];
              for (var m = rx.length - 1; m >= 0; m--) {
                if ((rx[m].findRegex || '').indexOf('StatusPlaceHolder') >= 0 && rx[m].markdownOnly && !rx[m].promptOnly) {
                  rx.splice(m, 1);
                }
              }
              cardData.extensions.regex_scripts = rx;
              for (var sk2 in statusBarModules) { statusBarModules[sk2] = null; }
              saveToStorage();
              renderPreview();
              showToast('✅ 已清除状态栏正则与分Step模块', 'success');
            }
          });
        }
      }

      function saveCharacter() {
        if (!cardData.name || !cardData.name.trim()) {
          showToast('请先确定世界/角色名称', 'error');
          return;
        }
        try {
          var exportCard = buildExportCard(cardData);
          // 检测是否包含MVU变量系统条目（复用 isMVUEntry 保持判定一致性）
          var entries = (cardData.character_book || {}).entries || [];
          var hasMVU = entries.some(function(e) { return isMVUEntry(e.comment || ''); });
          if (hasMVU) {
            // 导出时已自动注入 bundle.js脚本、变量结构zod脚本、正则1-5；正则6（美化状态栏）由AI生成或回退默认
            var ext = (exportCard.data && exportCard.data.extensions) || {};
            var rxScripts = ext.regex_scripts || [];
            var helperScripts = (ext.tavern_helper && ext.tavern_helper.scripts) || [];
            var hasBundle = helperScripts.some(function(s) { return (s.content || '').indexOf('bundle.js') >= 0; });
            var hasSchema = helperScripts.some(function(s) { return (s.content || '').indexOf('registerMvuSchema') >= 0; });
            var hasUpdRx = rxScripts.some(function(r) { return (r.findRegex || '').indexOf('UpdateVariable') >= 0; });
            if (hasBundle && hasSchema && hasUpdRx) {
              setTimeout(function() {
                showToast('MVU变量系统已配置完整，bundle.js+变量结构脚本+正则1-5已自动注入，正则6（美化状态栏）需AI生成', 'success');
              }, 500);
            } else {
              setTimeout(function() {
                showToast('MVU变量系统条目已检测到，导出时将自动注入bundle.js脚本、变量结构脚本和正则', 'info');
              }, 500);
            }
          }
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
            '<h2 style="color:#8a6d3b;margin-bottom:8px;font-size:1em">✨ 角色卡已生成</h2>' +
            '<p style="color:#8c8472;margin-bottom:8px;font-size:.78em">复制JSON导入酒馆，或下载文件后导入。</p>' +
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
          // 复用 buildExportCard 确保 MVU 正则/脚本/StatusPlaceHolderImpl 等自动注入逻辑一致
          var v3Card = buildExportCard(cd);
          var data = v3Card.data;
          return JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
              name: data.name,
              description: data.description,
              personality: data.personality,
              scenario: data.scenario,
              first_mes: data.first_mes,
              mes_example: data.mes_example,
              system_prompt: data.system_prompt,
              post_history_instructions: data.post_history_instructions,
              tags: data.tags,
              creator_notes: data.creator_notes,
              creator: data.creator,
              character_version: data.character_version,
              alternate_greetings: data.alternate_greetings,
              group_only_greetings: data.group_only_greetings,
              extensions: data.extensions,
              character_book: data.character_book
            }
          }, null, 2);
        }

        function buildLorebook(cd) {
          // 复用 buildExportCard 确保条目 enabled/position/depth 等字段与 V3 一致（如 [InitVar] enabled=false）
          var v3Card = buildExportCard(cd);
          var book = v3Card.data.character_book || {};
          return JSON.stringify({
            name: cd.name || '世界设定集',
            description: cd.description || '',
            entries: book.entries || []
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
          var fileName = (cardData.name || '时之写卡器导出').replace(/[<>:"/\\|?*]/g, '_') + '.json';

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
      console.error('时之写卡器 Error:', e);
      showToast('打开失败: ' + e.message, 'error');
    }
  }

  function registerButton() {
    try {
      var evtOn = typeof eventOn === 'function' ? eventOn : (typeof window.eventOn === 'function' ? window.eventOn : null);
      var getBtnEvt = typeof getButtonEvent === 'function' ? getButtonEvent : (typeof window.getButtonEvent === 'function' ? window.getButtonEvent : null);
      if (evtOn && getBtnEvt) {
        evtOn(getBtnEvt('时之写卡器'), function() { openEditor(); });
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
      btn.textContent = '⚡ 时之写卡器';
      btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99998;padding:10px 18px;background:linear-gradient(135deg,#b89968,#a8895a);color:#fff;border:none;border-radius:25px;cursor:pointer;font-weight:600;box-shadow:0 4px 15px rgba(184,153,104,.4);transition:all .3s;font-size:14px;';
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
