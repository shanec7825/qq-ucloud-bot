import React from 'react';
import { Icon } from '../../shared/Icon.jsx';

export { Icon };

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
