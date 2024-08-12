export const developerRoleDefinition = {
  cluster_permissions: [
    'cluster:monitor/nodes/info',
    'cluster:monitor/state',
    'cluster:monitor/health',
    'cluster_composite_ops_ro',
    'indices:data/write/bulk',
  ],
  index_permissions: [
    {
      index_patterns: ['*'],
      dls: '',
      fls: [],
      masked_fields: [],
      allowed_actions: [
        'indices:data/read/search*',
        'indices:data/read/get',
        'indices:admin/get',
        'indices:admin/aliases/get',
        'indices:monitor/settings/get',
        'indices:monitor/stats',
        'indices:data/read/search/template',
        'data_access',
        'read',
        'search',
        'get',
        'indices_all',
      ],
    },
    {
      index_patterns: [
        '.kibana',
        '.kibana-6',
        '.kibana_*',
        '.opensearch_dashboards',
        '.opensearch_dashboards-6',
        '.opensearch_dashboards_*',
      ],
      dls: '',
      fls: [],
      masked_fields: [],
      allowed_actions: ['read', 'delete', 'manage', 'index'],
    },
    {
      index_patterns: ['.tasks', '.management-beats'],
      dls: '',
      fls: [],
      masked_fields: [],
      allowed_actions: ['indices_all'],
    },
  ],
  tenant_permissions: [
    {
      tenant_patterns: ['global_tenant'],
      allowed_actions: ['kibana_all_write'],
    },
  ],
};

export const developerRoleMappings = {
  backend_roles: ['92672f1b60-b803e9e6-0f09-4ed9-b8c8-83186dd674a6'],
  users: [],
  hosts: [],
};
