(function () {
  var TITLE = '百佑智业 · 知识库'
  var MARK = [
    '<svg class="by-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">',
    '<rect width="32" height="32" rx="8" fill="#4176E6"/>',
    '<rect x="7.25" y="6.75" width="14.5" height="18.5" rx="1.75" fill="#fff"/>',
    '<path d="M10.2 12.4h6.6M10.2 16h6.6M10.2 19.6h4" stroke="#4176E6" stroke-width="1.7" stroke-linecap="round"/>',
    '<circle cx="23.1" cy="22.8" r="5.15" fill="#F7AD31"/>',
    '<circle cx="23.1" cy="22.8" r="1.85" fill="#fff"/>',
    '</svg>',
  ].join('')
  var WORDMARK = [
    '<div class="by-wordmark" aria-label="百佑智业">',
    MARK,
    '<span class="by-name"><span class="by-zh">百佑智业</span><span class="by-sub">知识库</span></span>',
    '</div>',
  ].join('')

  function applyTitle() {
    if (document.title !== TITLE) document.title = TITLE
  }

  function applyLogo() {
    var boxes = document.querySelectorAll('.logo_box, .logo_row .logo_box')
    if (!boxes.length) {
      document.querySelectorAll('img.logo').forEach(function (img) {
        if (img.closest('.by-wordmark')) return
        var host = img.parentElement
        if (!host || host.dataset.byBranded === '1') return
        host.dataset.byBranded = '1'
        host.innerHTML = WORDMARK
      })
      return
    }
    boxes.forEach(function (box) {
      if (box.dataset.byBranded === '1') return
      box.dataset.byBranded = '1'
      box.innerHTML = WORDMARK
    })
  }

  function applyCopy() {
    if (!document.body) return
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    var node
    while ((node = walker.nextNode())) {
      var text = node.nodeValue
      if (!text || (text.indexOf('WeKnora') === -1 && text.indexOf('WEKNORA') === -1 && text.indexOf('Weknora') === -1)) continue
      if (text.indexOf('@') !== -1 || /weknora\.(local|com|io)/i.test(text)) continue
      node.nodeValue = text
        .replace(/WeKnora/g, '百佑智业')
        .replace(/WEKNORA/g, '百佑智业')
        .replace(/Weknora/g, '百佑智业')
    }
  }

  function apply() {
    applyTitle()
    applyLogo()
    applyCopy()
  }

  apply()
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true })
})()
