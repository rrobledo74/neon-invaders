// Neon HUD: score/credits, wave/lives, weapon + shield status, boss bar,
// toasts, overlays (title/pause/gameover), shop, cosmic weapon reveal.

import { SHAPES } from './defs.js'

// Inline SVG matching a drop's in-game outline. icon: { shape, color }.
function iconSvg(icon, size = 16) {
  const color = '#' + icon.color.toString(16).padStart(6, '0')
  const style = `width:${size}px;height:${size}px;vertical-align:middle;margin-right:7px;filter:drop-shadow(0 0 3px ${color})`
  if (icon.shape === 'circle') {
    return `<svg viewBox="-1.7 -1.7 3.4 3.4" style="${style}"><circle r="1.2" fill="none" stroke="${color}" stroke-width="0.24"/></svg>`
  }
  const points = SHAPES[icon.shape].map(([x, y]) => `${x},${-y}`).join(' ')
  return `<svg viewBox="-1.7 -1.7 3.4 3.4" style="${style}"><polygon points="${points}" fill="none" stroke="${color}" stroke-width="0.24" stroke-linejoin="round"/></svg>`
}

export class UI {
  constructor() {
    this.root = this.el(document.body, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      fontFamily: '"Courier New", monospace',
      fontSize: '15px',
      color: '#9ff',
      textTransform: 'uppercase',
      letterSpacing: '1px',
    })

    this.scoreEl = this.el(this.root, {
      position: 'absolute',
      top: '12px',
      left: '16px',
      textShadow: '0 0 8px #0ff',
    })
    this.statusEl = this.el(this.root, {
      position: 'absolute',
      top: '12px',
      right: '16px',
      textAlign: 'right',
      textShadow: '0 0 8px #f2d',
      color: '#f9d',
    })
    this.weaponEl = this.el(this.root, {
      position: 'absolute',
      bottom: '12px',
      left: '16px',
      textShadow: '0 0 8px #0ff',
    })
    this.shieldEl = this.el(this.root, {
      position: 'absolute',
      bottom: '12px',
      right: '16px',
      textAlign: 'right',
      textShadow: '0 0 8px #fe6',
      color: '#fe9',
    })

    this.bossEl = this.el(this.root, {
      position: 'absolute',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '340px',
      textAlign: 'center',
      display: 'none',
    })

    this.legendEl = this.el(this.root, {
      position: 'absolute',
      left: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'rgba(0,0,0,0.4)',
      padding: '8px 10px',
      borderRadius: '4px',
      fontSize: '11px',
      color: '#9ab',
      lineHeight: '1.9',
    })

    this.toastEl = this.el(this.root, {
      position: 'absolute',
      bottom: '18%',
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '22px',
      color: '#fff',
      textShadow: '0 0 12px #0ff, 0 0 24px #0ff',
      opacity: '0',
      transition: 'opacity 0.3s',
      whiteSpace: 'nowrap',
    })
    this.toastTimer = null

