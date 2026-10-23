import React from 'react';
import { Icon } from './Icon.jsx';

// Section card of the setup wizard: title row, description, body, an .actions button row and a feedback slot.
export function SetupCard({ icon, title, badge, required, description, children, actions, feedback, className = '', ...rest }) {
  return <section className={'setup-card' + (className ? ' ' + className : '')} {...rest}>
    {(icon || title || badge) && <header className="setup-card-header">
      {icon && <Icon name={icon} size={18}/>}
      <h2 className="setup-card-title">{title}</h2>
      {badge && <span className={'setup-badge' + (required ? ' required' : '')}>{badge}</span>}
    </header>}
    {description && <p className="setup-card-description">{description}</p>}
    {children != null && <div className="setup-card-body">{children}</div>}
    {actions && <div className="actions">{actions}</div>}
    {feedback}
  </section>;
}
