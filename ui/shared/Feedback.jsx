import React from 'react';

// Inline feedback line used by every section (see .feedback in theme.css).
export function Feedback({ message = '', tone = 'success', id }) {
  return <p id={id} role="status" aria-live="polite" className={'feedback ' + tone}>{message}</p>;
}
