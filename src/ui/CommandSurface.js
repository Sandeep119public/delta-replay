const COMMANDS = [
  {
    group: 'Replay',
    items: [
      ['Focus symbol', 'Jump to the symbol selector', 'S'],
      ['Focus replay date', 'Jump to replay date and time', 'D'],
      ['Start replay', 'Load the selected replay window', 'Enter'],
      ['Focus timeline', 'Jump to the replay scrubber', 'T'],
    ],
  },
  {
    group: 'Playback',
    items: [
      ['Play / pause', 'Toggle replay playback', 'Space'],
      ['Step forward', 'Advance one replay step', '→'],
      ['Reset replay', 'Return to the replay start', 'R'],
    ],
  },
  {
    group: 'Trading',
    items: [
      ['Focus quantity', 'Jump to order quantity', 'Q'],
      ['Focus trade panel', 'Focus order entry', 'P'],
    ],
  },
];

function focusElement(id) {
  const element = document.getElementById(id);
  if (!element) return false;
  element.focus({ preventScroll: false });
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}

function runCommand(label) {
  switch (label) {
    case 'Focus symbol':
      return focusElement('symbol-select');
    case 'Focus replay date':
      return focusElement('replay-date');
    case 'Start replay':
      document.getElementById('header-start-replay-btn')?.click();
      return true;
    case 'Focus timeline':
      return focusElement('timeline-slider');
    case 'Play / pause':
      document.getElementById('btn-play')?.classList.contains('hidden')
        ? document.getElementById('btn-pause')?.click()
        : document.getElementById('btn-play')?.click();
      return true;
    case 'Step forward':
      document.getElementById('btn-step')?.click();
      return true;
    case 'Reset replay':
      document.getElementById('btn-reset')?.click();
      return true;
    case 'Focus quantity':
      return focusElement('trade-qty');
    case 'Focus trade panel':
      return focusElement('trade-qty');
    default:
      return false;
  }
}

function flattenCommands() {
  return COMMANDS.flatMap(({ group, items }) => items.map(([label, hint, shortcut]) => ({ group, label, hint, shortcut })));
}

export function createCommandSurface() {
  if (typeof document === 'undefined') return { destroy() {} };
  if (document.querySelector('.phase6-command-trigger')) return { destroy() {} };

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'phase6-command-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Open command menu');
  trigger.innerHTML = 'COMMAND <kbd>⌘K</kbd>';

  const topbarRight = document.querySelector('.topbar-right');
  topbarRight?.prepend(trigger);

  const backdrop = document.createElement('div');
  backdrop.className = 'phase6-command-backdrop hidden';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="phase6-command" role="dialog" aria-modal="true" aria-label="Command menu">
      <div class="phase6-command-header">
        <input class="phase6-command-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search replay commands…" aria-label="Search replay commands">
        <button class="phase6-command-close" type="button" aria-label="Close command menu">×</button>
      </div>
      <div class="phase6-command-list" role="listbox" aria-label="Commands"></div>
    </section>
  `;
  document.body.appendChild(backdrop);

  const search = backdrop.querySelector('.phase6-command-search');
  const list = backdrop.querySelector('.phase6-command-list');
  const close = backdrop.querySelector('.phase6-command-close');
  const commands = flattenCommands();
  let activeIndex = 0;
  let previousFocus = null;

  function visibleCommands() {
    const query = search.value.trim().toLowerCase();
    return query
      ? commands.filter(({ label, hint, group }) => `${label} ${hint} ${group}`.toLowerCase().includes(query))
      : commands;
  }

  function render() {
    const visible = visibleCommands();
    activeIndex = Math.max(0, Math.min(activeIndex, visible.length - 1));
    list.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'phase6-command-empty';
      empty.textContent = 'No matching commands.';
      list.appendChild(empty);
      return;
    }

    let lastGroup = '';
    visible.forEach((command, index) => {
      if (command.group !== lastGroup) {
        const group = document.createElement('div');
        group.className = 'phase6-command-group';
        group.textContent = command.group;
        list.appendChild(group);
        lastGroup = command.group;
      }

      const item = document.createElement('button');
      item.type = 'button';
      item.className = `phase6-command-item${index === activeIndex ? ' is-active' : ''}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeIndex));
      item.innerHTML = `<div><strong></strong><span></span></div><kbd></kbd>`;
      item.querySelector('strong').textContent = command.label;
      item.querySelector('span').textContent = command.hint;
      item.querySelector('kbd').textContent = command.shortcut;
      item.addEventListener('mouseenter', () => {
        activeIndex = index;
        render();
      });
      item.addEventListener('click', () => {
        runCommand(command.label);
        closeMenu();
      });
      list.appendChild(item);
    });

    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function openMenu() {
    previousFocus = document.activeElement;
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    activeIndex = 0;
    search.value = '';
    render();
    requestAnimationFrame(() => search.focus());
  }

  function closeMenu() {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    previousFocus?.focus?.();
  }

  function onTrigger() {
    if (backdrop.classList.contains('hidden')) openMenu();
    else closeMenu();
  }

  function onSearchInput() {
    activeIndex = 0;
    render();
  }

  function onKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      onTrigger();
      return;
    }

    if (backdrop.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }

    const visible = visibleCommands();
    if (!visible.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % visible.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + visible.length) % visible.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runCommand(visible[activeIndex].label);
      closeMenu();
    }
  }

  trigger.addEventListener('click', onTrigger);
  close.addEventListener('click', closeMenu);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeMenu();
  });
  search.addEventListener('input', onSearchInput);
  document.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      trigger.removeEventListener('click', onTrigger);
      close.removeEventListener('click', closeMenu);
      search.removeEventListener('input', onSearchInput);
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      trigger.remove();
    },
  };
}
