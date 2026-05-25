import assert from 'node:assert/strict';
import {
  evaluateAdminRouteRbac,
  getImplicitRolePermissions,
  hasAdminRbacPermission,
} from './admin-rbac-routes.js';

type RouteCase = {
  role: string;
  method: string;
  path: string;
  allowed: boolean;
  mapped?: boolean;
};

const rolePermissionCases: Array<{ role: string; permission: string; allowed: boolean }> = [
  { role: 'super_admin', permission: 'settings:edit', allowed: true },
  { role: 'support', permission: 'users:view', allowed: true },
  { role: 'support_agent', permission: 'users:view', allowed: true }, // alias
  { role: 'support', permission: 'withdrawals:approve', allowed: false },
  { role: 'compliance', permission: 'aml:escalate', allowed: true },
  { role: 'compliance_officer', permission: 'aml:view', allowed: true }, // alias
  { role: 'finance_ops', permission: 'withdrawals:approve', allowed: true },
  { role: 'finance_admin', permission: 'treasury:sweep', allowed: true }, // alias
  { role: 'withdrawal_approver', permission: 'withdrawals:approve', allowed: true },
  { role: 'withdrawal_approver', permission: 'settings:edit', allowed: false },
];

const routeCases: RouteCase[] = [
  { role: 'support', method: 'GET', path: '/users', allowed: true },
  { role: 'support', method: 'PATCH', path: '/users/abc/status', allowed: true },
  { role: 'support', method: 'POST', path: '/withdrawals/abc/approve', allowed: false },

  { role: 'compliance', method: 'GET', path: '/compliance/integrations', allowed: true },
  { role: 'compliance', method: 'PATCH', path: '/compliance/integrations/id', allowed: true },
  { role: 'compliance', method: 'PATCH', path: '/settings/system', allowed: false },

  { role: 'finance_ops', method: 'GET', path: '/withdrawals', allowed: true },
  { role: 'finance_ops', method: 'POST', path: '/withdrawals/abc/approve', allowed: true },
  { role: 'finance_ops', method: 'PATCH', path: '/hybrid/config', allowed: true },

  { role: 'withdrawal_approver', method: 'POST', path: '/withdrawals/abc/approve', allowed: true },
  { role: 'withdrawal_approver', method: 'GET', path: '/withdrawals', allowed: false },

  // Coverage for previously-missing mappings
  { role: 'finance_ops', method: 'GET', path: '/external-liquidity/providers', allowed: true, mapped: true },
  { role: 'finance_ops', method: 'PATCH', path: '/external-liquidity/providers/id', allowed: true, mapped: true },
  { role: 'compliance', method: 'GET', path: '/unknown/new-surface', allowed: false, mapped: false },
];

function run(): void {
  for (const c of rolePermissionCases) {
    const actual = hasAdminRbacPermission(c.role, c.permission);
    assert.equal(
      actual,
      c.allowed,
      `hasAdminRbacPermission(${c.role}, ${c.permission}) expected=${c.allowed} got=${actual}`
    );
  }

  const supportPerms = getImplicitRolePermissions('support_agent');
  assert.ok(supportPerms.includes('users:view'), 'support_agent alias should resolve to support permissions');

  for (const c of routeCases) {
    const decision = evaluateAdminRouteRbac(c.role, c.method, c.path);
    assert.equal(
      decision.allowed,
      c.allowed,
      `evaluateAdminRouteRbac(${c.role}, ${c.method}, ${c.path}) expected allowed=${c.allowed} got=${decision.allowed}`
    );
    if (c.mapped !== undefined) {
      assert.equal(
        decision.mapped,
        c.mapped,
        `evaluateAdminRouteRbac(${c.role}, ${c.method}, ${c.path}) expected mapped=${c.mapped} got=${decision.mapped}`
      );
    }
  }

  // Sanity: all core P1 roles have non-empty implicit matrix.
  for (const role of ['support', 'compliance', 'finance_ops', 'withdrawal_approver']) {
    const perms = getImplicitRolePermissions(role);
    assert.ok(perms.length > 0, `role ${role} must have implicit permissions`);
  }

  console.log('PASS: admin-rbac-routes role matrix + route mapping checks');
}

run();
