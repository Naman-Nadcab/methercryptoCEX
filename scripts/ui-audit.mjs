#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const userBase = (process.env.UI_AUDIT_USER_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const adminBase = (process.env.UI_AUDIT_ADMIN_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const adminEmail = process.env.UI_AUDIT_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.UI_AUDIT_ADMIN_PASSWORD || 'admin123';
const reportDir = path.join(process.cwd(), 'docs', 'reports');
const screenshotDir = path.join(reportDir, 'ui-audit-screenshots');

const userRoutes = [
  { name: 'home', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'spot', path: '/spot' },
  { name: 'p2p', path: '/p2p' },
  { name: 'wallet', path: '/wallet' },
  { name: 'dashboard', path: '/dashboard' },
];

const adminRoutes = [
  { name: 'admin-dashboard', path: '/dashboard' },
  { name: 'admin-users', path: '/users' },
  { name: 'admin-wallets', path: '/wallets' },
  { name: 'admin-orders', path: '/orders' },
  { name: 'admin-p2p', path: '/p2p' },
  { name: 'admin-treasury', path: '/treasury' },
  { name: 'admin-liquidity', path: '/liquidity' },
  { name: 'admin-risk', path: '/risk' },
  { name: 'admin-monitoring', path: '/monitoring' },
  { name: 'admin-compliance', path: '/compliance' },
];

function asError(e) {
  return e instanceof Error ? e.message : String(e);
}

function isBenignFailedRequest(url, errText) {
  const t = `${url} ${errText}`.toLowerCase();
  if (t.includes('/_next/static/webpack/') && t.includes('hot-update')) return true;
  if (t.includes('?_rsc=') && t.includes('err_aborted')) return true;
  if ((t.includes('http://localhost:3000/') || t.includes('http://localhost:3001/')) && t.includes('err_aborted'))
    return true;
  if (t.includes('api/v1/') && t.includes('err_aborted')) return true;
  if (t.includes('/assets/upload/currency-logo/') && t.includes('err_aborted')) return true;
  if (t.includes('favicon.ico') && t.includes('404')) return true;
  return false;
}

async function gotoWithRetry(page, url) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function auditPage(page, base, route, kind) {
  const consoleErrors = [];
  const failedRequests = [];
  const server5xx = [];

  const onConsole = (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!/401|403|failed to fetch/i.test(t)) consoleErrors.push(t);
    }
  };
  const onRequestFailed = (req) => {
    const text = req.failure()?.errorText || 'failed';
    if (!isBenignFailedRequest(req.url(), text)) {
      failedRequests.push(`${req.method()} ${req.url()} :: ${text}`);
    }
  };
  const onResponse = (res) => {
    if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`);
  };

  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  const url = `${base}${route.path}`;
  const result = {
    route: route.name,
    url,
    kind,
    ok: true,
    finalUrl: '',
    title: '',
    brokenImages: 0,
    visibleButtons: 0,
    visibleLinks: 0,
    fontStatus: 'unknown',
    consoleErrors: [],
    failedRequests: [],
    server5xx: [],
    notes: [],
  };

  try {
    await gotoWithRetry(page, url);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    result.finalUrl = page.url();
    result.title = await page.title();
    await page.locator('body').waitFor({ state: 'visible', timeout: 5_000 });

    result.fontStatus = await page.evaluate(async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        return document.fonts.status;
      } catch {
        return 'error';
      }
    });

    const stats = await page.evaluate(() => {
      const imgs = Array.from(document.images || []);
      const broken = imgs.filter((img) => {
        const src = img.currentSrc || img.src || '';
        if (!src) return false;
        return img.complete && img.naturalWidth === 0;
      }).length;
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const visibleButtons = Array.from(document.querySelectorAll('button')).filter(visible).length;
      const visibleLinks = Array.from(document.querySelectorAll('a')).filter(visible).length;
      const hasHorizontalOverflow =
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { broken, visibleButtons, visibleLinks, hasHorizontalOverflow };
    });

    result.brokenImages = stats.broken;
    result.visibleButtons = stats.visibleButtons;
    result.visibleLinks = stats.visibleLinks;
    if (stats.hasHorizontalOverflow) result.notes.push('horizontal_overflow_detected');

    fs.mkdirSync(screenshotDir, { recursive: true });
    const shotPath = path.join(screenshotDir, `${kind}-${route.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });

    if (result.brokenImages > 0) result.ok = false;
  } catch (e) {
    result.ok = false;
    result.notes.push(`navigation_error: ${asError(e)}`);
  } finally {
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    result.consoleErrors = consoleErrors.slice(0, 20);
    result.failedRequests = failedRequests.slice(0, 20);
    result.server5xx = server5xx.slice(0, 20);
    if (result.consoleErrors.length || result.failedRequests.length || result.server5xx.length) {
      result.ok = false;
    }
  }
  return result;
}