    this.overlayEl = this.el(this.root, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      background: 'rgba(0,0,0,0.45)',
      pointerEvents: 'auto',
    })
  }

  el(parent, styles) {
    const div = document.createElement('div')
    Object.assign(div.style, styles)
    parent.appendChild(div)
    return div
  }

  hud({ score, hi, credits, wave, lives, weapon, shield }) {
    this.scoreEl.innerHTML =
      `SCORE ${score}<br><span style="color:#577;font-size:12px">HI ${hi}</span>` +
      `<br><span style="color:#fe6;text-shadow:0 0 8px #fe6">¤ ${credits}</span>`
    this.statusEl.innerHTML = `WAVE ${wave}<br>${'▲ '.repeat(Math.max(0, lives)).trim()}`
    this.weaponEl.innerHTML = weapon
    this.shieldEl.textContent = shield
  }

  // rows: [{ icon: {shape, color}, label }] — call when the drop pool changes.
  legend(rows) {
    this.legendEl.innerHTML =
      `<div style="color:#5af;letter-spacing:2px">DROPS</div>` +
      rows.map((r) => `<div>${iconSvg(r.icon, 13)}${r.label}</div>`).join('')
  }

  bossBar(name, frac, color) {
    this.bossEl.style.display = 'block'
    this.bossEl.innerHTML =
      `<span style="color:${color};text-shadow:0 0 10px ${color}">${name}</span>` +
      `<div style="background:#210;border:1px solid ${color};height:8px;margin-top:4px">` +
      `<div style="background:${color};height:100%;width:${Math.max(0, frac * 100)}%"></div></div>`
  }

  hideBossBar() {
    this.bossEl.style.display = 'none'
  }

  toast(text) {
    this.toastEl.textContent = text
    this.toastEl.style.opacity = '1'
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastEl.style.opacity = '0'
    }, 1600)
  }

  showOverlay(html) {
    this.overlayEl.style.display = 'flex'
    this.overlayEl.innerHTML = `<div>${html}</div>`
  }

  hideOverlay() {
    this.overlayEl.style.display = 'none'
  }

  // --- Shop -----------------------------------------------------------------------
  // data: { credits, sections: [{ title, items: [{id,label,desc,price,disabled,note}] }] }

  showShop(data, onAction, onClose) {
    this.overlayEl.style.display = 'flex'
    this.overlayEl.innerHTML = ''
    const panel = this.el(this.overlayEl, {
      background: 'rgba(4,4,12,0.95)',
      border: '1px solid #2af',
      boxShadow: '0 0 30px rgba(0,160,255,0.25)',
      padding: '18px 26px',
      width: '600px',
      maxHeight: '84vh',
      overflowY: 'auto',
      textAlign: 'left',
      fontSize: '13px',
    })
    const head = this.el(panel, { textAlign: 'center', marginBottom: '10px' })
    head.innerHTML =
      `<div style="font-size:26px;color:#fff;text-shadow:0 0 14px #0ff">STARDOCK SHOP</div>` +
      `<div style="color:#fe6;text-shadow:0 0 8px #fe6;margin-top:4px">¤ ${data.credits}</div>`

    for (const section of data.sections) {
      if (section.items.length === 0) continue
      const h = this.el(panel, {
        color: '#5af',
        borderBottom: '1px solid #234',
        margin: '12px 0 4px',
        paddingBottom: '2px',
      })
      h.innerHTML = (section.icon ? iconSvg(section.icon) : '') + section.title
      for (const item of section.items) {
        const row = this.el(panel, {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '5px 0',
        })
        const info = this.el(row, { flex: '1' })
        info.innerHTML =
          (item.icon ? iconSvg(item.icon) : '') +
          `<span style="color:#fff">${item.label}</span>` +
          (item.note ? ` <span style="color:#fe6">${item.note}</span>` : '') +
          `<br><span style="color:#789;font-size:12px;text-transform:none">${item.desc}</span>`
        const btn = document.createElement('button')
        btn.textContent = item.price != null ? `¤ ${item.price}` : 'EQUIP'
        btn.disabled = item.disabled
        Object.assign(btn.style, {
          fontFamily: 'inherit',
          fontSize: '13px',
          padding: '4px 14px',
          cursor: item.disabled ? 'default' : 'pointer',
          background: item.disabled ? '#111' : '#052',
          color: item.disabled ? '#555' : '#3f6',
          border: '1px solid ' + (item.disabled ? '#333' : '#3f6'),
        })
        btn.addEventListener('click', () => onAction(item.id))
        row.appendChild(btn)
      }
    }

    const launch = document.createElement('button')
    launch.textContent = '▶ LAUNCH (ENTER)'
    Object.assign(launch.style, {
      fontFamily: 'inherit',
      fontSize: '16px',
      marginTop: '16px',
      padding: '8px 24px',
      width: '100%',
      cursor: 'pointer',
      background: '#013',
      color: '#0ff',
      border: '1px solid #0ff',
    })
    launch.addEventListener('click', onClose)
    panel.appendChild(launch)
  }

  // --- Cosmic weapon reveal ----------------------------------------------------------
  // data: { name, colorCss, mods: [{name, desc}], stats: [{k, v}] }

  showCosmic(data) {
    this.overlayEl.style.display = 'flex'
    const mods = data.mods
      .map(
        (m) =>
          `<div style="margin:6px 0"><span style="color:${data.colorCss};text-shadow:0 0 8px ${data.colorCss}">◆ ${m.name}</span>` +
          ` <span style="color:#9ab;text-transform:none">— ${m.desc}</span></div>`
      )
      .join('')
    const stats = data.stats
      .map((s) => `<span style="margin:0 10px;color:#fff">${s.k} <span style="color:#fe6">${s.v}</span></span>`)
      .join('')
    this.overlayEl.innerHTML =
      `<div style="border:1px solid ${data.colorCss};box-shadow:0 0 40px ${data.colorCss}55;padding:26px 40px;background:rgba(4,4,12,0.95)">` +
      `<div style="color:#9ab;letter-spacing:4px">COSMIC WEAPON ACQUIRED</div>` +
      `<div style="font-size:40px;margin:12px 0;color:${data.colorCss};text-shadow:0 0 18px ${data.colorCss},0 0 50px ${data.colorCss}">${data.name}</div>` +
      `<div style="margin:14px 0">${mods}</div>` +
      `<div style="border-top:1px solid #234;padding-top:12px">${stats}</div>` +
      `<div style="margin-top:18px;color:#fff">PRESS ENTER TO CLAIM</div>` +
      `</div>`
  }
}
