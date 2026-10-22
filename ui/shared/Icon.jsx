import React from 'react';

// Small outline icons share the weight of NapCat's native controls. Decorative beside visible text: hidden from a11y tree.
export function Icon({ name, size = 16 }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></>,
    contacts: <><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="9" r="2.5"/><path d="M8 17c0-4 8-4 8 0M2 7h3M2 12h3M2 17h3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    window: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.1V21"/></>,
    browser: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01M13 14h5"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 10 2.5 2L7 14M12.5 15H17"/></>,
    hexagon: <><path d="m12 3 7.5 4.3v9.4L12 21l-7.5-4.3V7.3L12 3Z"/><path d="M9.5 10.5v3l3-1.5-3-1.5Z"/></>,
    package: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.1V21"/><path d="M8 5.2 16 9.8"/></>,
    sparkles: <><path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4Z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>,
    play: <path d="M8 5.5v13l11-6.5-11-6.5Z"/>,
    rocket: <><path d="M12 3c3.5 1.6 5.5 4.8 5.5 8.5L14 15h-4l-3.5-3.5C6.5 7.8 8.5 4.6 12 3Z"/><circle cx="12" cy="10" r="1.8"/><path d="M9 15l-2 4 3.5-1.5M15 15l2 4-3.5-1.5"/></>,
    globe: <><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.2-3.4-8.5S9.8 5.8 12 3.5Z"/></>,
    bot: <><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M9.5 3.5h5M8.5 12.5h.01M15.5 12.5h.01M9.5 16h5"/></>,
    alert: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/></>,
    help: <><circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.3a2.3 2.3 0 1 1 3.3 2.1c-.8.4-1.1 1-1.1 1.9M12 16.5h.01"/></>,
    download: <><path d="M12 4v10M8 10.5l4 4 4-4"/><path d="M5 19h14"/></>,
  };
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] || paths.help}</svg>;
}
