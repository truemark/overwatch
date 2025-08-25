import {PartialIsmPolicy} from './open-search-helper.mjs';

// Function to generate a dynamic ISM policy based on input parameters
export function deleteLogsPolicy(
  indexPattern: string,
  days: number,
  priority: number,
): PartialIsmPolicy {
  return {
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
              min_index_age: `${days}d`,
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
        index_patterns: [`${indexPattern}-*`],
        priority: priority,
      },
    ],
  };
}
