import {PartialIsmPolicy} from './open-search-helper.mjs';

export const deleteLogsAfter90DaysPolicy: PartialIsmPolicy = {
  description: 'Manage index lifecycle',
  default_state: 'hot',
  states: [
    {
      name: 'hot',
      actions: [],
      transitions: [
        {
          state_name: 'delete',
          conditions: {
            min_index_age: '90d',
          },
        },
      ],
    },
    {
      name: 'delete',
      actions: [
        {
          delete: {},
        },
      ],
      transitions: [],
    },
  ],
  ism_template: [
    {
      index_patterns: ['logs-*'],
      priority: 100,
    },
  ],
};
