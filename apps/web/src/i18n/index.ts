// apps/web/src/i18n/index.ts · v0.3 spec §34.3
// react-i18next · 5 语言 (zh-CN 100% / en-US 80% / zh-TW 60% / ja-JP 40% / ko-KR 20%)

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import zhTW from './locales/zh-TW.json'
import jaJP from './locales/ja-JP.json'
import koKR from './locales/ko-KR.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', completion: 100 },
  { code: 'en-US', label: 'English', completion: 80 },
  { code: 'zh-TW', label: '繁體中文', completion: 60 },
  { code: 'ja-JP', label: '日本語', completion: 40 },
  { code: 'ko-KR', label: '한국어', completion: 20 },
] as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'zh-TW': { translation: zhTW },
      'ja-JP': { translation: jaJP },
      'ko-KR': { translation: koKR },
    },
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false }, // React 已防 XSS
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
  })

export default i18n
