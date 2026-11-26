import { haptic } from './settings-view.js';
import { logSwallowed } from './util.js';

export function showBusyToast(msg) {
  const toast = document.getElementById('syncToast');
  if (!toast) return;
  clearTimeout(toast._timer);
  toast.onclick = null;
  toast.style.pointerEvents = 'auto';
  toast.className = 'sync-toast busy show';
  toast.innerHTML = '<span class="ds-spinner" aria-hidden="true"></span><span></span>';
  toast.lastElementChild.textContent = msg;
}

/** 底部面板下拉关闭：跟手位移，超过阈值或快速下滑时关闭。 */
export function enableSheetDrag(panel, onClose) {
  if (!panel || panel.dataset.dragReady) return;
  panel.dataset.dragReady = '1';
  let startY = 0;
  let dy = 0;
  let active = false;
  let startAt = 0;
  const reset = () => {
    panel.style.transition = '';
    panel.style.transform = '';
  };
  panel.addEventListener('pointerdown', (event) => {
    if (event.target.closest('input,textarea,button,select,a,label')) return;
    active = true;
    startY = event.clientY;
    dy = 0;
    startAt = Date.now();
    panel.style.transition = 'none';
  });
  panel.addEventListener('pointermove', (event) => {
    if (!active) return;
    dy = Math.max(0, event.clientY - startY);
    panel.style.transform = 'translateY(' + dy + 'px)';
  });
  const end = () => {
    if (!active) return;
    active = false;
    const fast = Date.now() - startAt < 450;
    if (dy > 110 || (fast && dy > 56)) {
      panel.style.transform = 'translateY(102%)';
      onClose();
    } else {
      reset();
    }
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

export function showApproval(opts) {
  const options = opts || {};
  const existing = document.getElementById('approvalModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'approvalModal';
  modal.className = 'ds-approval';
  modal.innerHTML = '<div class="ds-approval-card" role="dialog" aria-modal="true" aria-labelledby="approvalTitle"><div class="ds-approval-body"><strong class="ds-approval-title" id="approvalTitle"></strong><p class="ds-approval-text"></p></div><div class="ds-approval-actions"><button type="button" class="ds-approval-btn" data-act="cancel"></button><button type="button" class="ds-approval-btn ds-approval-danger" data-act="ok"></button></div></div>';
  modal.querySelector('.ds-approval-title').textContent = options.title || '请确认';
  modal.querySelector('.ds-approval-text').textContent = options.message || '';
  const cancelButton = modal.querySelector('[data-act="cancel"]');
  const okButton = modal.querySelector('[data-act="ok"]');
  cancelButton.textContent = options.cancelText || '取消';
  okButton.textContent = options.confirmText || '确认';
  if (options.danger === false) okButton.className = 'ds-approval-btn';
  let closed = false;
  const previousFocus = document.activeElement;
  function close() {
    if (closed) return;
    closed = true;
    modal.classList.remove('show');
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    document.removeEventListener('keydown', onKey);
    try {
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    } catch (error) {
      logSwallowed('showApproval', error);
    }
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (items.indexOf(active) < 0) {
      event.preventDefault();
      first.focus();
    }
  }
  cancelButton.addEventListener('click', close);
  if (options.holdMs) {
    const seconds = Math.round(options.holdMs / 1000);
    okButton.textContent = (options.confirmText || '确认') + '（长按 ' + seconds + ' 秒）';
    let held = false;
    let holdTimer = null;
    let animationFrame = null;
    let startAt = 0;
    const resetHold = () => {
      held = false;
      startAt = 0;
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      okButton.style.setProperty('--hold-pct', '0%');
      okButton.classList.remove('is-holding');
    };
    const tick = () => {
      if (!held) return;
      const progress = Math.min(1, (Date.now() - startAt) / options.holdMs);
      okButton.style.setProperty('--hold-pct', (progress * 100).toFixed(1) + '%');
      if (progress < 1) animationFrame = requestAnimationFrame(tick);
    };
    const fire = () => {
      resetHold();
      close();
      if (typeof options.onConfirm === 'function') options.onConfirm();
    };
    const startHold = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      held = true;
      startAt = Date.now();
      okButton.classList.add('is-holding');
      okButton.style.setProperty('--hold-pct', '0%');
      clearTimeout(holdTimer);
      holdTimer = setTimeout(fire, options.holdMs);
      animationFrame = requestAnimationFrame(tick);
    };
    okButton.addEventListener('pointerdown', startHold);
    okButton.addEventListener('pointerup', resetHold);
    okButton.addEventListener('pointercancel', resetHold);
    okButton.addEventListener('pointerleave', resetHold);
    okButton.addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !held) startHold(event);
    });
    okButton.addEventListener('keyup', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        resetHold();
      }
    });
  } else {
    okButton.addEventListener('click', () => {
      close();
      if (typeof options.onConfirm === 'function') options.onConfirm();
    });
  }
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  enableSheetDrag(modal.querySelector('.ds-approval-card'), close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(modal);
  haptic('warning');
  requestAnimationFrame(() => modal.classList.add('show'));
  cancelButton.focus();
  return modal;
}