async function adminLogin(page) {
  await gotoWithRetry(page, `${adminBase}/login`);
  const emailInput = page
    .locator('input[type="email"], input[name="email"], input[autocomplete="email"]')
    .first();
  const passwordInput = page
    .locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]')
    .first();
  await emailInput.waitFor({ state: 'visible', timeout: 20_000 });
  await emailInput.fill(adminEmail);
  await passwordInput.waitFor({ state: 'visible', timeout: 20_000 });
  await passwordInput.fill(adminPassword);
  const submitBtn = page.getByRole('button', { name: /sign in|login|continue/i }).first();
  await submitBtn.click();
  const navOk = await page
    .waitForURL(/\/dashboard/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (navOk) return;
  const fallbackOk = await page.evaluate(() => {
    const raw = localStorage.getItem('admin-auth');
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const token = parsed?.state?.accessToken;
      return typeof token === 'string' && token.length > 0;
    } catch {
      return false;
    }
  });
  if (!fallbackOk) {
    throw new Error('Admin login did not navigate to /dashboard and no admin-auth token was persisted');
  }
}

async function run() {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const userContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const userPage = await userContext.newPage();
  const adminPage = await adminContext.newPage();

  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    user_base: userBase,
    admin_base: adminBase,
    admin_login: { ok: false, email: adminEmail },
    user_results: [],
    admin_results: [],
    summary: { total: 0, pass: 0, fail: 0 },
  };

  for (const route of userRoutes) {
    const r = await auditPage(userPage, userBase, route, 'user');
    report.user_results.push(r);
  }

  let loginErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      await adminLogin(adminPage);
      report.admin_login.ok = true;
      loginErr = null;
      break;
    } catch (e) {
      loginErr = e;
      await adminPage.waitForTimeout(800);
    }
  }
  if (!report.admin_login.ok && loginErr) {
    report.admin_login.error = asError(loginErr);
  }

  for (const route of adminRoutes) {
    const r = await auditPage(adminPage, adminBase, route, 'admin');
    report.admin_results.push(r);
  }

  await userContext.close();
  await adminContext.close();
  await browser.close();

  const all = [...report.user_results, ...report.admin_results];
  report.summary.total = all.length;
  report.summary.pass = all.filter((r) => r.ok).length;
  report.summary.fail = report.summary.total - report.summary.pass;
  report.summary.ok = report.summary.fail === 0 && report.admin_login.ok;

  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'ui-simulation-audit.latest.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`UI audit report: ${reportPath}`);
  console.log(`admin_login_ok=${report.admin_login.ok}`);
  console.log(`total=${report.summary.total} pass=${report.summary.pass} fail=${report.summary.fail}`);
  console.log(report.summary.ok ? 'UI_AUDIT_OK' : 'UI_AUDIT_FAIL');
  if (!report.summary.ok) process.exit(1);
}

run().catch((e) => {
  console.error(`UI_AUDIT_CRASH ${asError(e)}`);
  process.exit(1);
});
