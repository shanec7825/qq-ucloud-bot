import React from 'react';

// Coloured status capsule shared by the settings page and the desktop wizard (see .status-pill in theme.css).
export function StatusPill({ tone = 'default', name, children, className = '', ...rest }) {
  return <span className={'status-pill ' + tone + (className ? ' ' + className : '')} {...rest}>
    {name && <span className="pill-name">{name}</span>}
    {children != null && children !== '' && <span className="pill-value">{children}</span>}
  </span>;
}

// Small colour dot paired with visible text (the text carries the meaning; the dot is decorative).
export function StatusDot({ tone = 'unknown', className = '' }) {
  return <span className={'check-dot' + (className ? ' ' + className : '')} style={{ color: tone === 'ok' ? 'hsl(var(--heroui-success-600))' : tone === 'fail' ? 'hsl(var(--heroui-danger))' : 'hsl(var(--heroui-default-400))' }} aria-hidden="true"/>;
}
