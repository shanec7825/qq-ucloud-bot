import React from 'react';

// Button style helper shared by both frontends (see .action-button in theme.css).
export function actionButtonClass(variant = 'secondary') {
  return 'action-button' + (variant && variant !== 'secondary' ? ' ' + variant : '');
}

// Plain action button that posts one protocol v1 string action to the desktop shell.
export function ActionButton({ action, variant = 'secondary', onAction, disabled, icon, children, className = '', ...rest }) {
  return <button type="button" className={[actionButtonClass(variant), className].filter(Boolean).join(' ')} disabled={disabled}
    onClick={() => { if (!disabled) onAction?.(action); }} {...rest}>
    {icon}{children}
  </button>;
}
