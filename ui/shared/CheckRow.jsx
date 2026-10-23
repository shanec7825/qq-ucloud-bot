import React from 'react';
import { Icon } from './Icon.jsx';

const STATE_LABEL = { ok: '正常', fail: '未通过', unknown: '未检测' };

// One check line: icon, name (+ version/extra chips), detail/help text, a dot + text state and an optional action slot.
export function CheckRow({ icon, name, detail, help, state = 'unknown', stateLabel, chips, actions, children }) {
  return <div className="check-row">
    <span className="check-icon"><Icon name={icon} size={15}/></span>
    <div className="check-main">
      <span className="check-name">{name}{chips}</span>
      {detail && <span className="check-detail">{detail}</span>}
      {children}
      {help && <span className="check-help">{help}</span>}
    </div>
    <div className="check-side">
      <span className={'check-state ' + state}>
        <span className="check-dot" aria-hidden="true"/>{stateLabel || STATE_LABEL[state] || STATE_LABEL.unknown}
      </span>
      {actions}
    </div>
  </div>;
}
