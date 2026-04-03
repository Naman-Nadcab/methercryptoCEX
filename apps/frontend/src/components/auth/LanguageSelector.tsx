'use client';

import { useState } from 'react';
import { Globe, X } from 'lucide-react';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'es', name: 'Español (Internacional)' },
  { code: 'es-mx', name: 'Español (México)' },
  { code: 'es-ar', name: 'Español (Argentina)' },
  { code: 'kk', name: 'қазақша' },
  { code: 'pt-br', name: 'Português (Brasil)' },
  { code: 'pt', name: 'Português (Internacional)' },
  { code: 'ru', name: 'Русский' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'uk', name: 'Українська' },
  { code: 'ar', name: 'العربية' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-cn', name: '简体中文' },
  { code: 'zh-tw', name: '繁體中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ko', name: '한국어' },
  { code: 'th', name: 'ไทย' },
];

interface LanguageSelectorProps {
  className?: string;
}

export default function LanguageSelector({ className = '' }: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  const handleSelectLanguage = (code: string) => {
    setSelectedLanguage(code);
    setIsOpen(false);
    // In a real app, you'd store this in localStorage/cookie and trigger i18n change
  };

  return (
    <>
      {/* Globe Icon Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`p-2 rounded-full hover:bg-accent transition-colors ${className}`}
        aria-label="Select language"
      >
        <Globe className="w-5 h-5 text-muted-foreground" />
      </button>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-xl font-semibold text-foreground">
                Choose Your Language
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-full hover:bg-accent transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Language Grid */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleSelectLanguage(lang.code)}
                    className={`px-4 py-3 rounded-lg text-left transition-all ${
                      selectedLanguage === lang.code
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-foreground'
                        : 'hover:bg-accent text-foreground/80'
                    }`}
                  >
                    {lang.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
