import arrowLeft from 'lucide-static/icons/arrow-left.svg?raw';
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw';
import brainCircuit from 'lucide-static/icons/brain-circuit.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import checkCheck from 'lucide-static/icons/check-check.svg?raw';
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw';
import chevronLeft from 'lucide-static/icons/chevron-left.svg?raw';
import circleCheck from 'lucide-static/icons/circle-check.svg?raw';
import circleHelp from 'lucide-static/icons/circle-help.svg?raw';
import clock from 'lucide-static/icons/clock.svg?raw';
import copy from 'lucide-static/icons/copy.svg?raw';
import filePen from 'lucide-static/icons/file-pen.svg?raw';
import layers from 'lucide-static/icons/layers.svg?raw';
import library from 'lucide-static/icons/library.svg?raw';
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw';
import logOut from 'lucide-static/icons/log-out.svg?raw';
import messageSquare from 'lucide-static/icons/message-square.svg?raw';
import messagesSquare from 'lucide-static/icons/messages-square.svg?raw';
import mic from 'lucide-static/icons/mic.svg?raw';
import moreHorizontal from 'lucide-static/icons/more-horizontal.svg?raw';
import network from 'lucide-static/icons/network.svg?raw';
import newspaper from 'lucide-static/icons/newspaper.svg?raw';
import panelLeft from 'lucide-static/icons/panel-left.svg?raw';
import pause from 'lucide-static/icons/pause.svg?raw';
import pencil from 'lucide-static/icons/pencil.svg?raw';
import play from 'lucide-static/icons/play.svg?raw';
import plus from 'lucide-static/icons/plus.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import sendHorizontal from 'lucide-static/icons/send-horizontal.svg?raw';
import share2 from 'lucide-static/icons/share-2.svg?raw';
import shieldCheck from 'lucide-static/icons/shield-check.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import square from 'lucide-static/icons/square.svg?raw';
import thumbsDown from 'lucide-static/icons/thumbs-down.svg?raw';
import thumbsUp from 'lucide-static/icons/thumbs-up.svg?raw';
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw';
import usersRound from 'lucide-static/icons/users-round.svg?raw';
import wandSparkles from 'lucide-static/icons/wand-sparkles.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';

const icons = {
  'arrow-left': arrowLeft,
  'arrow-up': arrowUp,
  'brain-circuit': brainCircuit,
  check,
  'check-check': checkCheck,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'circle-check': circleCheck,
  'circle-help': circleHelp,
  clock,
  copy,
  'file-pen': filePen,
  layers,
  library,
  'loader-circle': loaderCircle,
  'log-out': logOut,
  'message-square': messageSquare,
  'messages-square': messagesSquare,
  mic,
  'more-horizontal': moreHorizontal,
  network,
  newspaper,
  'panel-left': panelLeft,
  pause,
  pencil,
  play,
  plus,
  search,
  send: sendHorizontal,
  'send-horizontal': sendHorizontal,
  share: share2,
  'share-2': share2,
  'shield-check': shieldCheck,
  sparkles,
  square,
  'thumbs-down': thumbsDown,
  'thumbs-up': thumbsUp,
  'triangle-alert': triangleAlert,
  'users-round': usersRound,
  'wand-sparkles': wandSparkles,
  x
};

function escapeAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function iconSvg(name, options = {}) {
  const raw = icons[String(name || '').trim()] || '';
  if (!raw) return '';
  const className = String(options.className || '').trim();
  const label = String(options.label || '').trim();
  const aria = label ? `role="img" aria-label="${escapeAttribute(label)}"` : 'aria-hidden="true" focusable="false"';
  const svg = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
  const classes = `thingy-icon${className ? ` ${escapeAttribute(className)}` : ''}`;
  const withAria = svg.replace('<svg', `<svg ${aria}`);
  return /class="[^"]*"/.test(withAria)
    ? withAria.replace(/class="([^"]*)"/, `class="$1 ${classes}"`)
    : withAria.replace('<svg', `<svg class="${classes}"`);
}

function iconElement(name, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = iconSvg(name, options);
  return template.content.firstElementChild || document.createTextNode('');
}

function hydrateThingyIcons(root = document) {
  root.querySelectorAll('[data-thingy-icon]').forEach((element) => {
    const name = element.getAttribute('data-thingy-icon') || '';
    const className = element.getAttribute('data-thingy-icon-class') || '';
    const label = element.getAttribute('data-thingy-icon-label') || '';
    element.innerHTML = iconSvg(name, { className, label });
  });
}

export { hydrateThingyIcons, iconElement, iconSvg };
