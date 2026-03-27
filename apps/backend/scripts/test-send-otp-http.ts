/**
 * Test send-otp via HTTP to capture actual 500 error.
 * Run: cd apps/backend && npx tsx scripts/test-send-otp-http.ts
 *
 * Requires: backend not already running on port 4000 (or set API_URL).
 */
const API_URL = process.env.API_URL || 'http://127.0.0.1:4000';

async function main() {
  console.log('POST', `${API_URL}/api/v1/auth/send-otp`);
  console.log('Body:', JSON.stringify({ identifier: 'test@example.com' }));
  console.log('');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_URL}/api/v1/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }

    console.log('Status:', res.status);
    console.log('Response:', text.slice(0, 500));
    if (json && typeof json === 'object' && 'error' in json) {
      const err = (json as { error?: { code?: string; message?: string; detail?: string } }).error;
      if (err) {
        console.log('\n--- ERROR DETAIL ---');
        console.log('code:', err.code);
        console.log('message:', err.message);
        console.log('detail:', err.detail);
      }
    }

    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    clearTimeout(timeout);
    console.error('Request failed:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('Timeout - is the backend running? Try: npm run dev');
    }
    process.exit(1);
  }
}

main();
