import React from 'react';

// Small outline icons share the weight of NapCat's native controls.
export function Icon({ name, size = 16 }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></>,
    contacts: <><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="9" r="2.5"/><path d="M8 17c0-4 8-4 8 0M2 7h3M2 12h3M2 17h3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export const fieldStyle = {
  labelPlacement: 'outside',
  placeholder: ' ',
  variant: 'bordered',
  classNames: { label: 'settings-label', inputWrapper: 'settings-input', input: 'settings-value' },
};

export const searchStyle = {
  variant: 'flat',
  startContent: <Icon name="search"/>,
  classNames: { inputWrapper: 'settings-search', input: 'settings-search-value' },
};
