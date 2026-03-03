'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="text-center max-w-md">
        <h1 className="text-8xl font-bold text-gray-700">404</h1>
        <h2 className="text-xl font-semibold text-white mt-2">Page not found</h2>
        <p className="text-gray-400 mt-2">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="flex flex-wrap gap-4 justify-center mt-8">
          <Link
            href="/"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Home
          </Link>
          <Link
            href="/login"
            className="px-5 py-2.5 border border-gray-600 hover:border-gray-500 rounded-lg font-medium transition-colors"
          >
            Login
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 border border-gray-600 hover:border-gray-500 rounded-lg font-medium transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
